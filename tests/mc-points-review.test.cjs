'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createEconomyServer, presenceBody, FINANCIAL_WRITE_PATHS } = require('../src/economy-worker/server.cjs');
const crypto = require('node:crypto');
const { MemoryMcPoints, CODE_ALPHABET, LINK_REQUESTS_PER_HOUR, CODE_ATTEMPT_LIMIT, hashCode } = require('../src/economy-worker/mc-points-service.cjs');
const { PostgresEconomyAccrual } = require('../src/economy-worker/postgres-accrual.cjs');
const { NexusEconomyStore, NexusEconomyWorker } = require('../src/sentinel/nexus-economy-worker.cjs');
const { planMinecraftContribution, otherPresenceOnline, MC_DAILY_CAP_MS } = require('../src/economy-worker/mc-playtime-accounting.cjs');
const { parseGiveResponse } = require('../src/craft/mc-rcon-text.cjs');
const { verifyIdentityProof } = require('../src/sentinel/nexus-economy-identity-proof.cjs');
const { isMinecraftShopOrder } = require('../src/economy-worker/mc-points-service.cjs');
const { mcEarnEligible, mcPlaytimeEligible, UNLINK_COOLDOWN_MS, OFFLINE_BACKOFF_MS, leaseMsForOrder } = require('../src/economy-worker/mc-points-service.cjs');
const { writeVerifiedMinecraftLink, PostgresMcPoints } = require('../src/economy-worker/mc-points-postgres.cjs');
const { catalogFingerprint, loadMcShopCatalog } = require('../src/shared/mc-shop-catalog.cjs');
const { deliverMcOrder, runMcDeliveryCycle } = require('../src/craft/mc-delivery.cjs');

const UUID = '853c80ef-3c37-49fd-aa49-938b674adae6';
const UUID_2 = '22222222-2222-4222-8222-222222222222';
const DISCORD = '111111111111111111';
const DISCORD_2 = '222222222222222222';
const STAFF = '333333333333333333';
const SECRET = 'nexus-identity-proof-secret-32ch';
const LINK_SECRET = 'mc-link-code-hmac-secret-32chars!';

function wallet(balance = 1000) {
  return {
    calls: [],
    balanceValue: balance,
    async resolve(discordUserId) {
      return { economicIdentityId: `econ_${discordUserId}`, status: 'verified', verifiedAt: '2026-01-01T00:00:00.000Z' };
    },
    async balance() { return this.balanceValue; },
    async spend(input) {
      this.calls.push(input);
      if (this.balanceValue < input.amount) return { ok: false, reason: 'insufficient-funds', balance: this.balanceValue };
      this.balanceValue -= input.amount;
      return { ok: true, balance: this.balanceValue };
    },
    async credit(input) {
      this.calls.push(input);
      this.balanceValue += input.amount;
      return { ok: true, balance: this.balanceValue };
    },
    async lifetimeMs() { return 15 * 60 * 1000; },
    async quarantined() { return false; }
  };
}

function service(extra = {}) {
  let now = Date.parse('2026-10-01T18:00:00Z');
  const points = new MemoryMcPoints({
    now: () => now,
    wallet: extra.wallet || wallet(),
    env: {
      MC_POINTS_ENABLED: 'true',
      MC_SHOP_ENABLED: 'true',
      MC_SHOP_DELIVERY_ENABLED: 'true',
      MC_STARTER_KIT_ENABLED: 'true',
      NEXUS_ECONOMY_IDENTITY_PROOF_SECRET: SECRET,
      NEXUS_MC_REFUND_STAFF_IDS: STAFF,
      MC_LINK_CODE_SECRET: LINK_SECRET,
      ...(extra.env || {})
    },
    createOrderId: extra.createOrderId,
    tenureOf: extra.tenureOf
  });
  return { points, advance: (ms) => { now += ms; } };
}

async function link(points, discord, uuid) {
  const challenge = await points.challenge({ discordUserId: discord, mcUuid: uuid, mcName: 'Steve', requesterName: 'Ada' });
  assert.equal(challenge.ok, true, challenge.reason);
  const confirmed = await points.confirm({ discordUserId: discord, code: challenge.code });
  assert.equal(confirmed.ok, true, confirmed.reason);
  return confirmed;
}

test('presence copies an allow-list and ignores a body flags object', async () => {
  assert.deepEqual(presenceBody({ provider: 'minecraft', mcUuid: UUID, online: true, rankId: 'shadow-recruit', server: 'minecraft', flags: { dryRun: false }, dryRun: false, now: 0, afk: false }), {
    provider: 'minecraft',
    mcUuid: UUID,
    online: true,
    server: 'minecraft'
  });
  assert.deepEqual(presenceBody({ afk: true }).afk, true);
  assert.equal(presenceBody({ online: 1 }).online, false);
  const seen = [];
  const worker = {
    health: () => ({ ok: true }),
    recordPresence: async (input) => { seen.push(input); return { ok: false, reason: 'mc-points-disabled' }; },
    accrueOffline: async () => ({ ok: true })
  };
  const runtime = createEconomyServer({
    worker,
    shop: { listCatalog: () => [], pendingBuyOrders: () => [] },
    token: 'sentinal-token',
    craftToken: 'craft-token',
    writesEnabled: true,
    presenceWritesEnabled: true
  });
  await new Promise((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
  const port = runtime.server.address().port;
  try {
    const body = JSON.stringify({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft', rankId: 'origin-founder', flags: { pointsEnabled: true, dryRun: false }, dryRun: false, now: 1 });
    const response = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port,
        path: '/presence',
        method: 'POST',
        headers: { authorization: 'Bearer craft-token', 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
      }, (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
      });
      req.on('error', reject);
      req.end(body);
    });
    assert.equal(response.status, 200);
    assert.equal(seen[0].flags, undefined);
    assert.equal(seen[0].now, undefined);
    assert.equal(seen[0].rankId, undefined);
    assert.equal(seen[0].dryRun, undefined);
    assert.equal(seen[0].server, 'minecraft');
  } finally {
    await new Promise((resolve) => runtime.server.close(resolve));
  }
});

test('minecraft server names share one cap and overflow is dropped', () => {
  assert.equal(otherPresenceOnline({ 'minecraft-smp': { online: true, at: new Date().toISOString() }, ark: { online: false, at: new Date().toISOString() } }, Date.now()), '');
  const dayStart = Date.parse('2026-10-01T12:00:00Z');
  const planned = planMinecraftContribution({
    mcCountedDay: '2026-10-01',
    mcCountedMs: MC_DAILY_CAP_MS - 60_000,
    online: true,
    nowMs: dayStart,
    accountingGap: 5 * 60 * 1000,
    otherOnline: false
  });
  assert.equal(planned.gap, 60_000);
  assert.equal(planned.overflowDroppedMs, 4 * 60 * 1000);
  assert.equal(planned.mcCountedMs, MC_DAILY_CAP_MS);
  const nextDay = planMinecraftContribution({ ...planned, online: true, nowMs: dayStart + 24 * 60 * 60 * 1000, accountingGap: 60_000, otherOnline: false });
  assert.equal(nextDay.mcCountedMs, 60_000);
  assert.equal(nextDay.overflowDroppedMs, 0);
});

test('a crashed purchase rolls back the debit and a duplicate order id is rejected', async () => {
  const bank = wallet(100);
  const { points } = service({ wallet: bank });
  await link(points, DISCORD, UUID);
  const quoted = await points.quote({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1 });
  points.crashAt = 'after-ledger';
  const crashed = await points.buy({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1, nonce: quoted.quote.nonce, writesEnabled: true });
  assert.equal(crashed.reason, 'rolled-back');
  assert.equal(bank.balanceValue, 100);
  assert.equal(points.orders.size, 0);
  const paid = await points.buy({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1, nonce: quoted.quote.nonce, writesEnabled: true });
  assert.equal(paid.ok, true, paid.reason);
  const fixed = '99999999-9999-4999-8999-999999999999';
  const { points: second } = service({ wallet: wallet(500), createOrderId: () => fixed });
  await link(second, DISCORD, UUID);
  const firstQuote = await second.quote({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1 });
  assert.equal((await second.buy({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1, nonce: firstQuote.quote.nonce, writesEnabled: true })).ok, true);
  const nextQuote = await second.quote({ discordUserId: DISCORD, sku: 'mc_food32', bundles: 1 });
  const duplicate = await second.buy({ discordUserId: DISCORD, sku: 'mc_food32', bundles: 1, nonce: nextQuote.quote.nonce, writesEnabled: true });
  assert.equal(duplicate.reason, 'duplicate-order-id');
  assert.equal([...second.orders.keys()].length, 1);
});

test('final statuses and a lost lease do not change the order', async () => {
  const { points, advance } = service();
  await link(points, DISCORD, UUID);
  const quoted = await points.quote({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1 });
  const bought = await points.buy({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1, nonce: quoted.quote.nonce, writesEnabled: true });
  const claimed = points.claimNext();
  const wrong = points.markDelivery({ orderId: claimed.orderId, status: 'DELIVERED', expectedStatus: 'DELIVERY_IN_PROGRESS', leaseToken: 'lost' });
  assert.equal(wrong.reason, 'lease-lost');
  assert.equal(points.orders.get(claimed.orderId).status, 'DELIVERY_IN_PROGRESS');
  advance(61 * 1000);
  const expired = points.sweepExpiredLeases();
  assert.deepEqual(expired, [claimed.orderId]);
  assert.equal(points.orders.get(claimed.orderId).status, 'SENT_UNCONFIRMED');
  const staff = await points.refund({ orderId: claimed.orderId, reason: 'crate missing', actor: STAFF, writesEnabled: true });
  assert.equal(staff.ok, true, staff.reason);
  const again = await points.refund({ orderId: claimed.orderId, reason: 'crate missing', actor: STAFF, writesEnabled: true });
  assert.equal(again.duplicate, true);
  const delivered = points.orders.get(bought.order.orderId);
  delivered.status = 'DELIVERED';
  const illegal = points.markDelivery({ orderId: delivered.orderId, status: 'PLAYER_OFFLINE', expectedStatus: 'DELIVERED', leaseToken: 'x' });
  assert.equal(illegal.reason, 'final-status');
});

test('give replies match the count and ignore the display name', () => {
  assert.equal(parseGiveResponse('Gave 4 [minecraft:diamond] to [Team] Steve*', { count: 4, itemId: 'minecraft:diamond', name: 'Steve' }).outcome, 'delivered');
  assert.equal(parseGiveResponse('Gave 4 [minecraft:diamond] to Alex', { count: 4, itemId: 'minecraft:diamond', name: 'Steve' }).outcome, 'delivered');
  assert.equal(parseGiveResponse('Gave 3 [minecraft:diamond] to Steve', { count: 4, itemId: 'minecraft:diamond' }).outcome, 'unconfirmed');
  assert.equal(parseGiveResponse('No player was found', { count: 4, itemId: 'minecraft:diamond' }).outcome, 'unconfirmed');
  assert.equal(parseGiveResponse("Unknown item 'minecraft:diamond'", { count: 4, itemId: 'minecraft:diamond' }).outcome, 'unconfirmed');
  assert.equal(parseGiveResponse("Can't give more than 1 of [minecraft:diamond]", { count: 1, itemId: 'minecraft:diamond' }).outcome, 'unconfirmed');
});

test('a second identity cannot take a linked UUID and codes lock after five failures', async () => {
  const { points } = service();
  await link(points, DISCORD, UUID);
  const other = await points.challenge({ discordUserId: DISCORD_2, mcUuid: UUID, mcName: 'Steve' });
  assert.equal(other.ok, true, other.reason);
  const stolen = await points.confirm({ discordUserId: DISCORD_2, code: other.code });
  assert.equal(stolen.reason, 'uuid-taken');
  const fresh = await points.challenge({ discordUserId: DISCORD_2, mcUuid: UUID_2, mcName: 'Alex' });
  for (let attempt = 0; attempt < CODE_ATTEMPT_LIMIT; attempt += 1) {
    const failed = await points.confirm({ discordUserId: DISCORD_2, code: 'ZZZ-ZZZ' });
    assert.equal(failed.reason, attempt === CODE_ATTEMPT_LIMIT - 1 ? 'code-locked' : 'code-mismatch');
  }
  const locked = await points.confirm({ discordUserId: DISCORD_2, code: fresh.code });
  assert.equal(locked.reason, 'code-locked');
  assert.ok(CODE_ALPHABET.length ** 6 >= 2 ** 30);
  assert.equal(LINK_REQUESTS_PER_HOUR, 3);
});

test('the craft token cannot buy, credit, or refund', async () => {
  assert.equal(FINANCIAL_WRITE_PATHS.has('/mc-shop/buy'), true);
  assert.equal(FINANCIAL_WRITE_PATHS.has('/mc-shop/refund'), true);
  assert.equal(FINANCIAL_WRITE_PATHS.has('/mc-shop/refund-sweep'), true);
  const calls = [];
  const worker = {
    health: () => ({ ok: true }),
    credit: async () => { calls.push('credit'); return { ok: true }; },
    spend: async () => { calls.push('spend'); return { ok: true }; },
    adminCredit: async () => { calls.push('admin-credit'); return { ok: true }; },
    adminSpend: async () => { calls.push('admin-spend'); return { ok: true }; },
    linkArkIdentity: () => { calls.push('link'); return { ok: true }; },
    demoteIdentityToRestricted: () => { calls.push('demote'); return { ok: true }; },
    ensureShadowRecruitWallet: async () => { calls.push('ensure'); return { ok: true }; },
    minecraft: {
      buy: async () => { calls.push('buy'); return { ok: true }; },
      quote: async () => { calls.push('quote'); return { ok: true }; },
      refund: async () => { calls.push('refund'); return { ok: true }; },
      staffResend: async () => { calls.push('resend'); return { ok: true }; },
      staffResolve: async () => { calls.push('resolve'); return { ok: true }; },
      claimNext: async () => null,
      pendingOrders: async () => []
    }
  };
  const runtime = createEconomyServer({
    worker,
    shop: { listCatalog: () => [], pendingBuyOrders: () => [], quote: () => ({}) },
    token: 'sentinal-token',
    craftToken: 'craft-token',
    writesEnabled: true,
    presenceWritesEnabled: true
  });
  await new Promise((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
  const port = runtime.server.address().port;
  async function post(path, token) {
    const payload = Buffer.from('{}');
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port, path, method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': payload.length }
      }, (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw || '{}') }));
      });
      req.on('error', reject);
      req.end(payload);
    });
  }
  try {
    for (const path of ['/wallet/credit', '/wallet/spend', '/mc-shop/refund', '/identity/link', '/identity/demote-restricted', '/wallet/ensure-shadow-recruit', '/wallet/admin-credit', '/wallet/admin-spend', '/mc-shop/buy', '/mc-shop/quote', '/mc/staff/resend', '/mc/staff/resolve']) {
      const blocked = await post(path, 'craft-token');
      assert.equal(blocked.status, 403, path);
      assert.equal(blocked.body.error, 'craft-token-scope');
    }
    assert.deepEqual(calls, []);
    const pending = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/mc-shop/orders/pending', method: 'GET', headers: { authorization: 'Bearer craft-token' } }, (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(pending, 200);
  } finally {
    await new Promise((resolve) => runtime.server.close(resolve));
  }
});

test('the craft token can post minecraft presence only', async () => {
  const seen = [];
  const worker = {
    health: () => ({ ok: true }),
    recordPresence: async (input) => { seen.push(input); return { ok: true, credited: 0 }; }
  };
  const runtime = createEconomyServer({
    worker,
    shop: { listCatalog: () => [], pendingBuyOrders: () => [] },
    token: 'sentinal-token',
    craftToken: 'craft-token',
    writesEnabled: true,
    presenceWritesEnabled: true
  });
  await new Promise((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
  const port = runtime.server.address().port;
  async function post(token, payload) {
    const body = Buffer.from(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port,
        path: '/presence',
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': body.length }
      }, (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw || '{}') }));
      });
      req.on('error', reject);
      req.end(body);
    });
  }
  try {
    const minecraft = await post('craft-token', { provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft' });
    assert.equal(minecraft.status, 200);
    assert.equal(seen.at(-1).provider, 'minecraft');
    assert.equal(seen.at(-1).eosId, undefined);
    const uuidOnly = await post('craft-token', { mcUuid: UUID, online: true, server: 'minecraft' });
    assert.equal(uuidOnly.status, 200);
    for (const payload of [
      { provider: 'minecraft', mcUuid: UUID, eosId: 'eos-1', online: true, server: 'minecraft' },
      { provider: 'ark', eosId: 'eos-1', online: true, server: 'ark' },
      { provider: 'ARK', eosId: 'eos-1', online: true },
      { eosId: 'eos-1', online: true, server: 'ark' },
      { provider: 'rust', online: true },
      { online: true, server: 'ark' }
    ]) {
      const blocked = await post('craft-token', payload);
      assert.equal(blocked.status, 403, JSON.stringify(payload));
      assert.equal(blocked.body.error, 'craft-presence-scope');
    }
    assert.equal(seen.length, 2);
    const sentinal = await post('sentinal-token', { provider: 'ark', eosId: 'eos-1', online: true, server: 'ark' });
    assert.equal(sentinal.status, 200);
    assert.equal(seen.at(-1).provider, 'ark');
    assert.equal(seen.at(-1).eosId, 'eos-1');
  } finally {
    await new Promise((resolve) => runtime.server.close(resolve));
  }
});

test('minecraft playtime does not require EOS when the identity and link are verified', async () => {
  assert.equal(mcEarnEligible({ status: 'verified', verifiedAt: '2026-01-01' }, { verifiedAt: '2026-01-02', mcUuid: UUID }), true);
  assert.equal(mcEarnEligible({ status: 'verified', verifiedAt: '2026-01-01' }, null), false);
  assert.equal(mcEarnEligible({ status: 'restricted' }, { verifiedAt: '2026-01-02', mcUuid: UUID }), false);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-eos-'));
  let now = Date.parse('2026-10-01T16:00:00Z');
  const worker = new NexusEconomyWorker({
    store: new NexusEconomyStore(root),
    now: () => now,
    env: { MC_POINTS_ENABLED: 'true', MC_PLAYTIME_NP_ENABLED: 'true', MC_PLAYTIME_DRY_RUN: 'false', MC_LINK_CODE_SECRET: LINK_SECRET }
  });
  const state = worker.store.read();
  worker.ensureAccount(state, DISCORD, 'shadow-recruit');
  worker.store.write(state);
  const challenge = await worker.minecraft.challenge({ discordUserId: DISCORD, mcUuid: UUID, mcName: 'Steve' });
  assert.equal(challenge.ok, true, challenge.reason);
  assert.equal((await worker.minecraft.confirm({ discordUserId: DISCORD, code: challenge.code })).ok, true);
  await worker.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft-smp' });
  now += 5 * 60 * 1000;
  const credited = await worker.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft-smp' });
  assert.equal(credited.ok, true, credited.reason);
  assert.ok(credited.balance > 0);
  assert.equal(worker.store.read().eosToDiscord[UUID], undefined);
  const decision = fs.readFileSync(path.join(__dirname, '../docs/architecture/MC_POINTS_OWNER_DECISIONS_2026-10-01.md'), 'utf8');
  assert.match(decision, /pending WARDEN sign-off/);
  assert.match(decision, /remainder goes to SENT_UNCONFIRMED/);
  assert.equal(isMinecraftShopOrder({ source: 'mc-shop' }), true);
  assert.equal(isMinecraftShopOrder({ type: 'BUY', eosId: 'EOS' }), false);
});

test('link proof verifies with the ARK identity proof secret', async () => {
  const { points } = service();
  const confirmed = await link(points, DISCORD, UUID);
  const verified = verifyIdentityProof(confirmed.proof, { secret: SECRET, now: Date.parse('2026-10-01T18:00:00Z') });
  assert.equal(verified.eosId, UUID);
  assert.equal(verified.discordUserId, DISCORD);
});

test('staff cannot refund themselves, a delivered order, or without a reason', async () => {
  const { points } = service();
  await link(points, DISCORD, UUID);
  const quoted = await points.quote({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1 });
  const bought = await points.buy({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1, nonce: quoted.quote.nonce, writesEnabled: true });
  const claimed = points.claimNext();
  points.orders.get(claimed.orderId).status = 'SENT_UNCONFIRMED';
  points.orders.get(claimed.orderId).leaseToken = null;
  points.orders.get(claimed.orderId).leaseUntil = null;
  const self = await points.refund({ orderId: bought.order.orderId, reason: 'lost crate', actor: DISCORD, writesEnabled: true });
  assert.equal(self.reason, 'staff-not-authorized');
  const bare = await points.refund({ orderId: bought.order.orderId, reason: 'no', actor: STAFF, writesEnabled: true });
  assert.equal(bare.reason, 'refund-reason-required');
  const delivered = points.orders.get(bought.order.orderId);
  delivered.status = 'DELIVERED';
  const blocked = await points.refund({ orderId: delivered.orderId, reason: 'lost crate', actor: STAFF, writesEnabled: true });
  assert.equal(blocked.reason, 'final-status');
});

test('bundle quantity is stored and the diamond daily limit enforces it', async () => {
  const bank = wallet(5000);
  const { points } = service({ wallet: bank });
  await link(points, DISCORD, UUID);
  for (let index = 0; index < 2; index += 1) {
    const quoted = await points.quote({ discordUserId: DISCORD, sku: 'mc_diamond4', bundles: 1 });
    const bought = await points.buy({ discordUserId: DISCORD, sku: 'mc_diamond4', bundles: 1, nonce: quoted.quote.nonce, writesEnabled: true });
    assert.equal(bought.ok, true, bought.reason);
    assert.equal(bought.order.bundles, 1);
  }
  const quoted = await points.quote({ discordUserId: DISCORD, sku: 'mc_diamond4', bundles: 1 });
  const denied = await points.buy({ discordUserId: DISCORD, sku: 'mc_diamond4', bundles: 1, nonce: quoted.quote.nonce, writesEnabled: true });
  assert.equal(denied.reason, 'sku-daily-limit');
  assert.equal(bank.balanceValue, 5000 - 160);
});

test('audits record link, unlink, revoke, kit, resend, and resolve without codes or nonces', async () => {
  const { points } = service({ tenureOf: async () => Date.parse('2026-09-01T00:00:00Z') });
  const bare = new MemoryMcPoints({
    wallet: wallet(),
    now: () => Date.parse('2026-10-01T18:00:00Z'),
    env: { MC_POINTS_ENABLED: 'true' }
  });
  assert.equal((await bare.challenge({ discordUserId: DISCORD, mcUuid: UUID, mcName: 'Steve' })).reason, 'link-code-secret-missing');
  const challenge = await points.challenge({ discordUserId: DISCORD, mcUuid: UUID, mcName: 'Steve', requesterName: 'Ada' });
  const digest = hashCode(challenge.code, LINK_SECRET);
  assert.equal(points.challenges.get(DISCORD).codeHash, digest);
  assert.notEqual(digest, crypto.createHash('sha256').update(challenge.code).digest('hex'));
  assert.equal((await points.confirm({ discordUserId: DISCORD, code: challenge.code })).ok, true);
  points.links.get(UUID).playtimeMs = 15 * 60 * 1000;
  const claim = await points.claimStarterKit({ discordUserId: DISCORD, joinedAt: Date.now(), tenureTrusted: true });
  assert.equal(claim.ok, true, claim.reason);
  const quoted = await points.quote({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1 });
  const bought = await points.buy({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1, nonce: quoted.quote.nonce, writesEnabled: true });
  const order = points.orders.get(bought.order.orderId);
  order.status = 'DELIVERY_FAILED';
  order.leaseToken = null;
  const resent = await points.staffResend({ orderId: order.orderId, actor: STAFF, reason: 'crate lost' });
  assert.equal(resent.ok, true, resent.reason);
  resent.order.status = 'SENT_UNCONFIRMED';
  resent.order.lines[0].status = 'SENT_UNCONFIRMED';
  assert.equal((await points.staffResend({ orderId: order.orderId, actor: STAFF, reason: 'try again' })).reason, 'unconfirmed-no-retry');
  const resolved = await points.staffResolve({ orderId: order.orderId, actor: STAFF, reason: 'handed over', resolution: 'delivered' });
  assert.equal(resolved.ok, true, resolved.reason);
  const unlinked = await points.unlink({ discordUserId: DISCORD });
  assert.equal(unlinked.ok, true, unlinked.reason);
  const other = await points.challenge({ discordUserId: DISCORD_2, mcUuid: UUID_2, mcName: 'Alex' });
  await points.confirm({ discordUserId: DISCORD_2, code: other.code });
  const revoked = await points.unlink({ discordUserId: DISCORD_2, actor: STAFF, reason: 'staff-revoke' });
  assert.equal(revoked.ok, true, revoked.reason);
  const self = await points.unlink({ discordUserId: DISCORD_2 });
  assert.equal(self.reason, 'not-linked');
  const actions = points.actionAudits.map((row) => row.action);
  for (const action of ['link', 'kit-claim', 'resend', 'staff-resolve', 'staff-revoke', 'unlink']) {
    assert.equal(actions.includes(action), true, action);
  }
  const blob = JSON.stringify(points.actionAudits);
  assert.equal(blob.includes(challenge.code), false);
  assert.equal(blob.includes(quoted.quote.nonce), false);
  assert.equal(points.actionAudits.some((row) => Object.prototype.hasOwnProperty.call(row, 'code') || Object.prototype.hasOwnProperty.call(row, 'nonce')), false);
});

test('dry-run playtime update does not insert a ledger row', async () => {
  const queries = [];
  const accrual = new PostgresEconomyAccrual({
    env: { MC_POINTS_ENABLED: 'true', MC_PLAYTIME_NP_ENABLED: 'true', MC_PLAYTIME_DRY_RUN: 'true' },
    pool: {
      async query(sql) {
        queries.push(String(sql));
        if (String(sql).includes('SELECT') && String(sql).includes('nexus_mc_schema_version')) return { rows: [{ version: 1 }] };
        return { rows: [] };
      },
      async connect() {
        return {
          async query(sql) {
            queries.push(String(sql));
            const text = String(sql);
            if (text.includes('nexus_economic_identity_links')) {
              return { rows: [{ economic_identity_id: 'econ_1', discord_user_id: DISCORD, mc_uuid: UUID }] };
            }
            if (text.includes('SELECT') && text.includes('nexus_economy_accrual_state')) {
              return { rows: [{ rank_id: 'shadow-recruit', online: false, mc_online: false, mc_lifetime_ms: 0, mc_counted_ms: 0, presence_by_server: {} }] };
            }
            if (text.includes('nexus_mc_links')) return { rows: [{ playtime_ms: 0 }], rowCount: 1 };
            return { rows: [], rowCount: 1 };
          },
          release() {}
        };
      }
    }
  });
  const result = await accrual.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft' });
  assert.equal(result.dryRun, true);
  assert.equal(result.credited, 0);
  assert.equal(queries.some((sql) => /nexus_economy_ledger/i.test(sql)), false);
  assert.equal(queries.some((sql) => /UPDATE/i.test(sql) && /mc_lifetime_ms/i.test(sql)), true);
});

test('disabled minecraft master flag rejects posts before a database connection', async () => {
  const accrual = new PostgresEconomyAccrual({
    env: { MC_POINTS_ENABLED: 'false', MC_PLAYTIME_NP_ENABLED: 'true', MC_PLAYTIME_DRY_RUN: 'false' },
    pool: { async connect() { throw new Error('should not connect'); } }
  });
  const result = await accrual.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'not-minecraft', flags: { pointsEnabled: true, dryRun: false } });
  assert.equal(result.reason, 'mc-points-disabled');
});

async function buySku(points, sku) {
  const quoted = await points.quote({ discordUserId: DISCORD, sku, bundles: 1 });
  assert.equal(quoted.ok, true, quoted.reason);
  const bought = await points.buy({ discordUserId: DISCORD, sku, bundles: 1, nonce: quoted.quote.nonce, writesEnabled: true });
  assert.equal(bought.ok, true, bought.reason);
  return bought;
}

test('a refund wins over a late delivery and a stuck lease resolves through the sweep', async () => {
  const bank = wallet(1000);
  const { points, advance } = service({ wallet: bank });
  await link(points, DISCORD, UUID);
  const paid = await buySku(points, 'mc_iron64');
  const claimed = points.claimNext({ owner: 'nexus-craft' });
  assert.equal(claimed.status, 'DELIVERY_IN_PROGRESS');
  advance(61 * 1000);
  await points.sweepRefunds({ writesEnabled: true });
  assert.equal(points.orders.get(paid.order.orderId).status, 'SENT_UNCONFIRMED');
  const refunded = await points.refund({ orderId: paid.order.orderId, actor: STAFF, reason: 'late delivery', writesEnabled: true });
  assert.equal(refunded.ok, true, refunded.reason);
  assert.equal(points.orders.get(paid.order.orderId).status, 'REFUNDED');
  const commands = [];
  const late = await deliverMcOrder(points.orders.get(paid.order.orderId), {
    rcon: async (command) => { commands.push(command); return ''; },
    points,
    deliveryEnabled: true
  });
  assert.equal(late.skipped, 'no-retry');
  assert.equal(commands.some((command) => String(command).startsWith('give ')), false);

  const second = await buySku(points, 'mc_food32');
  points.claimNext({ owner: 'nexus-craft' });
  advance(61 * 1000);
  await points.sweepRefunds({ writesEnabled: true });
  assert.equal(points.orders.get(second.order.orderId).status, 'SENT_UNCONFIRMED');
  const resolved = await points.staffResolve({ orderId: second.order.orderId, actor: STAFF, reason: 'confirmed in game', resolution: 'delivered' });
  assert.equal(resolved.ok, true, resolved.reason);
  assert.equal(resolved.order.status, 'DELIVERED');
  const after = await deliverMcOrder(resolved.order, {
    rcon: async (command) => { commands.push(command); return ''; },
    points,
    deliveryEnabled: true
  });
  assert.equal(after.skipped, 'no-retry');
  assert.equal(commands.some((command) => String(command).startsWith('give ')), false);
});

test('half-finished-buy replay finishes one order without a second debit', async () => {
  const bank = wallet(90);
  let spends = 0;
  bank.spend = async () => {
    spends += 1;
    return { ok: true, duplicate: true, balance: bank.balanceValue };
  };
  const { points } = service({ wallet: bank });
  await link(points, DISCORD, UUID);
  const quoted = await points.quote({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1 });
  const first = await points.buy({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1, nonce: quoted.quote.nonce, writesEnabled: true });
  assert.equal(first.ok, true, first.reason);
  assert.equal(first.replayed, true);
  assert.equal(bank.balanceValue, 90);
  assert.equal(spends, 1);
  const second = await points.buy({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1, nonce: quoted.quote.nonce, writesEnabled: true });
  assert.equal(second.duplicate, true);
  assert.equal(spends, 1);
  assert.equal(points.orders.size, 1);
});

test('postgres minecraft resolve refuses a quarantined identity before any credit', async () => {
  const queries = [];
  const accrual = new PostgresEconomyAccrual({
    env: {
      MC_POINTS_ENABLED: 'true',
      MC_PLAYTIME_NP_ENABLED: 'true',
      MC_PLAYTIME_DRY_RUN: 'false',
      NEXUS_ECONOMY_QUARANTINE_DENYLIST: 'econ_q'
    },
    pool: {
      async query() { return { rows: [{ version: 1 }], rowCount: 1 }; },
      async connect() {
        return {
          async query(sql) {
            queries.push(String(sql));
            if (String(sql).includes('nexus_economic_identity_links')) {
              return { rows: [{ economic_identity_id: 'econ_q', discord_user_id: DISCORD, mc_uuid: UUID }] };
            }
            return { rows: [], rowCount: 0 };
          },
          release() {}
        };
      }
    }
  });
  const result = await accrual.recordPresence({
    provider: 'minecraft',
    mcUuid: UUID,
    online: true,
    rankId: 'origin-founder',
    server: 'minecraft',
    flags: { dryRun: false }
  });
  assert.equal(result.reason, 'quarantined');
  assert.equal(result.credited, 0);
  assert.equal(queries.some((sql) => /nexus_economy_ledger/i.test(sql)), false);
  assert.equal(queries.some((sql) => /SET rank_id/i.test(sql)), false);
});

test('quarantine blocks minecraft earn and shop spend', async () => {
  const bank = wallet(500);
  let blocked = false;
  bank.quarantined = async () => blocked;
  const { points } = service({ wallet: bank });
  await link(points, DISCORD, UUID);
  const quoted = await points.quote({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1 });
  assert.equal(quoted.ok, true, quoted.reason);
  blocked = true;
  const denied = await points.buy({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1, nonce: quoted.quote.nonce, writesEnabled: true });
  assert.equal(denied.reason, 'quarantined');
  assert.equal(bank.balanceValue, 500);
  const again = await points.quote({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1 });
  assert.equal(again.reason, 'quarantined');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-quarantine-'));
  const worker = new NexusEconomyWorker({
    store: new NexusEconomyStore(root),
    env: {
      MC_POINTS_ENABLED: 'true',
      MC_PLAYTIME_NP_ENABLED: 'true',
      MC_PLAYTIME_DRY_RUN: 'false',
      MC_LINK_CODE_SECRET: LINK_SECRET,
      NEXUS_ECONOMY_QUARANTINE_DENYLIST: DISCORD
    }
  });
  const state = worker.store.read();
  worker.ensureAccount(state, DISCORD, 'cipher-runner');
  worker.store.write(state);
  const challenge = await worker.minecraft.challenge({ discordUserId: DISCORD, mcUuid: UUID, mcName: 'Steve' });
  assert.equal((await worker.minecraft.confirm({ discordUserId: DISCORD, code: challenge.code })).ok, true);
  const earned = await worker.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, rankId: 'origin-founder', server: 'minecraft' });
  assert.equal(earned.reason, 'quarantined');
  assert.equal(worker.wallet(DISCORD).balance, 0);
  assert.equal(worker.wallet(DISCORD).rankId, 'cipher-runner');
});

test('shop orders get unique ids', async () => {
  const { points } = service({ wallet: wallet(500) });
  await link(points, DISCORD, UUID);
  const first = await buySku(points, 'mc_logs64');
  const second = await buySku(points, 'mc_food32');
  assert.notEqual(first.order.orderId, second.order.orderId);
  assert.match(first.order.orderId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(points.orders.size, 2);
});

test('an async delivery client is awaited and dry-run sends no give', async () => {
  const commands = [];
  const dry = await runMcDeliveryCycle({
    env: { MC_POINTS_ENABLED: 'true', MC_SHOP_DELIVERY_ENABLED: 'true', MC_PLAYTIME_DRY_RUN: 'true' },
    rcon: async (command) => { commands.push(command); return 'Gave 1 [minecraft:stick] to Steve'; },
    points: { claimNext: async () => { throw new Error('dry-run must not claim'); } }
  });
  assert.equal(dry[0].skipped, 'dry-run');
  assert.equal(commands.length, 0);

  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let settled = false;
  const cycle = runMcDeliveryCycle({
    env: { MC_POINTS_ENABLED: 'true', MC_SHOP_ENABLED: 'true', MC_SHOP_DELIVERY_ENABLED: 'true', MC_PLAYTIME_DRY_RUN: 'false' },
    rcon: async (command) => { commands.push(command); return ''; },
    points: {
      sweepExpiredLeases: async () => {},
      claimNext: async () => {
        await gate;
        return null;
      }
    }
  });
  cycle.then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  release();
  const results = await cycle;
  assert.equal(results.at(-1).skipped, 'none-pending');
  assert.equal(commands.some((command) => String(command).startsWith('give ')), false);
});

test('the same playtime window credits once and ignores a body rank', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-race-'));
  let now = Date.parse('2026-10-01T16:00:00Z');
  const worker = new NexusEconomyWorker({
    store: new NexusEconomyStore(root),
    now: () => now,
    env: { MC_POINTS_ENABLED: 'true', MC_PLAYTIME_NP_ENABLED: 'true', MC_PLAYTIME_DRY_RUN: 'false', MC_LINK_CODE_SECRET: LINK_SECRET }
  });
  worker.linkArkIdentity({ discordUserId: DISCORD, eosId: 'EOSsharedrace1', rankId: 'cipher-runner' });
  const challenge = await worker.minecraft.challenge({ discordUserId: DISCORD, mcUuid: UUID, mcName: 'Steve' });
  assert.equal((await worker.minecraft.confirm({ discordUserId: DISCORD, code: challenge.code })).ok, true);
  await worker.recordPresence({ eosId: 'EOSsharedrace1', online: true, server: 'ark' });
  now += 5 * 60 * 1000;
  await Promise.all([
    worker.recordPresence({ eosId: 'EOSsharedrace1', online: true, server: 'ark' }),
    worker.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft', rankId: 'origin-founder' })
  ]);
  const account = worker.wallet(DISCORD);
  assert.equal(account.rankId, 'cipher-runner');
  assert.equal(account.balance, 4);
  const keys = Object.keys(worker.store.read().processed).filter((key) => key.startsWith('playtime:'));
  assert.equal(keys.length, 1);
});

test('afk detection does not pay the first five minutes and daily limits follow the economic identity', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-afk-pay-'));
  let now = Date.parse('2026-10-01T16:00:00Z');
  const worker = new NexusEconomyWorker({
    store: new NexusEconomyStore(root),
    now: () => now,
    env: { MC_POINTS_ENABLED: 'true', MC_PLAYTIME_NP_ENABLED: 'true', MC_PLAYTIME_DRY_RUN: 'false', MC_SHOP_ENABLED: 'true', MC_LINK_CODE_SECRET: LINK_SECRET }
  });
  const state = worker.store.read();
  worker.ensureAccount(state, DISCORD, 'shadow-recruit');
  worker.store.write(state);
  const challenge = await worker.minecraft.challenge({ discordUserId: DISCORD, mcUuid: UUID, mcName: 'Steve' });
  assert.equal((await worker.minecraft.confirm({ discordUserId: DISCORD, code: challenge.code })).ok, true);
  await worker.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft' });
  now += 4 * 60 * 1000;
  await worker.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft' });
  now += 60 * 1000;
  const afk = await worker.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: false, afk: true, server: 'minecraft' });
  assert.equal(afk.balance, 0);
  assert.equal(worker.wallet(DISCORD).balance, 0);

  const bank = wallet(5000);
  const { points } = service({ wallet: bank });
  await link(points, DISCORD, UUID);
  points.orders.set('manual-diamond', {
    orderId: 'manual-diamond',
    source: 'mc-shop',
    discordUserId: DISCORD_2,
    economicIdentityId: `econ_${DISCORD}`,
    sku: 'mc_diamond4',
    bundles: 2,
    price: 160,
    status: 'PAID',
    createdAt: new Date(points.now()).toISOString(),
    lines: []
  });
  const quoted = await points.quote({ discordUserId: DISCORD, sku: 'mc_diamond4', bundles: 1 });
  const limited = await points.buy({ discordUserId: DISCORD, sku: 'mc_diamond4', bundles: 1, nonce: quoted.quote.nonce, writesEnabled: true });
  assert.equal(limited.reason, 'sku-daily-limit');
});

test('GET /mc-shop/catalog returns the catalog and a non-positive qty is rejected', async () => {
  const runtime = createEconomyServer({
    worker: { health: () => ({ ok: true }) },
    shop: { listCatalog: () => [], pendingBuyOrders: () => [] },
    token: 'sentinal-token',
    craftToken: 'craft-token'
  });
  await new Promise((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
  const port = runtime.server.address().port;
  const get = (token) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/mc-shop/catalog', method: 'GET', headers: { authorization: `Bearer ${token}` } }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    });
    req.on('error', reject);
    req.end();
  });
  try {
    const catalog = await get('sentinal-token');
    assert.equal(catalog.status, 200);
    assert.equal(catalog.body.ok, true);
    assert.equal(catalog.body.catalog.items.length, 14);
    assert.equal(catalog.body.enabled, false);
    const craft = await get('craft-token');
    assert.equal(craft.status, 403);
  } finally {
    await new Promise((resolve) => runtime.server.close(resolve));
  }
  const bank = wallet(100);
  const { points } = service({ wallet: bank });
  await link(points, DISCORD, UUID);
  points.catalog = {
    version: '2026-10-01',
    items: [{ sku: 'mc_logs64', itemId: 'minecraft:oak_log', qty: 0, price: 10, name: 'Oak', dailyLimit: null, active: true }]
  };
  const quoted = await points.quote({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1 });
  assert.equal(quoted.reason, 'invalid-qty');
});

test('rcon failure before give requeues with backoff and a failed status update stops the loop', async () => {
  const { points, advance } = service();
  await link(points, DISCORD, UUID);
  const quoted = await points.quote({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1 });
  const bought = await points.buy({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1, nonce: quoted.quote.nonce, writesEnabled: true });
  const claimed = points.claimNext();
  assert.equal(leaseMsForOrder(claimed), 60 * 1000);
  assert.equal(leaseMsForOrder({ lines: [{ status: 'PENDING' }, { status: 'PENDING' }] }), 120 * 1000);
  const failed = await deliverMcOrder(claimed, {
    points,
    deliveryEnabled: true,
    rcon: async () => { throw new Error('connection reset'); }
  });
  assert.equal(failed.status, 'PLAYER_OFFLINE');
  assert.equal(failed.requeued, true);
  assert.equal(points.orders.get(bought.order.orderId).status, 'PLAYER_OFFLINE');
  assert.notEqual(points.orders.get(bought.order.orderId).status, 'SENT_UNCONFIRMED');
  assert.equal(points.claimNext(), null);
  advance(OFFLINE_BACKOFF_MS);
  const again = points.claimNext();
  assert.equal(again.orderId, bought.order.orderId);
  const partial = points.orders.get(again.orderId);
  partial.lines[0].status = 'DELIVERED';
  const afterGive = await deliverMcOrder(partial, {
    points,
    deliveryEnabled: true,
    rcon: async () => { throw new Error('connection reset'); }
  });
  assert.equal(afterGive.status, 'SENT_UNCONFIRMED');

  let claims = 0;
  const cycle = await runMcDeliveryCycle({
    env: { MC_POINTS_ENABLED: 'true', MC_SHOP_DELIVERY_ENABLED: 'true', MC_PLAYTIME_DRY_RUN: 'false' },
    rcon: async () => 'There are 0 of a max of 20 players online:',
    points: {
      sweepExpiredLeases: async () => {},
      claimNext: async () => {
        claims += 1;
        return {
          orderId: `order-${claims}`,
          status: 'DELIVERY_IN_PROGRESS',
          leaseToken: 'lease',
          mcUuid: UUID,
          catalogVersion: 'atm10-aeronautics-0.6.1',
          catalogHash: 'mismatch',
          lines: [{ itemId: 'minecraft:oak_log', count: 64, status: 'PENDING' }]
        };
      },
      markDelivery: async () => ({ ok: false, reason: 'lease-lost' })
    }
  });
  assert.equal(claims, 1);
  assert.equal(cycle.at(-1).statusUpdateFailed, true);
  assert.equal(cycle.at(-1).reason, 'lease-lost');

  const nextQuote = await points.quote({ discordUserId: DISCORD, sku: 'mc_food32', bundles: 1 });
  const nextPaid = await points.buy({ discordUserId: DISCORD, sku: 'mc_food32', bundles: 1, nonce: nextQuote.quote.nonce, writesEnabled: true });
  const leased = points.claimNext();
  assert.equal(leased.orderId, nextPaid.order.orderId);
  const heldUntil = Date.parse(leased.leaseUntil);
  advance(5_000);
  const renewed = points.markDelivery({
    orderId: leased.orderId,
    status: 'DELIVERY_IN_PROGRESS',
    expectedStatus: 'DELIVERY_IN_PROGRESS',
    leaseToken: leased.leaseToken,
    lineIndex: 0,
    lineStatus: 'DELIVERED'
  });
  assert.equal(renewed.ok, true, renewed.reason);
  assert.ok(Date.parse(renewed.order.leaseUntil) > heldUntil);
});

test('the same player can relink an unlinked UUID', async () => {
  const { points, advance } = service();
  await link(points, DISCORD, UUID);
  const removed = await points.unlink({ discordUserId: DISCORD });
  assert.equal(removed.ok, true, removed.reason);
  advance(UNLINK_COOLDOWN_MS + 1000);
  const again = await points.challenge({ discordUserId: DISCORD, mcUuid: UUID, mcName: 'Steve' });
  assert.equal(again.ok, true, again.reason);
  const confirmed = await points.confirm({ discordUserId: DISCORD, code: again.code });
  assert.equal(confirmed.ok, true, confirmed.reason);
  assert.ok(points.links.get(UUID).verifiedAt);

  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push(String(sql));
      if (String(sql).includes('INSERT INTO') && String(sql).includes('nexus_economic_identity_links')) return { rowCount: 0, rows: [] };
      if (String(sql).includes('SELECT')) return { rowCount: 1, rows: [{ economic_identity_id: 'econ_same', verified_at: null }] };
      return { rowCount: 1, rows: [] };
    }
  };
  const relinked = await writeVerifiedMinecraftLink(client, 'public', {
    mcUuid: UUID,
    economicIdentityId: 'econ_same',
    verifiedAt: '2026-10-01T18:00:00.000Z'
  });
  assert.equal(relinked.relinked, true);
  assert.equal(calls.some((sql) => /UPDATE/.test(sql) && /verified_at = \$3/.test(sql)), true);
  await assert.rejects(
    () => writeVerifiedMinecraftLink({
      async query(sql) {
        if (String(sql).includes('INSERT')) return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [{ economic_identity_id: 'econ_other', verified_at: null }] };
      }
    }, 'public', { mcUuid: UUID, economicIdentityId: 'econ_same', verifiedAt: '2026-10-01T18:00:00.000Z' }),
    (error) => error.code === 'uuid-taken'
  );
});

test('a verified minecraft link earns without EOS and quarantine still blocks', async () => {
  assert.equal(mcPlaytimeEligible({ status: 'verified', verifiedAt: '2026-01-01' }, { verifiedAt: '2026-01-02', mcUuid: UUID }), true);
  assert.equal(mcPlaytimeEligible({ status: 'verified' }, { verifiedAt: '2026-01-02', mcUuid: UUID }), false);
  assert.equal(mcPlaytimeEligible({ status: 'restricted' }, { verifiedAt: '2026-01-02', mcUuid: UUID }), false);
  assert.equal(mcPlaytimeEligible({ status: 'disabled' }, { verifiedAt: '2026-01-02', mcUuid: UUID }), false);
  assert.equal(mcPlaytimeEligible({ status: 'restricted' }, null), false);
  assert.equal(mcEarnEligible({ status: 'restricted' }, { verifiedAt: '2026-01-02', mcUuid: UUID }), false);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-eosless-'));
  let now = Date.parse('2026-10-01T16:00:00Z');
  const worker = new NexusEconomyWorker({
    store: new NexusEconomyStore(root),
    now: () => now,
    env: { MC_POINTS_ENABLED: 'true', MC_PLAYTIME_NP_ENABLED: 'true', MC_PLAYTIME_DRY_RUN: 'false', MC_SHOP_ENABLED: 'true', MC_LINK_CODE_SECRET: LINK_SECRET }
  });
  const state = worker.store.read();
  worker.ensureAccount(state, DISCORD, 'shadow-recruit');
  worker.store.write(state);
  const challenge = await worker.minecraft.challenge({ discordUserId: DISCORD, mcUuid: UUID, mcName: 'Steve' });
  assert.equal((await worker.minecraft.confirm({ discordUserId: DISCORD, code: challenge.code })).ok, true);
  assert.equal(worker.store.read().eosToDiscord[UUID], undefined);
  await worker.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft' });
  now += 5 * 60 * 1000;
  const earned = await worker.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft' });
  assert.equal(earned.ok, true, earned.reason);
  assert.ok(earned.balance > 0);
  const linked = worker.store.read();
  linked.accounts[DISCORD].status = 'restricted';
  worker.store.write(linked);
  const denied = await worker.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft' });
  assert.equal(denied.reason, 'unlinked-player');
  const shop = await worker.minecraft.quote({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1 });
  assert.equal(shop.reason, 'verified-identity-required');

  const queries = [];
  const accrual = new PostgresEconomyAccrual({
    env: { MC_POINTS_ENABLED: 'true', MC_PLAYTIME_NP_ENABLED: 'true', MC_PLAYTIME_DRY_RUN: 'false' },
    now: () => Date.parse('2026-10-01T18:00:00.000Z'),
    pool: minecraftEarnPool(queries, { economic_identity_id: 'econ_mc_only', discord_user_id: DISCORD, mc_uuid: UUID })
  });
  const credited = await accrual.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft' });
  assert.equal(credited.ok, true, credited.reason);
  assert.equal(credited.balance, 2);
  const resolveSql = queries.find((sql) => sql.includes("provider = 'minecraft'"));
  assert.match(resolveSql, /m\.verified_at IS NOT NULL/);
  assert.match(resolveSql, /d\.provider = 'discord' AND d\.verified_at IS NOT NULL/);
  assert.match(resolveSql, /i\.status = 'verified'/);
  assert.doesNotMatch(resolveSql, /provider = 'eos'/);
  assert.doesNotMatch(resolveSql, /i\.status IN \('verified', 'restricted'\)/);
  assert.doesNotMatch(resolveSql, /LEFT JOIN/);
  assert.equal(queries.some((sql) => /INSERT INTO/.test(sql) && /nexus_economy_ledger/.test(sql)), true);

  const blockedQueries = [];
  const blocked = new PostgresEconomyAccrual({
    env: {
      MC_POINTS_ENABLED: 'true',
      MC_PLAYTIME_NP_ENABLED: 'true',
      MC_PLAYTIME_DRY_RUN: 'false',
      NEXUS_ECONOMY_QUARANTINE_DENYLIST: 'econ_mc_only'
    },
    now: () => Date.parse('2026-10-01T18:00:00.000Z'),
    pool: minecraftEarnPool(blockedQueries, { economic_identity_id: 'econ_mc_only', discord_user_id: DISCORD, mc_uuid: UUID })
  });
  const quarantined = await blocked.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft' });
  assert.equal(quarantined.reason, 'quarantined');
  assert.equal(blockedQueries.some((sql) => /nexus_economy_ledger/.test(sql)), false);
});

test('quote loads the link table and skips the other minecraft tables', async () => {
  const queries = [];
  const points = new PostgresMcPoints({
    env: { MC_POINTS_ENABLED: 'true', MC_SHOP_ENABLED: 'true', MC_LINK_CODE_SECRET: LINK_SECRET },
    now: () => Date.parse('2026-10-01T18:00:00.000Z'),
    wallet: {
      async resolve() {
        return { economicIdentityId: 'econ_1', status: 'verified', verifiedAt: '2026-01-01T00:00:00.000Z' };
      },
      async balance() { return 100; },
      async quarantined() { return false; }
    },
    pool: {
      async query(sql) {
        queries.push(String(sql));
        if (String(sql).includes('nexus_mc_schema_version') && String(sql).includes('SELECT')) return { rows: [{ version: 1 }] };
        if (String(sql).includes('nexus_economic_identities')) {
          return { rows: [{ economic_identity_id: 'econ_1', status: 'verified', verified_at: '2026-01-01T00:00:00.000Z' }] };
        }
        return { rows: [], rowCount: 1 };
      },
      async connect() {
        return {
          async query(sql) {
            queries.push(String(sql));
            if (String(sql).includes('nexus_mc_links')) {
              return {
                rows: [{
                  mc_uuid: UUID,
                  economic_identity_id: 'econ_1',
                  discord_user_id: DISCORD,
                  verified_at: '2026-01-02T00:00:00.000Z',
                  unlinked_at: null,
                  cooldown_until: null,
                  playtime_ms: 0,
                  proof: null
                }]
              };
            }
            return { rows: [], rowCount: 1 };
          },
          release() {}
        };
      }
    }
  });
  const quoted = await points.quote({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1 });
  assert.equal(quoted.ok, true, quoted.reason);
  assert.equal(queries.some((sql) => sql.includes('nexus_mc_links')), true);
  for (const table of ['nexus_mc_orders', 'nexus_mc_link_challenges', 'nexus_mc_grants', 'nexus_mc_refund_audit', 'nexus_mc_link_requests']) {
    assert.equal(queries.some((sql) => sql.includes(table)), false, table);
  }
});

function minecraftEarnPool(queries, identity) {
  const answered = {
    async query(sql) {
      queries.push(String(sql));
      const text = String(sql);
      if (text.includes('nexus_mc_schema_version') && text.includes('SELECT')) return { rows: [{ version: 1 }] };
      if (text.includes("provider = 'minecraft'")) return { rows: [identity] };
      if (text.includes('SELECT *') && text.includes('nexus_economy_accrual_state')) {
        return {
          rows: [{
            rank_id: 'shadow-recruit',
            online: true,
            online_uncredited_ms: 0,
            online_credit_cursor: 0,
            last_accounting_at: '2026-10-01T17:55:00.000Z',
            last_presence_at: '2026-10-01T17:59:00.000Z',
            offline_since: null,
            last_passive_at: '2026-10-01T17:00:00.000Z',
            passive_credit_cursor: 0,
            presence_by_server: { minecraft: { online: true, at: '2026-10-01T17:59:00.000Z' } },
            mc_counted_ms: 0,
            mc_lifetime_ms: 0,
            mc_online: true,
            last_mc_online_at: '2026-10-01T17:55:00.000Z'
          }]
        };
      }
      if (text.includes('SELECT balance')) return { rows: [{ balance: 0 }] };
      if (text.includes('nexus_economy_ledger')) return { rows: [{ id: 1 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {}
  };
  return {
    async query(sql) { return answered.query(sql); },
    async connect() { return answered; }
  };
}

test('postgres buy locks the identity before the daily spend, order, and item caps', async () => {
  const now = Date.parse('2026-10-01T18:00:00.000Z');
  const today = '2026-10-01T17:00:00.000Z';
  const yesterday = '2026-09-30T18:00:00.000Z';
  const catalog = loadMcShopCatalog();
  const catalogHash = catalogFingerprint(catalog);
  const env = { MC_SHOP_ENABLED: 'true' };

  function shop(pool) {
    return new PostgresMcPoints({
      env,
      now: () => now,
      wallet: { async balance() { return 0; } },
      pool
    });
  }

  const open = shopBuyPool({ balance: 100000 });
  const first = await shop(open.pool).buy({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1, nonce: 'logs-1', writesEnabled: true });
  assert.equal(first.ok, true, first.reason);
  assert.equal(open.committed.wallets.get('econ_shop'), 99990);
  const lockAt = open.sqlLog.findIndex((sql) => sql.includes('pg_advisory_xact_lock'));
  const scanAt = open.sqlLog.findIndex((sql) => sql.includes("order_data->>'economicIdentityId'") && sql.includes("order_data->>'source' = 'mc-shop'"));
  assert.ok(lockAt >= 0 && scanAt > lockAt);

  const cappedOrders = shopBuyPool({
    balance: 100000,
    orders: Array.from({ length: 10 }, (_, index) => shopOrder({ nonce: `cap-${index}`, sku: 'mc_logs64', bundles: 1, price: 10, createdAt: today }))
  });
  const orderLimited = await shop(cappedOrders.pool).buy({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1, nonce: 'logs-11', writesEnabled: true });
  assert.equal(orderLimited.reason, 'daily-order-limit');
  assert.equal(cappedOrders.committed.orders.length, 10);
  assert.equal(cappedOrders.committed.wallets.get('econ_shop'), 100000);

  const yesterdayOnly = shopBuyPool({
    balance: 100000,
    orders: Array.from({ length: 10 }, (_, index) => shopOrder({ nonce: `yday-${index}`, sku: 'mc_logs64', bundles: 1, price: 10, createdAt: yesterday }))
  });
  const nextDay = await shop(yesterdayOnly.pool).buy({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1, nonce: 'logs-next-day', writesEnabled: true });
  assert.equal(nextDay.ok, true, nextDay.reason);

  const refunded = shopBuyPool({
    balance: 100000,
    orders: Array.from({ length: 10 }, (_, index) => shopOrder({ nonce: `refund-${index}`, sku: 'mc_logs64', bundles: 1, price: 10, createdAt: today, status: 'REFUNDED' }))
  });
  const afterRefund = await shop(refunded.pool).buy({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1, nonce: 'logs-after-refund', writesEnabled: true });
  assert.equal(afterRefund.ok, true, afterRefund.reason);

  const spent = shopBuyPool({
    balance: 100000,
    orders: Array.from({ length: 4 }, (_, index) => shopOrder({ nonce: `brass-${index}`, sku: 'mc_brass32', bundles: 5, price: 350, createdAt: today }))
  });
  const spendLimited = await shop(spent.pool).buy({ discordUserId: DISCORD, sku: 'mc_brass32', bundles: 5, nonce: 'brass-5', writesEnabled: true });
  assert.equal(spendLimited.reason, 'daily-spend-limit');
  assert.equal(spent.committed.wallets.get('econ_shop'), 100000);
  const stillUnder = await shop(spent.pool).buy({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1, nonce: 'logs-under-spend', writesEnabled: true });
  assert.equal(stillUnder.ok, true, stillUnder.reason);

  const diamonds = shopBuyPool({
    balance: 100000,
    orders: [shopOrder({ nonce: 'diamond-held', sku: 'mc_diamond4', bundles: 2, price: 160, createdAt: today })]
  });
  const skuLimited = await shop(diamonds.pool).buy({ discordUserId: DISCORD, sku: 'mc_diamond4', bundles: 1, nonce: 'diamond-3', writesEnabled: true });
  assert.equal(skuLimited.reason, 'sku-daily-limit');

  const race = shopBuyPool({ balance: 100000, quotes: [
    quoteRow({ nonce: 'race-a', sku: 'mc_diamond4', bundles: 2, price: 160, itemId: 'minecraft:diamond', catalogHash }),
    quoteRow({ nonce: 'race-b', sku: 'mc_diamond4', bundles: 2, price: 160, itemId: 'minecraft:diamond', catalogHash })
  ] });
  const raced = await Promise.all([
    shop(race.pool).buy({ discordUserId: DISCORD, sku: 'mc_diamond4', bundles: 2, nonce: 'race-a', writesEnabled: true }),
    shop(race.pool).buy({ discordUserId: DISCORD, sku: 'mc_diamond4', bundles: 2, nonce: 'race-b', writesEnabled: true })
  ]);
  const paid = raced.filter((result) => result.ok);
  const blocked = raced.filter((result) => result.reason === 'sku-daily-limit');
  assert.equal(paid.length, 1);
  assert.equal(blocked.length, 1);
  assert.equal(race.committed.orders.length, 1);
  assert.equal(race.committed.wallets.get('econ_shop'), 99840);
  assert.equal(catalog.items.find((item) => item.sku === 'mc_diamond4').dailyLimit, 2);
});

function quoteRow({ nonce, sku, bundles, price, itemId, catalogHash }) {
  return {
    nonce,
    discord_user_id: DISCORD,
    economic_identity_id: 'econ_shop',
    mc_uuid: UUID,
    sku,
    bundles,
    qty: 1,
    price,
    item_id: itemId,
    catalog_version: 'atm10-aeronautics-0.6.1',
    catalog_hash: catalogHash,
    signature: '',
    expires_at: '2026-10-01T19:00:00.000Z',
    consumed_at: null
  };
}

function shopOrder({ nonce, sku, bundles, price, createdAt, status = 'PAID' }) {
  return {
    order_id: nonce,
    nonce,
    status,
    price,
    created_at: createdAt,
    order_data: {
      orderId: nonce,
      nonce,
      economicIdentityId: 'econ_shop',
      sku,
      bundles,
      price,
      source: 'mc-shop',
      status,
      createdAt
    }
  };
}

function shopBuyPool({ quotes = [], orders = [], balance = 100000 } = {}) {
  const catalog = loadMcShopCatalog();
  const catalogHash = catalogFingerprint(catalog);
  const defaultQuotes = [
    quoteRow({ nonce: 'logs-1', sku: 'mc_logs64', bundles: 1, price: 10, itemId: 'minecraft:oak_log', catalogHash }),
    quoteRow({ nonce: 'logs-11', sku: 'mc_logs64', bundles: 1, price: 10, itemId: 'minecraft:oak_log', catalogHash }),
    quoteRow({ nonce: 'logs-next-day', sku: 'mc_logs64', bundles: 1, price: 10, itemId: 'minecraft:oak_log', catalogHash }),
    quoteRow({ nonce: 'logs-after-refund', sku: 'mc_logs64', bundles: 1, price: 10, itemId: 'minecraft:oak_log', catalogHash }),
    quoteRow({ nonce: 'logs-under-spend', sku: 'mc_logs64', bundles: 1, price: 10, itemId: 'minecraft:oak_log', catalogHash }),
    quoteRow({ nonce: 'brass-5', sku: 'mc_brass32', bundles: 5, price: 350, itemId: 'create:brass_ingot', catalogHash }),
    quoteRow({ nonce: 'diamond-3', sku: 'mc_diamond4', bundles: 1, price: 80, itemId: 'minecraft:diamond', catalogHash })
  ];
  const committed = {
    quotes: new Map([...defaultQuotes, ...quotes].map((row) => [row.nonce, { ...row }])),
    orders: orders.map((row) => ({ ...row, order_data: { ...row.order_data } })),
    wallets: new Map([['econ_shop', balance]]),
    ledger: new Set()
  };
  const locks = new Map();
  const sqlLog = [];

  function acquire(key) {
    return new Promise((resolve) => {
      const entry = locks.get(key) || { locked: false, queue: [] };
      locks.set(key, entry);
      if (!entry.locked) {
        entry.locked = true;
        resolve();
        return;
      }
      entry.queue.push(resolve);
    });
  }

  function release(key) {
    const entry = locks.get(key);
    if (!entry) return;
    const next = entry.queue.shift();
    if (next) next();
    else entry.locked = false;
  }

  function connect() {
    const pending = { orders: [], ledger: [], wallet: null, consumed: [] };
    let lockKey = null;
    return {
      async query(sql, params = []) {
        const text = String(sql);
        sqlLog.push(text);
        if (text === 'BEGIN') return { rows: [], rowCount: 0 };
        if (text === 'ROLLBACK') {
          if (lockKey) release(lockKey);
          lockKey = null;
          return { rows: [], rowCount: 0 };
        }
        if (text === 'COMMIT') {
          committed.orders.push(...pending.orders);
          for (const key of pending.ledger) committed.ledger.add(key);
          if (pending.wallet) committed.wallets.set(pending.wallet.id, pending.wallet.balance);
          for (const nonce of pending.consumed) {
            const quote = committed.quotes.get(nonce);
            if (quote) quote.consumed_at = '2026-10-01T18:00:01.000Z';
          }
          if (lockKey) release(lockKey);
          lockKey = null;
          return { rows: [], rowCount: 0 };
        }
        if (text.includes('pg_advisory_xact_lock')) {
          lockKey = params[0];
          await acquire(lockKey);
          return { rows: [], rowCount: 0 };
        }
        if (text.includes('nexus_mc_quotes') && text.includes('SELECT')) {
          const quote = committed.quotes.get(params[0]);
          return { rows: quote ? [{ ...quote }] : [], rowCount: quote ? 1 : 0 };
        }
        if (text.includes('nexus_mc_quotes') && text.includes('UPDATE')) {
          pending.consumed.push(params[0]);
          return { rows: [], rowCount: 1 };
        }
        if (text.includes('nexus_mc_orders') && text.includes('WHERE nonce')) {
          const found = committed.orders.find((order) => order.nonce === params[0]);
          return { rows: found ? [{ order_data: found.order_data }] : [], rowCount: found ? 1 : 0 };
        }
        if (text.includes('nexus_mc_orders') && text.includes('economicIdentityId')) {
          const rows = committed.orders.filter((order) => order.status !== 'REFUNDED' && order.order_data.economicIdentityId === params[0] && order.order_data.source === 'mc-shop');
          return { rows: rows.map((order) => ({ order_data: order.order_data })), rowCount: rows.length };
        }
        if (text.includes('nexus_economy_wallets') && text.includes('INSERT')) {
          if (!committed.wallets.has(params[0])) committed.wallets.set(params[0], 0);
          return { rows: [], rowCount: 1 };
        }
        if (text.includes('SELECT balance')) {
          const current = pending.wallet?.id === params[0] ? pending.wallet.balance : committed.wallets.get(params[0]);
          return { rows: [{ balance: current ?? 0 }], rowCount: 1 };
        }
        if (text.includes('nexus_economy_wallets') && text.includes('UPDATE')) {
          pending.wallet = { id: params[0], balance: params[1] };
          return { rows: [], rowCount: 1 };
        }
        if (text.includes('nexus_economy_ledger') && text.includes('SELECT')) {
          const exists = committed.ledger.has(params[0]) || pending.ledger.includes(params[0]);
          return { rows: exists ? [{ id: 1 }] : [], rowCount: exists ? 1 : 0 };
        }
        if (text.includes('nexus_economy_ledger') && text.includes('INSERT')) {
          if (committed.ledger.has(params[3]) || pending.ledger.includes(params[3])) return { rows: [], rowCount: 0 };
          pending.ledger.push(params[3]);
          return { rows: [{ id: 1 }], rowCount: 1 };
        }
        if (text.includes('nexus_mc_orders') && text.includes('INSERT')) {
          pending.orders.push({
            order_id: params[0],
            nonce: params[1],
            order_data: JSON.parse(params[2]),
            status: params[3],
            price: params[4],
            created_at: params[5]
          });
          return { rows: [], rowCount: 1 };
        }
        if (text.includes('nexus_mc_outbox')) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      },
      release() {}
    };
  }

  return {
    sqlLog,
    committed,
    pool: {
      async query(sql) {
        const text = String(sql);
        if (text.includes('nexus_mc_schema_version') && text.includes('SELECT')) return { rows: [{ version: 1 }] };
        return { rows: [], rowCount: 1 };
      },
      async connect() { return connect(); }
    }
  };
}
