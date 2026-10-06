'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createEconomyServer } = require('../src/economy-worker/server.cjs');
const { NexusEconomyStore, NexusEconomyWorker } = require('../src/sentinel/nexus-economy-worker.cjs');
const { PostgresMcPoints, MC_SCHEMA_VERSION } = require('../src/economy-worker/mc-points-postgres.cjs');
const { PostgresArkShop } = require('../src/economy-worker/ark-np-postgres.cjs');
const { NexusEconomyPostgresRuntimeRepository } = require('../src/sentinel/nexus-economy-postgres-runtime-repository.cjs');
const { deterministicEconomicIdentityId } = require('../src/sentinel/nexus-economy-json-postgres-migration.cjs');
const { classifyPopulation, AMOUNT } = require('../src/economy-worker/legacy-bank-flat.cjs');
const { mcMemberText } = require('../src/shared/mc-member-text.cjs');
const { UNLINK_COOLDOWN_MS } = require('../src/economy-worker/mc-points-service.cjs');
const { FIRST_PLAY_MS } = require('../src/shared/mc-starter-kit.cjs');
const { ClusterShopService } = require('../src/sentinel/cluster-shop-service.cjs');
const { COMMUNITY_LEVEL_UP_SOURCE } = require('../src/sentinel/nexus-economy-community-level-coins.cjs');

const UUID = '853c80ef-3c37-49fd-aa49-938b674adae6';
const UUID_2 = '11111111-1111-4111-8111-111111111111';
const DISCORD = '111111111111111111';
const DISCORD_2 = '222222222222222222';
const LINK_SECRET = 'mc-link-code-hmac-secret-32chars!';
const EOS = 'EOSARKMC0001';
const JOINED = Date.parse('2020-01-15T00:00:00.000Z');

function memberEnv(extra = {}) {
  return {
    MC_POINTS_ENABLED: 'true',
    MC_PLAYTIME_NP_ENABLED: 'true',
    MC_PLAYTIME_DRY_RUN: 'false',
    MC_SHOP_ENABLED: 'true',
    MC_SHOP_DRY_RUN: 'false',
    MC_STARTER_KIT_ENABLED: 'true',
    MC_LINK_CODE_SECRET: LINK_SECRET,
    ...extra
  };
}

function workerAt(env = memberEnv()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-link-verify-'));
  let now = Date.parse('2026-10-01T16:00:00.000Z');
  const worker = new NexusEconomyWorker({
    store: new NexusEconomyStore(root),
    now: () => now,
    env
  });
  return { worker, advance: (ms) => { now += ms; } };
}

async function linkMinecraft(worker, discord, uuid) {
  const challenge = await worker.minecraft.challenge({ discordUserId: discord, mcUuid: uuid, mcName: 'Steve' });
  assert.equal(challenge.ok, true, challenge.reason);
  const confirmed = await worker.minecraft.confirm({ discordUserId: discord, code: challenge.code });
  assert.equal(confirmed.ok, true, confirmed.reason);
  return confirmed;
}

async function earnFiveMinuteTicks(worker, advance, ticks) {
  await worker.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft' });
  for (let step = 0; step < ticks; step += 1) {
    advance(5 * 60 * 1000);
    const earned = await worker.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft' });
    assert.equal(earned.ok, true, earned.reason);
  }
}

test('an unlinked Minecraft row does not keep shop, kit, or wallet access', async () => {
  const { worker } = workerAt();
  await linkMinecraft(worker, DISCORD, UUID);
  const link = [...worker.minecraft.links.values()].find((row) => row.discordUserId === DISCORD);
  link.unlinkedAt = '2026-10-01T16:00:00.000Z';
  const quoted = await worker.minecraft.quote({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1 });
  assert.equal(quoted.reason, 'verified-identity-required');
  const kit = await worker.minecraft.claimStarterKit({ discordUserId: DISCORD, tenureOf: async () => JOINED });
  assert.equal(kit.reason, 'verified-identity-required');
  const spent = await worker.spend({ discordUserId: DISCORD, amount: 1, orderId: 'unlinked-shop', source: 'sink:mc-shop' }, { minecraftShop: true });
  assert.equal(spent.reason, 'verified-identity-required');
});

test('minecraft member text points a new member at the in-game code', () => {
  const text = mcMemberText('verified-identity-required');
  assert.match(text, /\/mc link start/);
  assert.match(text, /\/mc link confirm/);
  assert.doesNotMatch(text, /Finish verification/);
});

test('an MC-only member verifies with the link code, earns, buys, and claims the kit', async () => {
  const { worker, advance } = workerAt();
  const challenge = await worker.minecraft.challenge({ discordUserId: DISCORD, mcUuid: UUID, mcName: 'Steve' });
  assert.equal(challenge.ok, true, challenge.reason);
  const pending = worker.store.read().accounts[DISCORD];
  assert.equal(pending.status, 'restricted');
  assert.equal(pending.verifiedAt, null);
  assert.deepEqual(pending.eosIds, []);
  const early = await worker.minecraft.quote({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1 });
  assert.equal(early.reason, 'verified-identity-required');

  const confirmed = await worker.minecraft.confirm({ discordUserId: DISCORD, code: challenge.code });
  assert.equal(confirmed.ok, true, confirmed.reason);
  const account = worker.wallet(DISCORD);
  assert.equal(account.status, 'restricted');
  assert.equal(account.verifiedAt, null);
  assert.deepEqual(account.eosIds, []);
  const coinSpend = await worker.spend({ discordUserId: DISCORD, amount: 1, orderId: 'coin-shop', source: 'cluster-shop', currency: 'NEXUS_COINS' });
  assert.equal(coinSpend.reason, 'verified-identity-required');
  const pointSpend = await worker.spend({ discordUserId: DISCORD, amount: 1, orderId: 'np-shop', source: 'cluster-shop', currency: 'NEXUS_POINTS' });
  assert.equal(pointSpend.reason, 'verified-identity-required');
  const coinCredit = await worker.credit({ discordUserId: DISCORD, amount: 5, idempotencyKey: 'coin-credit-1' });
  assert.equal(coinCredit.reason, 'verified-identity-required');
  const runtime = createEconomyServer({ worker, token: 'sentinal-token', writesEnabled: true, mcRoutesEnabled: true });
  await new Promise((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
  try {
    const refused = async (pathname, body) => {
      const payload = Buffer.from(JSON.stringify(body));
      return new Promise((resolve, reject) => {
        const req = http.request({
          host: '127.0.0.1',
          port: runtime.server.address().port,
          path: pathname,
          method: 'POST',
          headers: { authorization: 'Bearer sentinal-token', 'content-type': 'application/json', 'content-length': payload.length }
        }, (res) => {
          let raw = '';
          res.on('data', (chunk) => { raw += chunk; });
          res.on('end', () => resolve(JSON.parse(raw)));
        });
        req.on('error', reject);
        req.end(payload);
      });
    };
    assert.equal((await refused('/wallet/spend', { discordUserId: DISCORD, amount: 1, orderId: 'http-coins', currency: 'NEXUS_COINS', source: 'cluster-shop' })).reason, 'verified-identity-required');
    assert.equal((await refused('/wallet/spend', { discordUserId: DISCORD, amount: 1, orderId: 'http-points', currency: 'NEXUS_POINTS', source: 'cluster-shop' })).reason, 'verified-identity-required');
    assert.equal((await refused('/wallet/credit', { discordUserId: DISCORD, amount: 1, idempotencyKey: 'http-credit' })).reason, 'verified-identity-required');
  } finally {
    runtime.server.close();
  }
  assert.equal(account.discordLinkSource, 'mc-link');
  const proof = await worker.recordSentinelOwnershipProof(DISCORD, '2026-10-02T00:00:00.000Z');
  assert.equal(proof.status, 'restricted');
  assert.equal(proof.discordLinkSource, 'sentinel-ownership-proof');
  assert.equal(worker.wallet(DISCORD).status, 'restricted');
  const levelUp = await worker.credit({ discordUserId: DISCORD, amount: 5, idempotencyKey: 'level-up-1', source: COMMUNITY_LEVEL_UP_SOURCE });
  assert.equal(levelUp.skipped, 'coins-wallet-unavailable');
  const cluster = new ClusterShopService({
    economy: worker,
    catalog: new Map([['cache', {
      id: 'cache', name: 'Cache', kind: 'item', buyPrice: 1, baseQuantity: 1, minBundles: 1, maxBundles: 1, buyable: true
    }]])
  });
  const clusterBuy = await cluster.createBuyOrder({ discordUserId: DISCORD, eosId: 'EOSMISSING01', itemId: 'cache', bundles: 1 });
  assert.equal(clusterBuy.ok, false);
  assert.equal(clusterBuy.reason, 'verified-identity-required');
  assert.equal(worker.store.read().eosToDiscord[UUID], undefined);
  assert.equal(confirmed.economicIdentityId, DISCORD);

  await earnFiveMinuteTicks(worker, advance, 5);
  const earned = worker.wallet(DISCORD);
  assert.equal(earned.balance, 10);
  assert.ok(earned.mcLifetimeMs >= FIRST_PLAY_MS);
  const quoted = await worker.minecraft.quote({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1 });
  assert.equal(quoted.ok, true, quoted.reason);
  const bought = await worker.minecraft.buy({
    discordUserId: DISCORD,
    sku: 'mc_logs64',
    bundles: 1,
    nonce: quoted.quote.nonce,
    writesEnabled: true
  });
  assert.equal(bought.ok, true, bought.reason);
  assert.equal(bought.dryRun, undefined);
  assert.equal(worker.balance(DISCORD), 0);
  assert.equal(bought.order.source, 'mc-shop');

  const claim = await worker.minecraft.claimStarterKit({
    discordUserId: DISCORD,
    tenureOf: async () => JOINED
  });
  assert.equal(claim.ok, true, claim.reason);
  assert.equal(claim.order.source, 'starter-kit');
  assert.equal(claim.order.price, 0);

  const arkPresence = await worker.recordPresence({ eosId: EOS, online: true, server: 'ark' });
  assert.equal(arkPresence.reason, 'unlinked-player');
  const ledger = worker.store.read().ledger;
  assert.ok(ledger.length >= 2);
  assert.ok(ledger.every((entry) => entry.source === 'minecraft' || entry.source === 'sink:mc-shop'));
  assert.equal(ledger.some((entry) => /coin|legacy_bank|birthday|level-up/i.test(`${entry.source} ${entry.type}`)), false);
});

test('ARK then Minecraft and Minecraft then ARK share one NP wallet', async () => {
  const first = workerAt();
  first.worker.linkArkIdentity({ discordUserId: DISCORD, eosId: EOS, rankId: 'shadow-recruit' });
  await linkMinecraft(first.worker, DISCORD, UUID);
  await earnFiveMinuteTicks(first.worker, first.advance, 1);
  const shared = first.worker.wallet(DISCORD);
  assert.equal(shared.balance, 2);
  assert.deepEqual(shared.eosIds, [EOS]);
  assert.equal(Object.keys(first.worker.store.read().accounts).length, 1);
  const arkEarn = await first.worker.recordPresence({ eosId: EOS, online: true, server: 'ark' });
  assert.equal(arkEarn.ok, true, arkEarn.reason);
  assert.equal(arkEarn.balance, shared.balance);

  const second = workerAt();
  await linkMinecraft(second.worker, DISCORD, UUID);
  await earnFiveMinuteTicks(second.worker, second.advance, 1);
  const before = second.worker.balance(DISCORD);
  second.worker.linkArkIdentity({ discordUserId: DISCORD, eosId: EOS, rankId: 'shadow-recruit' });
  const combined = second.worker.wallet(DISCORD);
  assert.equal(combined.balance, before);
  assert.deepEqual(combined.eosIds, [EOS]);
  assert.equal(combined.discordUserId, DISCORD);
  assert.equal(Object.keys(second.worker.store.read().accounts).length, 1);
});

test('unlink cooldown blocks a new Minecraft link and leaves the shared wallet in place', async () => {
  const { worker, advance } = workerAt();
  worker.linkArkIdentity({ discordUserId: DISCORD, eosId: EOS, rankId: 'shadow-recruit' });
  await linkMinecraft(worker, DISCORD, UUID);
  await earnFiveMinuteTicks(worker, advance, 1);
  const balance = worker.balance(DISCORD);
  const removed = await worker.minecraft.unlink({ discordUserId: DISCORD });
  assert.equal(removed.ok, true, removed.reason);
  const cooled = await worker.minecraft.challenge({ discordUserId: DISCORD, mcUuid: UUID_2, mcName: 'Alex' });
  assert.equal(cooled.reason, 'unlink-cooldown');
  const shop = await worker.minecraft.quote({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1 });
  assert.equal(shop.reason, 'verified-minecraft-link-required');
  const earn = await worker.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft' });
  assert.equal(earn.reason, 'unlinked-player');
  const account = worker.wallet(DISCORD);
  assert.equal(account.status, 'verified');
  assert.equal(account.balance, balance);
  assert.deepEqual(account.eosIds, [EOS]);
  advance(UNLINK_COOLDOWN_MS + 1000);
  const again = await worker.minecraft.challenge({ discordUserId: DISCORD, mcUuid: UUID, mcName: 'Steve' });
  assert.equal(again.ok, true, again.reason);
});

test('disabled, quarantined, marked restricted, and denylisted members are not verified by a Minecraft link', async () => {
  for (const status of ['disabled', 'quarantined']) {
    const { worker } = workerAt();
    const state = worker.store.read();
    worker.ensureAccount(state, DISCORD, 'shadow-recruit');
    state.accounts[DISCORD].status = status;
    state.accounts[DISCORD].holdReason = '';
    worker.store.write(state);
    const challenge = await worker.minecraft.challenge({ discordUserId: DISCORD, mcUuid: UUID, mcName: 'Steve' });
    assert.equal(challenge.reason, 'account-hold', status);
    assert.equal(worker.wallet(DISCORD).status, status);
    assert.equal(worker.minecraft.linkByUuid(UUID), null);
  }

  const marked = workerAt();
  const markedState = marked.worker.store.read();
  marked.worker.ensureAccount(markedState, DISCORD, 'shadow-recruit');
  markedState.accounts[DISCORD].status = 'restricted';
  markedState.accounts[DISCORD].holdReason = 'staff';
  marked.worker.store.write(markedState);
  const markedChallenge = await marked.worker.minecraft.challenge({ discordUserId: DISCORD, mcUuid: UUID, mcName: 'Steve' });
  assert.equal(markedChallenge.reason, 'account-hold');
  assert.equal(marked.worker.wallet(DISCORD).status, 'restricted');
  assert.equal(marked.worker.wallet(DISCORD).holdReason, 'staff');

  const deniedEnv = memberEnv({ NEXUS_ECONOMY_QUARANTINE_DENYLIST: DISCORD });
  const denied = workerAt(deniedEnv);
  const deniedChallenge = await denied.worker.minecraft.challenge({ discordUserId: DISCORD, mcUuid: UUID, mcName: 'Steve' });
  assert.equal(deniedChallenge.reason, 'account-hold');
  assert.equal(denied.worker.wallet(DISCORD).status, 'restricted');
  assert.equal(denied.worker.wallet(DISCORD).holdReason, 'quarantine');
  assert.equal(denied.worker.minecraft.linkByUuid(UUID), null);

  const shadow = workerAt();
  const shadowState = shadow.worker.store.read();
  shadow.worker.ensureAccount(shadowState, DISCORD, 'shadow-recruit');
  shadowState.accounts[DISCORD].status = 'restricted';
  shadowState.accounts[DISCORD].holdReason = '';
  shadowState.accounts[DISCORD].verifiedAt = null;
  shadow.worker.store.write(shadowState);
  await linkMinecraft(shadow.worker, DISCORD, UUID);
  assert.equal(shadow.worker.wallet(DISCORD).status, 'restricted');
  assert.equal(shadow.worker.wallet(DISCORD).verifiedAt, null);
  assert.deepEqual(shadow.worker.wallet(DISCORD).eosIds, []);
  shadow.worker.linkArkIdentity({ discordUserId: DISCORD, eosId: EOS, rankId: 'shadow-recruit' });
  assert.equal(shadow.worker.wallet(DISCORD).status, 'restricted');
  assert.equal(shadow.worker.wallet(DISCORD).verifiedAt, null);
  assert.deepEqual(shadow.worker.wallet(DISCORD).eosIds, [EOS]);
  const stillRefused = await shadow.worker.spend({ discordUserId: DISCORD, amount: 1, orderId: 'after-ark' });
  assert.equal(stillRefused.reason, 'verified-identity-required');
});

test('link whispers are rate limited per Discord user and per UUID', async () => {
  const { worker } = workerAt();
  const uuids = [
    UUID,
    UUID_2,
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444'
  ];
  for (let index = 0; index < 3; index += 1) {
    const opened = await worker.minecraft.challenge({ discordUserId: DISCORD, mcUuid: uuids[index], mcName: 'Steve' });
    assert.equal(opened.ok, true, opened.reason);
  }
  const byDiscord = await worker.minecraft.challenge({ discordUserId: DISCORD, mcUuid: uuids[3], mcName: 'Steve' });
  assert.equal(byDiscord.reason, 'link-rate-limited');

  const shared = workerAt();
  for (const discord of [DISCORD, DISCORD_2, '333333333333333333']) {
    const opened = await shared.worker.minecraft.challenge({ discordUserId: discord, mcUuid: UUID, mcName: 'Steve' });
    assert.equal(opened.ok, true, opened.reason);
  }
  const byUuid = await shared.worker.minecraft.challenge({ discordUserId: '444444444444444444', mcUuid: UUID, mcName: 'Alex' });
  assert.equal(byUuid.reason, 'link-rate-limited');
});

test('the craft guide tells members how to link, earn, buy, and claim the kit', () => {
  const guide = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/discord/nexus-guide.json'), 'utf8'));
  const entry = guide.topics.find((topic) => topic.id === 'minecraft-points');
  assert.equal(entry.label, 'Minecraft Points');
  const body = entry.details.join('\n');
  assert.match(body, /\/mc link start/);
  assert.match(body, /\/mc link confirm/);
  assert.match(body, /earns Points/);
  assert.match(body, /not open yet/);
  assert.match(body, /starter kit/);
  assert.match(body, /does not open the ARK shop or Coins/);
  assert.doesNotMatch(body, /token/i);
});

function economyPool() {
  const db = {
    identities: new Map(),
    links: [],
    wallets: [],
    ledger: [],
    mcLinks: new Map(),
    challenges: new Map(),
    requests: [],
    accrual: new Map()
  };
  let snapshot = null;
  const queries = [];

  function blank() {
    return {
      identities: new Map([...db.identities].map(([key, value]) => [key, { ...value }])),
      links: db.links.map((row) => ({ ...row })),
      wallets: db.wallets.map((row) => ({ ...row })),
      ledger: db.ledger.map((row) => ({ ...row })),
      mcLinks: new Map([...db.mcLinks].map(([key, value]) => [key, { ...value }])),
      challenges: new Map(db.challenges),
      requests: db.requests.map((row) => ({ ...row })),
      accrual: new Map([...db.accrual].map(([key, value]) => [key, { ...value }]))
    };
  }

  function restore(saved) {
    db.identities = saved.identities;
    db.links = saved.links;
    db.wallets = saved.wallets;
    db.ledger = saved.ledger;
    db.mcLinks = saved.mcLinks;
    db.challenges = saved.challenges;
    db.requests = saved.requests;
    db.accrual = saved.accrual;
  }

  function linkRow(provider, externalId) {
    return db.links.find((row) => row.provider === provider && row.external_id === externalId) || null;
  }

  async function query(sql, params = []) {
    const text = String(sql);
    queries.push(text);
    if (text === 'BEGIN') {
      snapshot = blank();
      return { rows: [], rowCount: 0 };
    }
    if (text === 'COMMIT') {
      snapshot = null;
      return { rows: [], rowCount: 0 };
    }
    if (text === 'ROLLBACK') {
      if (snapshot) restore(snapshot);
      snapshot = null;
      return { rows: [], rowCount: 0 };
    }
    if (text.includes('nexus_mc_schema_version') && text.includes('SELECT')) return { rows: [{ version: MC_SCHEMA_VERSION }], rowCount: 1 };
    if (/^(CREATE|ALTER|LOCK)\b/i.test(text.trim()) || text.includes('LOCK TABLE') || text.includes('CREATE INDEX') || text.includes('CREATE UNIQUE')) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes('INSERT INTO') && text.includes('nexus_economic_identities') && text.includes("status) VALUES ($1, 'restricted')")) {
      if (!db.identities.has(params[0])) db.identities.set(params[0], { status: 'restricted', hold_reason: null, held_by: null });
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('hold_reason = \'quarantine\'')) {
      const row = db.identities.get(params[0]);
      if (row && !String(row.hold_reason || '').trim()) row.hold_reason = 'quarantine';
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('SET status = \'verified\'') && text.includes('status = \'restricted\'')) {
      const row = db.identities.get(params[0]);
      if (row && row.status === 'restricted' && !String(row.hold_reason || '').trim()) {
        row.status = 'verified';
        row.hold_reason = null;
        row.held_by = null;
      }
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('SET status = \'verified\'')) {
      const row = db.identities.get(params[0]);
      if (row) {
        row.status = 'verified';
        row.hold_reason = null;
        row.held_by = null;
      }
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('SELECT status, hold_reason, held_by')) {
      const row = db.identities.get(params[0]);
      return { rows: row ? [{ status: row.status, hold_reason: row.hold_reason, held_by: row.held_by }] : [], rowCount: row ? 1 : 0 };
    }
    if (text.includes('VALUES ($1,$2,$3,$4,\'sentinel-ownership-proof\')') || text.includes("VALUES ($1,$2,$3,$4,'sentinel-ownership-proof')")) {
      const [provider, externalId, economicIdentityId, verifiedAt] = params;
      const found = linkRow(provider, externalId);
      if (!found) db.links.push({ provider, external_id: externalId, economic_identity_id: economicIdentityId, verified_at: verifiedAt, source: 'sentinel-ownership-proof' });
      else if (!found.verified_at) {
        found.verified_at = verifiedAt;
        found.source = 'sentinel-ownership-proof';
      }
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("VALUES ('discord'") && text.includes('DO NOTHING')) {
      if (!linkRow('discord', params[0])) {
        db.links.push({ provider: 'discord', external_id: params[0], economic_identity_id: params[1], verified_at: null, source: 'mc-link' });
      }
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("VALUES ('discord'") && text.includes('COALESCE')) {
      const found = linkRow('discord', params[0]);
      if (!found) db.links.push({ provider: 'discord', external_id: params[0], economic_identity_id: params[1], verified_at: params[2], source: 'mc-link' });
      else if (!found.verified_at) {
        found.verified_at = params[2];
        found.source = 'mc-link';
      }
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('SELECT balance') && text.includes('nexus_economy_wallets')) {
      const row = db.wallets.find((item) => item.economic_identity_id === params[0] && item.currency === 'NEXUS_POINTS');
      return { rows: row ? [{ balance: row.balance }] : [], rowCount: row ? 1 : 0 };
    }
    if (text.includes('INSERT INTO') && text.includes('nexus_economy_wallets')) {
      const currency = text.includes("'NEXUS_POINTS'") ? 'NEXUS_POINTS' : String(params[1] || '');
      const economicIdentityId = params[0];
      if (currency && !db.wallets.some((row) => row.economic_identity_id === economicIdentityId && row.currency === currency)) {
        db.wallets.push({ economic_identity_id: economicIdentityId, currency, balance: 0 });
      }
      if (/NEXUS_COINS/.test(text)) db.ledger.push({ currency: 'NEXUS_COINS', economic_identity_id: economicIdentityId });
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('INSERT INTO') && text.includes('nexus_economy_ledger')) {
      db.ledger.push({ currency: params[1] || 'unknown', economic_identity_id: params[0] });
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('nexus_economy_accrual_state') && text.includes('INSERT INTO')) {
      if (!db.accrual.has(params[0])) db.accrual.set(params[0], {});
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('nexus_economy_accrual_state') && text.includes('UPDATE')) return { rows: [], rowCount: 1 };
    if (text.includes("provider = 'discord' AND external_id = $1") && text.includes("provider = 'eos'")) {
      const rows = db.links.filter((row) => (row.provider === 'discord' && row.external_id === params[0]) || (row.provider === 'eos' && row.external_id === params[1]));
      return { rows, rowCount: rows.length };
    }
    if (text.includes('d.verified_at IS NOT NULL') && text.includes('i.economic_identity_id') && text.includes('i.hold_reason')) {
      const link = db.links.find((row) => row.provider === 'discord' && row.external_id === params[0] && row.verified_at);
      if (!link) return { rows: [], rowCount: 0 };
      const identity = db.identities.get(link.economic_identity_id);
      return { rows: [{ economic_identity_id: link.economic_identity_id, status: identity?.status, hold_reason: identity?.hold_reason }], rowCount: 1 };
    }
    if (text.includes("provider = 'eos'") && text.includes('external_id') && text.includes('verified_at IS NOT NULL')) {
      const rows = db.links.filter((row) => row.economic_identity_id === params[0] && row.provider === 'eos' && row.verified_at).map((row) => ({ external_id: row.external_id }));
      return { rows, rowCount: rows.length };
    }
    if (text.includes('SELECT 1') && text.includes('nexus_mc_links')) {
      const rows = [...db.mcLinks.values()].filter((row) => row.discord_user_id === params[0] && row.verified_at && !row.unlinked_at);
      return { rows: rows.length ? [{ '?column?': 1 }] : [], rowCount: rows.length ? 1 : 0 };
    }
    if (text.includes('SELECT 1') && text.includes("provider = 'minecraft'")) {
      const rows = db.links.filter((row) => row.economic_identity_id === params[0] && row.provider === 'minecraft' && row.verified_at);
      return { rows: rows.length ? [{ '?column?': 1 }] : [], rowCount: rows.length ? 1 : 0 };
    }
    if (text.includes('i.economic_identity_id') && text.includes('d.verified_at') && text.includes("d.provider = 'discord'")) {
      const link = linkRow('discord', params[0]);
      if (!link) return { rows: [], rowCount: 0 };
      const identity = db.identities.get(link.economic_identity_id);
      return {
        rows: [{
          economic_identity_id: link.economic_identity_id,
          status: identity?.status,
          hold_reason: identity?.hold_reason,
          verified_at: link.verified_at
        }],
        rowCount: 1
      };
    }
    if (text.includes('SELECT economic_identity_id, verified_at, source') || (text.includes('SELECT economic_identity_id, verified_at') && text.includes("provider = 'discord'"))) {
      const link = linkRow('discord', params[0]);
      return { rows: link ? [{ economic_identity_id: link.economic_identity_id, verified_at: link.verified_at, source: link.source }] : [], rowCount: link ? 1 : 0 };
    }
    if (text.includes('SELECT i.status, i.hold_reason, d.verified_at')) {
      const link = linkRow('discord', params[0]);
      const identity = link ? db.identities.get(link.economic_identity_id) : null;
      return { rows: link ? [{ status: identity?.status, hold_reason: identity?.hold_reason, verified_at: link.verified_at }] : [], rowCount: link ? 1 : 0 };
    }
    if (text.includes('FROM') && text.includes('nexus_mc_links') && text.includes('playtime_ms')) {
      return { rows: [...db.mcLinks.values()], rowCount: db.mcLinks.size };
    }
    if (text.includes('INSERT INTO') && text.includes('nexus_mc_links')) {
      const row = {
        mc_uuid: params[0],
        economic_identity_id: params[1],
        discord_user_id: params[2],
        verified_at: params[3],
        unlinked_at: params[4],
        cooldown_until: params[5],
        playtime_ms: params[6],
        proof: params[7] && params[7] !== 'null' ? JSON.parse(params[7]) : null
      };
      const existing = db.mcLinks.get(row.mc_uuid);
      if (existing?.verified_at && existing.economic_identity_id !== row.economic_identity_id) return { rows: [], rowCount: 0 };
      db.mcLinks.set(row.mc_uuid, row);
      return { rows: [{ mc_uuid: row.mc_uuid }], rowCount: 1 };
    }
    if (text.includes('UPDATE') && text.includes("provider = 'minecraft'") && text.includes('verified_at = NULL')) {
      const found = db.links.find((row) => row.provider === 'minecraft' && row.external_id === params[0] && row.economic_identity_id === params[1]);
      if (found) found.verified_at = null;
      return { rows: [], rowCount: found ? 1 : 0 };
    }
    if (text.includes('INSERT INTO') && text.includes('nexus_economic_identity_links') && text.includes("'minecraft'")) {
      const found = linkRow('minecraft', params[0]);
      if (!found) {
        db.links.push({ provider: 'minecraft', external_id: params[0], economic_identity_id: params[1], verified_at: params[2], source: 'mc-link' });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (text.includes('SELECT economic_identity_id, verified_at') && text.includes("provider = 'minecraft'")) {
      const found = linkRow('minecraft', params[0]);
      return { rows: found ? [{ economic_identity_id: found.economic_identity_id, verified_at: found.verified_at }] : [], rowCount: found ? 1 : 0 };
    }
    if (text.includes('UPDATE') && text.includes("provider = 'minecraft'") && text.includes('source = \'mc-link\'')) {
      const found = linkRow('minecraft', params[0]);
      if (found && found.economic_identity_id === params[1]) found.verified_at = params[2];
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('FROM') && text.includes('nexus_mc_link_challenges')) {
      return { rows: [...db.challenges.values()], rowCount: db.challenges.size };
    }
    if (text.includes('INSERT INTO') && text.includes('nexus_mc_link_challenges')) {
      db.challenges.set(params[0], {
        discord_user_id: params[0],
        mc_uuid: params[1],
        mc_name: params[2],
        code_hash: params[3],
        economic_identity_id: params[4],
        expires_at: params[5],
        attempts: params[6],
        locked: params[7],
        used_at: params[8]
      });
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('DELETE FROM') && text.includes('nexus_mc_link_challenges')) {
      db.challenges.delete(params[0]);
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('FROM') && text.includes('nexus_mc_link_requests')) {
      return { rows: db.requests, rowCount: db.requests.length };
    }
    if (text.includes('INSERT INTO') && text.includes('nexus_mc_link_requests')) {
      db.requests.push({ mc_uuid: params[0], discord_user_id: params[1], created_at: params[2] });
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('nexus_mc_action_audit')) return { rows: [], rowCount: 1 };
    if (text.includes('nexus_mc_quotes')) return { rows: [], rowCount: 1 };
    throw new Error(`unhandled sql: ${text.slice(0, 220)}`);
  }

  const client = { query, release() {} };
  return {
    db,
    queries,
    async query(sql, params) { return query(sql, params); },
    async connect() { return client; }
  };
}

function pointsOn(pool, env = memberEnv()) {
  return new PostgresMcPoints({
    pool,
    env,
    now: () => Date.parse('2026-10-01T18:00:00.000Z'),
    wallet: {
      async balance() { return 25; },
      async spend() { return { ok: true, balance: 15 }; },
      async credit() { return { ok: true, balance: 25 }; },
      async quarantined() { return false; }
    }
  });
}

test('postgres MC verify reuses one wallet and does not open ARK, legacy, or Coin paths', async () => {
  const pool = economyPool();
  const points = pointsOn(pool);
  const challenge = await points.challenge({ discordUserId: DISCORD, mcUuid: UUID, mcName: 'Steve' });
  assert.equal(challenge.ok, true, challenge.reason);
  const econId = deterministicEconomicIdentityId(DISCORD);
  assert.equal(pool.db.identities.get(econId).status, 'restricted');
  assert.equal(pool.db.links.find((row) => row.provider === 'discord').verified_at, null);
  assert.equal(pool.db.links.some((row) => row.provider === 'eos'), false);
  const early = await points.quote({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1 });
  assert.equal(early.reason, 'verified-identity-required');

  const confirmed = await points.confirm({ discordUserId: DISCORD, code: challenge.code });
  assert.equal(confirmed.ok, true, confirmed.reason);
  assert.equal(confirmed.economicIdentityId, econId);
  assert.equal(pool.db.identities.get(econId).status, 'restricted');
  assert.equal(pool.db.links.find((row) => row.provider === 'discord').verified_at, null);
  assert.equal(pool.db.links.find((row) => row.provider === 'discord').source, 'mc-link');
  assert.ok(pool.db.links.find((row) => row.provider === 'minecraft' && row.external_id === UUID).verified_at);
  assert.equal(pool.db.links.some((row) => row.provider === 'eos'), false);
  assert.deepEqual(pool.db.wallets.map((row) => row.currency), ['NEXUS_POINTS']);
  assert.equal(pool.db.ledger.length, 0);
  assert.equal(pool.queries.some((sql) => /NEXUS_COINS/.test(sql)), false);
  const quoted = await points.quote({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1 });
  assert.equal(quoted.ok, true, quoted.reason);

  const ark = new PostgresArkShop({
    pool,
    env: { ARK_SHOP_ENABLED: 'true', MC_POINTS_ENABLED: 'true' },
    now: () => Date.parse('2026-10-01T18:00:00.000Z')
  });
  const arkQuote = await ark.quote({ discordUserId: DISCORD, sku: 'coastal' });
  assert.equal(arkQuote.reason, 'minecraft-only');
  assert.equal(pool.db.links.some((row) => row.provider === 'eos'), false);

  const legacy = classifyPopulation([{
    econId,
    status: 'verified',
    createdAt: '2026-01-01T00:00:00.000Z',
    discord: [{ id: DISCORD, verifiedAt: '2026-01-01T00:00:00.000Z' }],
    eos: []
  }]);
  assert.equal(legacy.rows[0].skipReason, 'not_verified');
  assert.equal(legacy.rows[0].amount, 0);
  const withEos = classifyPopulation([{
    econId,
    status: 'verified',
    createdAt: '2026-01-01T00:00:00.000Z',
    discord: [{ id: DISCORD, verifiedAt: '2026-01-01T00:00:00.000Z' }],
    eos: [{ id: EOS, verifiedAt: '2026-01-01T00:00:00.000Z' }]
  }]);
  assert.equal(withEos.rows[0].skipReason, '');
  assert.equal(withEos.rows[0].amount, AMOUNT);
  assert.equal(AMOUNT, 1500);

  const repository = new NexusEconomyPostgresRuntimeRepository({ pool, schema: 'public' });
  const refusedArk = await repository.linkVerifiedIdentity({
    discordUserId: DISCORD,
    eosId: EOS,
    verifiedAt: '2026-10-01T18:00:00.000Z',
    discordMembershipVerified: false
  });
  assert.equal(refusedArk.ok, true);
  assert.equal(refusedArk.status, 'restricted');
  assert.equal(pool.db.identities.get(econId).status, 'restricted');
  const stillBlocked = await ark.quote({ discordUserId: DISCORD, sku: 'coastal' });
  assert.equal(stillBlocked.reason, 'restricted');
  assert.equal(pool.db.links.find((row) => row.provider === 'discord' && row.external_id === DISCORD).source, 'sentinel-ownership-proof');
  const linked = await repository.linkVerifiedIdentity({
    discordUserId: DISCORD,
    eosId: EOS,
    verifiedAt: '2026-10-01T18:00:00.000Z',
    discordMembershipVerified: true
  });
  assert.equal(linked.ok, true, linked.reason || linked.eligibility);
  assert.equal(linked.economicIdentityId, econId);
  assert.equal(pool.db.identities.size, 1);
  assert.ok(pool.db.links.find((row) => row.provider === 'eos' && row.external_id === EOS));
  assert.deepEqual(pool.db.wallets.map((row) => row.currency), ['NEXUS_POINTS']);
  assert.equal(pool.db.ledger.length, 0);

  const removed = await points.unlink({ discordUserId: DISCORD });
  assert.equal(removed.ok, true, removed.reason);
  const cooled = await points.challenge({ discordUserId: DISCORD, mcUuid: UUID_2, mcName: 'Alex' });
  assert.equal(cooled.reason, 'unlink-cooldown');
  assert.equal(pool.db.identities.get(econId).status, 'verified');
  assert.ok(pool.db.links.find((row) => row.provider === 'eos'));
});

test('an ARK member who then links Minecraft keeps the same postgres wallet', async () => {
  const pool = economyPool();
  const repository = new NexusEconomyPostgresRuntimeRepository({ pool, schema: 'public' });
  const arkLinked = await repository.linkVerifiedIdentity({
    discordUserId: DISCORD_2,
    eosId: 'EOSBEFORE01',
    verifiedAt: '2026-10-01T17:00:00.000Z',
    discordMembershipVerified: true
  });
  assert.equal(arkLinked.status, 'verified');
  const points = pointsOn(pool);
  const confirmed = await (async () => {
    const challenge = await points.challenge({ discordUserId: DISCORD_2, mcUuid: UUID_2, mcName: 'Alex' });
    assert.equal(challenge.ok, true, challenge.reason);
    return points.confirm({ discordUserId: DISCORD_2, code: challenge.code });
  })();
  assert.equal(confirmed.ok, true, confirmed.reason);
  assert.equal(confirmed.economicIdentityId, arkLinked.economicIdentityId);
  assert.equal(pool.db.identities.size, 1);
  assert.equal(pool.db.wallets.filter((row) => row.currency === 'NEXUS_POINTS').length, 1);
  assert.equal(pool.db.ledger.length, 0);
  const ark = new PostgresArkShop({
    pool,
    env: { ARK_SHOP_ENABLED: 'true', MC_POINTS_ENABLED: 'true' },
    now: () => Date.parse('2026-10-01T18:00:00.000Z')
  });
  const quoted = await ark.quote({ discordUserId: DISCORD_2, sku: 'coastal' });
  assert.equal(quoted.ok, true, quoted.reason);
  assert.equal(quoted.quote.price > 0, true);
});

test('postgres holds are not elevated by a Minecraft confirm', async () => {
  const pool = economyPool();
  const disabledId = deterministicEconomicIdentityId(DISCORD);
  pool.db.identities.set(disabledId, { status: 'disabled', hold_reason: null, held_by: null });
  const points = pointsOn(pool);
  const disabled = await points.challenge({ discordUserId: DISCORD, mcUuid: UUID, mcName: 'Steve' });
  assert.equal(disabled.reason, 'account-hold');
  assert.equal(pool.db.identities.get(disabledId).status, 'disabled');
  assert.equal(pool.db.links.some((row) => row.provider === 'minecraft'), false);

  const markedPool = economyPool();
  const markedId = deterministicEconomicIdentityId(DISCORD_2);
  markedPool.db.identities.set(markedId, { status: 'restricted', hold_reason: 'staff', held_by: 'admin' });
  const marked = await pointsOn(markedPool).challenge({ discordUserId: DISCORD_2, mcUuid: UUID_2, mcName: 'Alex' });
  assert.equal(marked.reason, 'account-hold');
  assert.equal(markedPool.db.identities.get(markedId).status, 'restricted');
  assert.equal(markedPool.db.identities.get(markedId).hold_reason, 'staff');

  const deniedPool = economyPool();
  const deniedId = deterministicEconomicIdentityId(DISCORD);
  const denied = await pointsOn(deniedPool, memberEnv({ NEXUS_ECONOMY_QUARANTINE_DENYLIST: deniedId })).challenge({
    discordUserId: DISCORD,
    mcUuid: UUID,
    mcName: 'Steve'
  });
  assert.equal(denied.reason, 'account-hold');
  assert.equal(deniedPool.db.identities.get(deniedId).status, 'restricted');
  assert.equal(deniedPool.db.identities.get(deniedId).hold_reason, 'quarantine');
  assert.equal(deniedPool.db.links.some((row) => row.provider === 'eos'), false);
  assert.equal(deniedPool.db.ledger.length, 0);
});
