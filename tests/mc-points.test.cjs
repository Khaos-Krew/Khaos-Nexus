'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mcPointsFlags } = require('../src/shared/mc-points-flags.cjs');
const { loadMcShopCatalog, DEFAULT_MC_SHOP_ITEMS, MC_LIVE_PACK } = require('../src/shared/mc-shop-catalog.cjs');
const { loadStarterKit, starterKitEligibility, BACKPACK_ID, FIRST_PLAY_MS, ACCOUNT_AGE_MS, TENURE_MS } = require('../src/shared/mc-starter-kit.cjs');
const { planMinecraftContribution, MC_DAILY_CAP_MS, ctDayKey } = require('../src/economy-worker/mc-playtime-accounting.cjs');
const { MemoryMcPoints, UNLINK_COOLDOWN_MS, REFUND_AFTER_MS, OFFLINE_BACKOFF_MS } = require('../src/economy-worker/mc-points-service.cjs');
const { schemaSql, ensureMinecraftSchema } = require('../src/economy-worker/mc-points-postgres.cjs');
const { PostgresEconomyAccrual } = require('../src/economy-worker/postgres-accrual.cjs');
const { NexusEconomyStore, NexusEconomyWorker } = require('../src/sentinel/nexus-economy-worker.cjs');
const { McAfkTracker, AFK_UNCHANGED_MS } = require('../src/craft/mc-afk.cjs');
const {
  parseListUuids,
  parseGiveResponse,
  countInventorySlots,
  tellrawCommand,
  giveCommand,
  isPremiumUuid
} = require('../src/craft/mc-rcon-text.cjs');
const { pollMcPlaytime } = require('../src/craft/mc-playtime.cjs');
const { countsForSharedOnline } = require('../src/economy-worker/mc-playtime-accounting.cjs');
const { deliverMcOrder } = require('../src/craft/mc-delivery.cjs');
const { beginMinecraftLink } = require('../src/craft/mc-link-flow.cjs');
const { economyPerkForRank } = require('../src/shared/nexus-economy-rank-perks.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const UUID = '853c80ef-3c37-49fd-aa49-938b674adae6';
const UUID_2 = '11111111-1111-4111-8111-111111111111';
const DISCORD = '111111111111111111';
const LIVE = Object.freeze({ pointsEnabled: true, playtimeEnabled: true, dryRun: false, shopEnabled: false, shopDeliveryEnabled: false, starterKitEnabled: false, trackingEnabled: true, playtimeWrites: true });

function wallet(balance = 1000) {
  const calls = [];
  return {
    calls,
    balanceValue: balance,
    async resolve(discordUserId) {
      return { economicIdentityId: `econ_${discordUserId}`, status: 'verified', verifiedAt: '2026-01-01T00:00:00.000Z' };
    },
    async balance() { return this.balanceValue; },
    async spend(input) {
      calls.push(input);
      if (this.balanceValue < input.amount) return { ok: false, reason: 'insufficient-funds', balance: this.balanceValue };
      this.balanceValue -= input.amount;
      return { ok: true, balance: this.balanceValue };
    },
    async credit(input) {
      calls.push(input);
      this.balanceValue += input.amount;
      return { ok: true, balance: this.balanceValue };
    },
    async lifetimeMs() { return this.life || 0; },
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
      MC_LINK_CODE_SECRET: 'mc-link-code-hmac-secret-32chars!',
      ...(extra.env || {})
    },
    catalog: extra.catalog,
    kit: extra.kit,
    tenureOf: extra.tenureOf
  });
  return { points, advance: (ms) => { now += ms; }, setNow: (value) => { now = value; } };
}

test('minecraft points flags default off and dry-run defaults on', () => {
  const flags = mcPointsFlags({});
  assert.equal(flags.pointsEnabled, false);
  assert.equal(flags.playtimeEnabled, false);
  assert.equal(flags.shopEnabled, false);
  assert.equal(flags.shopDeliveryEnabled, false);
  assert.equal(flags.starterKitEnabled, false);
  assert.equal(flags.dryRun, true);
  assert.equal(flags.playtimeWrites, false);
  assert.equal(mcPointsFlags({ MC_PLAYTIME_DRY_RUN: 'false', MC_POINTS_ENABLED: 'true', MC_PLAYTIME_NP_ENABLED: 'true' }).playtimeWrites, true);
});

test('list uuids parser keeps premium UUIDs and ignores junk', () => {
  const parsed = parseListUuids('There are 2 of a max of 20 players online: Steve (853c80ef3c3749fdaa49938b674adae6), bad name! (not-a-uuid), Alex (11111111-1111-4111-8111-111111111111)');
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.players.map((player) => player.name), ['Steve', 'Alex']);
  assert.equal(isPremiumUuid(parsed.players[0].uuid), true);
  assert.equal(isPremiumUuid('11111111-1111-3111-8111-111111111111'), false);
  assert.equal(parseListUuids('nope').ok, false);
  const live = parseListUuids(`There are 1 of a max of 40 players online: Steve (${UUID})`);
  assert.equal(live.ok, true);
  assert.equal(live.players[0].uuid, UUID);
});

test('AFK uses position and rotation and treats a missing signal as AFK', () => {
  const afk = new McAfkTracker();
  const still = { position: [1, 64, 2], rotation: [10, 20] };
  assert.equal(afk.observe(UUID, still, 0).afk, false);
  assert.equal(afk.observe(UUID, still, AFK_UNCHANGED_MS - 1).afk, false);
  assert.equal(afk.observe(UUID, still, AFK_UNCHANGED_MS).reason, 'unchanged');
  assert.equal(afk.observe(UUID, { position: [2, 64, 2], rotation: [10, 20] }, AFK_UNCHANGED_MS + 20).afk, false);
  assert.equal(afk.observe(UUID, { position: [2, 64, 2], rotation: [11, 20] }, AFK_UNCHANGED_MS + 25).afk, false);
  assert.equal(afk.observe(UUID, { position: [2, 64, 2], rotation: [11, 20], datapackAfk: true }, AFK_UNCHANGED_MS + 30).reason, 'input');
  assert.equal(afk.observe(UUID_2, { rotation: [1, 2] }, 0).reason, 'signal-missing');
  assert.equal(afk.observe(UUID_2, { position: [1, 2, 3] }, 1).reason, 'signal-missing');
});

test('give and tellraw commands reject raw player input', () => {
  assert.equal(giveCommand(UUID, 'minecraft:iron_ingot', 64), `give ${UUID} minecraft:iron_ingot 64`);
  assert.throws(() => giveCommand('Steve; say hi', 'minecraft:iron_ingot', 1));
  assert.throws(() => giveCommand(UUID, 'minecraft:iron_ingot 64; say hi', 1));
  assert.match(tellrawCommand(UUID, 'Nexus link code: ABC-234'), new RegExp(`^tellraw ${UUID} \\{`));
  assert.equal(parseGiveResponse('Gave 64 [minecraft:iron_ingot] to [Team] Steve*', { count: 64, itemId: 'minecraft:iron_ingot', name: 'Steve' }).outcome, 'delivered');
  assert.equal(parseGiveResponse('Gave 63 [minecraft:iron_ingot] to Steve', { count: 64, itemId: 'minecraft:iron_ingot' }).outcome, 'unconfirmed');
  assert.equal(parseGiveResponse("Unknown item 'minecraft:nope'").outcome, 'unconfirmed');
  assert.equal(parseGiveResponse('No player was found').outcome, 'unconfirmed');
  assert.equal(parseGiveResponse("Can't give more than 1 of [sophisticatedbackpacks:backpack]").outcome, 'unconfirmed');
  assert.equal(parseGiveResponse('').outcome, 'unconfirmed');
  assert.equal(countInventorySlots('{Inventory:[{Slot:0b},{Slot:10b},{Slot:40b}]}').free, 34);
});

test('catalog keeps 14 configurable item ids and the kit keeps the backpack', () => {
  const catalog = loadMcShopCatalog({});
  assert.equal(catalog.items.length, 14);
  assert.equal(MC_LIVE_PACK.pack, 'ATM10: Aeronautics');
  assert.equal(MC_LIVE_PACK.packVersion, '0.6.1');
  assert.equal(MC_LIVE_PACK.minecraft, '1.21.1');
  assert.equal(catalog.version, 'atm10-aeronautics-0.6.1');
  assert.equal(catalog.items.filter((item) => item.sku === 'mc_diamond4')[0].dailyLimit, 2);
  const overridden = loadMcShopCatalog({ MC_SHOP_CATALOG_JSON: JSON.stringify([{ sku: 'mc_iron64', itemId: 'minecraft:diamond', price: 1, qty: 9 }, { sku: 'mc_new', itemId: 'minecraft:tnt', price: 1 }]) });
  assert.equal(overridden.items.find((item) => item.sku === 'mc_iron64').itemId, 'minecraft:diamond');
  assert.equal(overridden.items.find((item) => item.sku === 'mc_iron64').price, 40);
  assert.equal(overridden.items.find((item) => item.sku === 'mc_iron64').qty, 64);
  assert.equal(overridden.items.length, 14);
  assert.equal(loadMcShopCatalog({ MC_SHOP_CATALOG_JSON: JSON.stringify([{ sku: 'mc_iron64', itemId: 'minecraft:raw_iron' }]) }).items.find((item) => item.sku === 'mc_iron64').itemId, 'minecraft:iron_ingot');
  assert.throws(() => loadMcShopCatalog({ MC_SHOP_CATALOG_JSON: JSON.stringify([{ sku: 'mc_iron64', qty: 0 }]) }));
  assert.equal(loadStarterKit({}).items.at(-1).itemId, BACKPACK_ID);
  assert.throws(() => loadStarterKit({ MC_STARTER_KIT_JSON: JSON.stringify([{ itemId: 'minecraft:bread', qty: 1 }]) }));
  assert.equal(DEFAULT_MC_SHOP_ITEMS.some((item) => /tnt|nether_star|spawn_egg|allthemodium/i.test(item.itemId)), false);
});

test('shared minecraft cap stops at 8 counted hours and does not tax ARK time', () => {
  const day = ctDayKey(Date.parse('2026-10-01T18:00:00Z'));
  let state = { mcCountedDay: day, mcCountedMs: 0, mcLifetimeMs: 0, mcOnline: false, lastMcOnlineAt: null };
  const started = Date.parse('2026-10-01T18:00:00Z');
  state = { ...state, ...planMinecraftContribution({ ...state, online: true, nowMs: started, accountingGap: 0, otherOnline: false }) };
  for (let step = 1; step <= 96; step += 1) {
    const nowMs = started + step * 5 * 60 * 1000;
    state = { ...state, ...planMinecraftContribution({ ...state, online: true, nowMs, accountingGap: 5 * 60 * 1000, otherOnline: false }) };
  }
  assert.equal(state.mcCountedMs, MC_DAILY_CAP_MS);
  const blocked = planMinecraftContribution({ ...state, online: true, nowMs: started + 97 * 5 * 60 * 1000, accountingGap: 5 * 60 * 1000, otherOnline: false });
  assert.equal(blocked.gap, 0);
  assert.equal(blocked.capHit, true);
  const shared = planMinecraftContribution({ ...blocked, online: true, nowMs: started + 98 * 5 * 60 * 1000, accountingGap: 5 * 60 * 1000, otherOnline: true, otherSource: 'ark-gen1' });
  assert.equal(shared.gap, 5 * 60 * 1000);
  assert.equal(shared.creditSource, 'ark-gen1');
  assert.equal(shared.mcCountedMs, blocked.mcCountedMs);
});

test('dry-run logs cap math without writes and a disabled master never connects', async () => {
  const queries = [];
  const accrual = new PostgresEconomyAccrual({
    env: { MC_POINTS_ENABLED: 'true', MC_PLAYTIME_NP_ENABLED: 'true', MC_PLAYTIME_DRY_RUN: 'true' },
    pool: {
      async connect() {
        return {
          async query(sql) {
            queries.push(String(sql));
            if (String(sql).includes('nexus_economic_identity_links')) return { rows: [] };
            return { rows: [] };
          },
          release() {}
        };
      }
    }
  });
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(String(line));
  try {
    const dry = await accrual.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft', flags: { dryRun: false, pointsEnabled: true } });
    assert.equal(dry.reason, 'unlinked-player');
    assert.equal(queries.some((sql) => /INSERT|UPDATE|DELETE/i.test(sql)), false);
  } finally {
    console.log = original;
  }
  const off = new PostgresEconomyAccrual({
    env: {},
    pool: { async connect() { throw new Error('should not connect'); } }
  });
  const disabled = await off.recordPresence({
    provider: 'minecraft',
    mcUuid: UUID,
    online: true,
    server: 'minecraft',
    flags: { pointsEnabled: true, playtimeEnabled: true, dryRun: false }
  });
  assert.equal(disabled.reason, 'mc-points-disabled');
});

test('verified minecraft link shares the presence counter and the 8 hour cap', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-points-'));
  let now = Date.parse('2026-10-01T16:00:00Z');
  const worker = new NexusEconomyWorker({
    store: new NexusEconomyStore(root),
    now: () => now,
    env: { MC_POINTS_ENABLED: 'true', MC_PLAYTIME_NP_ENABLED: 'true', MC_PLAYTIME_DRY_RUN: 'false', MC_SHOP_ENABLED: 'true', MC_STARTER_KIT_ENABLED: 'true', MC_LINK_CODE_SECRET: 'mc-link-code-hmac-secret-32chars!' }
  });
  const linked = worker.linkArkIdentity({ discordUserId: DISCORD, eosId: 'EOSshared1234', rankId: 'shadow-recruit' });
  assert.equal(linked.discordUserId, DISCORD);
  const challenge = await worker.minecraft.challenge({ discordUserId: DISCORD, mcUuid: UUID, mcName: 'Steve' });
  assert.equal(challenge.ok, true, challenge.reason);
  const confirmed = await worker.minecraft.confirm({ discordUserId: DISCORD, code: challenge.code });
  assert.equal(confirmed.ok, true, confirmed.reason);
  const unlinked = await worker.recordPresence({ provider: 'minecraft', mcUuid: UUID_2, online: true, server: 'minecraft' });
  assert.equal(unlinked.reason, 'unlinked-player');
  await worker.recordPresence({ eosId: 'EOSshared1234', online: true, server: 'ark' });
  now += 5 * 60 * 1000;
  const ark = await worker.recordPresence({ eosId: 'EOSshared1234', online: true, server: 'ark' });
  const again = await worker.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft' });
  assert.equal(again.balance, ark.balance);
  const rate = economyPerkForRank('shadow-recruit').onlinePointsPerFiveMinutes;
  assert.equal(ark.balance, rate);
  for (let step = 0; step < 96; step += 1) {
    now += 5 * 60 * 1000;
    await worker.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft' });
  }
  const capped = worker.wallet(DISCORD).balance;
  now += 5 * 60 * 1000;
  const after = await worker.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft' });
  assert.equal(after.balance, capped);
  assert.ok(capped < rate * 110);
});

test('a capped minecraft session does not block ARK offline accrual', async () => {
  assert.equal(countsForSharedOnline(true, { minecraft: true, capHit: true }), false);
  assert.equal(countsForSharedOnline(true, { minecraft: true, capHit: false }), true);
  assert.equal(countsForSharedOnline(true, { minecraft: false, capHit: true }), true);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-cap-offline-'));
  let now = Date.parse('2026-10-01T16:00:00Z');
  const worker = new NexusEconomyWorker({
    store: new NexusEconomyStore(root),
    now: () => now,
    env: { MC_POINTS_ENABLED: 'true', MC_PLAYTIME_NP_ENABLED: 'true', MC_PLAYTIME_DRY_RUN: 'false', MC_LINK_CODE_SECRET: 'mc-link-code-hmac-secret-32chars!' }
  });
  worker.linkArkIdentity({ discordUserId: DISCORD, eosId: 'EOScapoffline1', rankId: 'cipher-runner' });
  const challenge = await worker.minecraft.challenge({ discordUserId: DISCORD, mcUuid: UUID, mcName: 'Steve' });
  assert.equal((await worker.minecraft.confirm({ discordUserId: DISCORD, code: challenge.code })).ok, true);
  const seeded = worker.store.read();
  const account = seeded.accounts[DISCORD];
  account.online = true;
  account.mcCountedDay = ctDayKey(now);
  account.mcCountedMs = MC_DAILY_CAP_MS;
  account.mcOnline = true;
  account.lastMcOnlineAt = new Date(now - 60_000).toISOString();
  account.lastAccountingAt = new Date(now).toISOString();
  account.lastPresenceAt = new Date(now).toISOString();
  account.presenceByServer = { minecraft: { online: true, mcUuid: UUID, at: new Date(now).toISOString() } };
  worker.store.write(seeded);
  now += 5 * 60 * 1000;
  const capped = await worker.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft' });
  assert.equal(capped.online, false);
  assert.equal(worker.store.read().accounts[DISCORD].mcOnline, true);
  now += 60 * 60 * 1000;
  const passive = await worker.accrueOffline(DISCORD);
  assert.equal(passive.credited, 4);
  const bothRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-cap-ark-'));
  let bothNow = Date.parse('2026-10-01T16:00:00Z');
  const both = new NexusEconomyWorker({
    store: new NexusEconomyStore(bothRoot),
    now: () => bothNow,
    env: { MC_POINTS_ENABLED: 'true', MC_PLAYTIME_NP_ENABLED: 'true', MC_PLAYTIME_DRY_RUN: 'false', MC_LINK_CODE_SECRET: 'mc-link-code-hmac-secret-32chars!' }
  });
  both.linkArkIdentity({ discordUserId: DISCORD, eosId: 'EOScapark12345', rankId: 'cipher-runner' });
  const bothChallenge = await both.minecraft.challenge({ discordUserId: DISCORD, mcUuid: UUID, mcName: 'Steve' });
  assert.equal((await both.minecraft.confirm({ discordUserId: DISCORD, code: bothChallenge.code })).ok, true);
  const bothState = both.store.read();
  const bothAccount = bothState.accounts[DISCORD];
  bothAccount.online = true;
  bothAccount.mcCountedDay = ctDayKey(bothNow);
  bothAccount.mcCountedMs = MC_DAILY_CAP_MS;
  bothAccount.mcOnline = true;
  bothAccount.lastMcOnlineAt = new Date(bothNow).toISOString();
  bothAccount.lastAccountingAt = new Date(bothNow).toISOString();
  bothAccount.lastPresenceAt = new Date(bothNow).toISOString();
  bothNow += 60 * 1000;
  bothAccount.presenceByServer = {
    minecraft: { online: true, mcUuid: UUID, at: new Date(bothNow).toISOString() },
    ark: { online: true, eosId: 'EOScapark12345', at: new Date(bothNow).toISOString() }
  };
  both.store.write(bothState);
  const stillOnline = await both.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft' });
  assert.equal(stillOnline.online, true);
  bothNow += 60 * 60 * 1000;
  const blocked = await both.accrueOffline(DISCORD);
  assert.equal(blocked.credited, 0);
});

test('link whispers a code, confirms the UUID, and enforces the 30-day cooldown', async () => {
  const { points } = service();
  const listed = `There are 1 of a max of 20 players online: Steve (${UUID})`;
  const commands = [];
  const result = await beginMinecraftLink({
    username: 'Steve',
    discordUserId: DISCORD,
    rcon: async (command) => {
      commands.push(command);
      return command === 'list uuids' ? listed : 'Whispered';
    },
    points,
    env: { MC_POINTS_ENABLED: 'true' },
    fetchImpl: async () => ({ ok: true, json: async () => ({ id: UUID.replace(/-/g, ''), name: 'Steve' }) })
  });
  assert.equal(result.ok, true, result.reason);
  assert.match(commands[1], new RegExp(`tellraw ${UUID}`));
  assert.match(commands[1], /asked to link/);
  assert.match(commands[1], /Code:/);
  assert.match(commands[1], /never share this code/);
  const code = commands[1].match(/Code: ([A-Z0-9]{3}-[A-Z0-9]{3})/)[1];
  const confirmed = await points.confirm({ discordUserId: DISCORD, code });
  assert.equal(confirmed.mcUuid, UUID);
  const unlinked = await points.unlink({ discordUserId: DISCORD });
  assert.equal(Date.parse(unlinked.cooldownUntil) - Date.parse('2026-10-01T18:00:00Z'), UNLINK_COOLDOWN_MS);
  const again = await points.challenge({ discordUserId: DISCORD, mcUuid: UUID_2, mcName: 'Alex' });
  assert.equal(again.reason, 'unlink-cooldown');
});

test('shop debits through the wallet, checks slots, and never retries an unconfirmed give', async () => {
  const bank = wallet(500);
  const { points, advance } = service({ wallet: bank });
  await points.challenge({ discordUserId: DISCORD, mcUuid: UUID, mcName: 'Steve' }).then(async (challenge) => {
    assert.equal((await points.confirm({ discordUserId: DISCORD, code: challenge.code })).ok, true);
  });
  const quoted = await points.quote({ discordUserId: DISCORD, sku: 'mc_iron64', bundles: 1 });
  assert.equal(quoted.quote.price, 40);
  assert.equal(quoted.quote.balanceAfter, 460);
  const bought = await points.buy({ discordUserId: DISCORD, sku: 'mc_iron64', bundles: 1, nonce: quoted.quote.nonce, writesEnabled: true });
  assert.equal(bought.ok, true, bought.reason);
  assert.equal(bought.ledgerKey, `mc-shop:econ_${DISCORD}:mc_iron64:${quoted.quote.nonce}`);
  assert.equal(bank.calls[0].source, 'sink:mc-shop');
  assert.equal(bank.balanceValue, 460);
  const denied = await points.buy({ discordUserId: DISCORD, sku: 'mc_iron64', bundles: 1, nonce: 'missing', writesEnabled: false });
  assert.equal(denied.reason, 'economy-write-cutover-not-enabled');

  const claimed = points.claimNext();
  assert.equal(claimed.orderId, bought.order.orderId);
  assert.ok(claimed.leaseToken);
  const offline = await deliverMcOrder(claimed, {
    points,
    deliveryEnabled: true,
    rcon: async () => 'There are 0 of a max of 20 players online:'
  });
  assert.equal(offline.status, 'PLAYER_OFFLINE');
  assert.equal(offline.requeued, true);
  assert.equal(points.claimNext(), null);
  advance(OFFLINE_BACKOFF_MS);
  const reclaimed = points.claimNext();
  const full = await deliverMcOrder(reclaimed, {
    points,
    deliveryEnabled: true,
    rcon: async (command) => {
      if (command === 'list uuids') return `There are 1 of a max of 20 players online: Steve (${UUID})`;
      if (command.includes('Inventory')) return '{Inventory:[' + Array.from({ length: 36 }, (_, index) => `{Slot:${index}b}`).join(',') + ']}';
      return '';
    }
  });
  assert.equal(full.waitingSlots, 1);
  assert.equal(full.requeued, true);
  assert.equal(points.orders.get(reclaimed.orderId).status, 'PLAYER_OFFLINE');
  assert.equal(points.claimNext(), null);
  advance(OFFLINE_BACKOFF_MS * 2);
  const reclaimedAgain = points.claimNext();
  const lost = await deliverMcOrder(reclaimedAgain, {
    points,
    deliveryEnabled: true,
    rcon: async (command) => command === 'list uuids'
      ? `There are 1 of a max of 20 players online: Steve (${UUID})`
      : command.includes('Inventory') ? '{Inventory:[]}' : 'No player was found'
  });
  assert.equal(lost.status, 'SENT_UNCONFIRMED');
  const retry = await deliverMcOrder(points.orders.get(bought.order.orderId), { points, deliveryEnabled: true, rcon: async () => { throw new Error('should not send'); } });
  assert.equal(retry.skipped, 'no-retry');

  const second = await points.quote({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1 });
  const paid = await points.buy({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1, nonce: second.quote.nonce, writesEnabled: true });
  const order = points.orders.get(paid.order.orderId);
  order.createdAt = new Date(Date.parse(order.createdAt) - REFUND_AFTER_MS - 1000).toISOString();
  advance(0);
  const swept = await points.sweepRefunds({ writesEnabled: true, now: Date.parse(order.createdAt) + REFUND_AFTER_MS + 2000 });
  assert.equal(swept.some((result) => result.ok && result.order.orderId === order.orderId), true);
  assert.equal(points.orders.get(order.orderId).status, 'REFUNDED');
});

test('starter kit is once per identity and once per UUID', async () => {
  const bank = wallet();
  const now = Date.parse('2026-10-01T18:00:00Z');
  const { points, setNow } = service({ wallet: bank, tenureOf: async () => now - TENURE_MS });
  setNow(now);
  const challenge = await points.challenge({ discordUserId: DISCORD, mcUuid: UUID, mcName: 'Steve' });
  await points.confirm({ discordUserId: DISCORD, code: challenge.code });
  points.links.get(UUID).playtimeMs = FIRST_PLAY_MS;
  const claim = await points.claimStarterKit({
    discordUserId: DISCORD,
    joinedAt: now,
    tenureTrusted: true
  });
  assert.equal(claim.ok, true, claim.reason);
  assert.equal(claim.order.price, 0);
  assert.equal(claim.order.lines.some((line) => line.itemId === BACKPACK_ID), true);
  assert.equal(claim.order.lines.at(-1).itemId, BACKPACK_ID);
  const again = await points.claimStarterKit({
    discordUserId: DISCORD,
    joinedAt: now - TENURE_MS,
    tenureTrusted: true
  });
  assert.equal(again.duplicate, true);
  assert.equal(again.order.orderId, claim.order.orderId);
  const untrusted = service({ wallet });
  const youngBank = wallet();
  const denied = service({ wallet: youngBank });
  const deniedChallenge = await denied.points.challenge({ discordUserId: DISCORD, mcUuid: UUID_2, mcName: 'Alex' });
  await denied.points.confirm({ discordUserId: DISCORD, code: deniedChallenge.code });
  denied.points.links.get(UUID_2).playtimeMs = FIRST_PLAY_MS;
  const ignoredBody = await denied.points.claimStarterKit({
    discordUserId: DISCORD,
    joinedAt: now - TENURE_MS,
    tenureTrusted: true
  });
  assert.equal(ignoredBody.reason, 'tenure-unknown');
  const young = starterKitEligibility({
    identityVerified: true,
    linkVerified: true,
    premiumUuid: true,
    accountCreatedAt: now - ACCOUNT_AGE_MS + 1000,
    joinedAt: now - TENURE_MS,
    lifetimeMs: FIRST_PLAY_MS,
    now
  });
  assert.equal(young.reason, 'account-too-new');
});

test('playtime poll logs AFK and does not post while dry-run', async () => {
  const posts = [];
  const listed = `There are 1 of a max of 20 players online: Steve (${UUID})`;
  const afk = new McAfkTracker();
  const seen = new Set();
  const rcon = async (command) => {
    if (command === 'list uuids') return listed;
    if (command.endsWith('Pos')) return '[1.0d, 64.0d, 2.0d]';
    if (command.endsWith('Rotation')) return '[10.0f, 20.0f]';
    if (String(command).includes('ftbessentials')) throw new Error('ftb-essentials-afk');
    return '';
  };
  const first = await pollMcPlaytime({
    rcon,
    afk,
    seen,
    presence: async (input) => { posts.push(input); },
    now: () => 0,
    env: { MC_POINTS_ENABLED: 'true', MC_PLAYTIME_DRY_RUN: 'true' }
  });
  assert.equal(first.posted, 0);
  assert.equal(first.afk, 0);
  assert.equal(posts.length, 0);
  const second = await pollMcPlaytime({
    rcon,
    afk,
    seen,
    presence: async (input) => { posts.push(input); },
    now: () => AFK_UNCHANGED_MS,
    env: { MC_POINTS_ENABLED: 'true', MC_PLAYTIME_NP_ENABLED: 'true', MC_PLAYTIME_DRY_RUN: 'false' }
  });
  assert.equal(second.afk, 1);
  assert.equal(posts.at(-1).online, false);
  assert.equal(posts.at(-1).afk, true);
  const commands = [];
  const bare = await pollMcPlaytime({
    rcon: async (command) => {
      commands.push(command);
      return rcon(command);
    },
    presence: async () => {},
    env: { MC_POINTS_ENABLED: 'true', MC_PLAYTIME_NP_ENABLED: 'true', MC_PLAYTIME_DRY_RUN: 'true' }
  });
  assert.equal(bare.ok, true);
  assert.equal(commands.some((command) => String(command).startsWith('give ')), false);
  const dryPosts = [];
  const dry = await pollMcPlaytime({
    rcon,
    afk: new McAfkTracker(),
    seen: new Set(),
    presence: async (input) => { dryPosts.push(input); },
    now: () => 0,
    env: { MC_POINTS_ENABLED: 'true', MC_PLAYTIME_NP_ENABLED: 'true', MC_PLAYTIME_DRY_RUN: 'true' }
  });
  assert.equal(dry.posted, 1);
  assert.equal(dry.dryRun, true);
  assert.equal(dryPosts[0].online, true);
  const ignored = [];
  const ignoredTag = await pollMcPlaytime({
    rcon: async (command) => {
      ignored.push(command);
      if (String(command).includes('ftbessentials') || String(command).startsWith('tag ')) throw new Error('afk-datapack');
      return rcon(command);
    },
    afk: new McAfkTracker(),
    seen: new Set(),
    presence: async () => {},
    now: () => 0,
    env: { MC_POINTS_ENABLED: 'true', MC_PLAYTIME_NP_ENABLED: 'true', MC_PLAYTIME_DRY_RUN: 'true', MC_AFK_DATAPACK_TAG: 'afk' }
  });
  assert.equal(ignoredTag.afk, 0);
  assert.equal(ignored.some((command) => String(command).startsWith('tag ')), false);
});

test('grant table schema keeps one kit per identity and per UUID', () => {
  const sql = schemaSql('public');
  assert.match(sql, /nexus_mc_grants/);
  assert.match(sql, /UNIQUE \(kind, economic_identity_id\)/);
  assert.match(sql, /UNIQUE \(kind, mc_uuid\)/);
  const perIdentity = sql.indexOf('nexus_mc_grants_one_starter_per_identity');
  const perEos = sql.indexOf('nexus_mc_grants_one_starter_per_eos');
  const withoutEos = sql.indexOf('nexus_mc_grants_kind_identity_without_eos');
  const dropIdentity = sql.indexOf('DROP CONSTRAINT IF EXISTS nexus_mc_grants_kind_economic_identity_id_key');
  const dropKitIndex = sql.indexOf('DROP INDEX IF EXISTS "public".nexus_mc_grants_kind_eos');
  assert.ok(perIdentity > 0 && perEos > 0 && withoutEos > 0);
  assert.ok(dropIdentity > perIdentity && dropIdentity > perEos && dropIdentity > withoutEos);
  assert.ok(dropKitIndex > dropIdentity);
  assert.match(sql, /nexus_mc_action_audit/);
  assert.match(sql, /nexus_mc_schema_version/);
  const auditSql = sql.slice(sql.indexOf('nexus_mc_action_audit'), sql.indexOf('nexus_mc_schema_version'));
  assert.doesNotMatch(auditSql, /nonce/);
  assert.doesNotMatch(auditSql, /code_hash/);
  const runtime = fs.readFileSync(path.join(__dirname, '../src/economy-worker/postgres-runtime.cjs'), 'utf8');
  assert.doesNotMatch(runtime, /minecraft\.ensureSchema/);
  assert.doesNotMatch(runtime, /applySystemMintBalanceChecks/);
  const runtimeBoot = runtime.slice(runtime.indexOf('async function createPostgresEconomyRuntime'), runtime.indexOf('module.exports'));
  assert.doesNotMatch(runtimeBoot, /nexus_mc_grants|DROP CONSTRAINT/);
  const accrualSource = fs.readFileSync(path.join(__dirname, '../src/economy-worker/postgres-accrual.cjs'), 'utf8');
  const bootSchema = accrualSource.slice(accrualSource.indexOf('async ensureSchema'), accrualSource.indexOf('async syncRank'));
  assert.doesNotMatch(bootSchema, /mc_counted_day/);
  const source = fs.readFileSync(path.join(__dirname, '../src/economy-worker/mc-points-postgres.cjs'), 'utf8');
  assert.match(source, /provider, external_id, economic_identity_id, verified_at, source/);
  assert.match(source, /'minecraft'/);
  assert.match(source, /ON CONFLICT \(provider, external_id\) DO NOTHING/);
  assert.match(source, /FOR UPDATE SKIP LOCKED/);
  assert.doesNotMatch(source, /DELETE FROM \$\{s\}\.nexus_mc_links/);
  assert.match(source, /crypto\.randomUUID\(\)/);
});

test('dry-run accrues per-uuid playtime and a schema failure stays inside minecraft', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-dry-play-'));
  let now = Date.parse('2026-10-01T16:00:00Z');
  const worker = new NexusEconomyWorker({
    store: new NexusEconomyStore(root),
    now: () => now,
    env: {
      MC_POINTS_ENABLED: 'true',
      MC_PLAYTIME_NP_ENABLED: 'true',
      MC_PLAYTIME_DRY_RUN: 'true',
      MC_STARTER_KIT_ENABLED: 'true',
      MC_LINK_CODE_SECRET: 'mc-link-code-hmac-secret-32chars!'
    }
  });
  worker.linkArkIdentity({ discordUserId: DISCORD, eosId: 'EOSdryrun12345', rankId: 'shadow-recruit' });
  const challenge = await worker.minecraft.challenge({ discordUserId: DISCORD, mcUuid: UUID, mcName: 'Steve' });
  assert.equal((await worker.minecraft.confirm({ discordUserId: DISCORD, code: challenge.code })).ok, true);
  await worker.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft' });
  for (let step = 0; step < 3; step += 1) {
    now += 5 * 60 * 1000;
    const tick = await worker.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft' });
    assert.equal(tick.dryRun, true);
    assert.equal(tick.credited, 0);
  }
  assert.equal(worker.balance(DISCORD), 0);
  assert.equal(worker.minecraft.linkByUuid(UUID).playtimeMs, 15 * 60 * 1000);
  assert.equal(Object.keys(worker.store.read().processed || {}).some((key) => key.startsWith('playtime:')), false);
  worker.minecraft.tenureOf = async () => now - 8 * 24 * 60 * 60 * 1000;
  const claim = await worker.minecraft.claimStarterKit({ discordUserId: DISCORD, joinedAt: now, tenureTrusted: true });
  assert.equal(claim.ok, true, claim.reason);
  const pool = {
    ended: false,
    async query() { throw new Error('ddl failed'); },
    async end() { this.ended = true; }
  };
  const failed = await ensureMinecraftSchema({ pool, schema: 'public' });
  assert.equal(failed.reason, 'mc-schema-unavailable');
  assert.equal(pool.ended, false);
  const again = await ensureMinecraftSchema({ pool, schema: 'public' });
  assert.equal(again.reason, 'mc-schema-unavailable');
  let connected = false;
  const livePool = {
    ended: false,
    async query() { throw new Error('ddl failed'); },
    async connect() { connected = true; throw new Error('should not connect'); },
    async end() { this.ended = true; }
  };
  const accrual = new PostgresEconomyAccrual({
    env: { MC_POINTS_ENABLED: 'true', MC_PLAYTIME_NP_ENABLED: 'true', MC_PLAYTIME_DRY_RUN: 'false' },
    pool: livePool
  });
  const blocked = await accrual.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft' });
  assert.equal(blocked.reason, 'mc-schema-unavailable');
  assert.equal(connected, false);
  assert.equal(livePool.ended, false);
  const queries = [];
  const schema = new PostgresEconomyAccrual({
    pool: {
      async query(sql) {
        queries.push(String(sql));
        if (String(sql).includes('information_schema.columns')) return { rows: [{ is_nullable: 'NO' }] };
        return { rows: [] };
      },
      async connect() { throw new Error('schema check does not connect'); }
    }
  });
  await schema.ensureSchema();
  const sql = queries.join('\n');
  assert.match(sql, /offline_since TIMESTAMPTZ,/);
  assert.doesNotMatch(sql, /offline_since TIMESTAMPTZ NOT NULL/);
  assert.match(sql, /information_schema\.columns/);
  assert.match(sql, /ALTER COLUMN offline_since DROP NOT NULL/);
  const skipped = [];
  const already = new PostgresEconomyAccrual({
    pool: {
      async query(sql) {
        skipped.push(String(sql));
        if (String(sql).includes('information_schema.columns')) return { rows: [{ is_nullable: 'YES' }] };
        return { rows: [] };
      },
      async connect() { throw new Error('schema check does not connect'); }
    }
  });
  await already.ensureSchema();
  assert.equal(skipped.some((text) => text.includes('DROP NOT NULL')), false);
});
