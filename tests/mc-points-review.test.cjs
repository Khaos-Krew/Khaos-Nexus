'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createEconomyServer, presenceBody, FINANCIAL_WRITE_PATHS } = require('../src/economy-worker/server.cjs');
const { MemoryMcPoints, CODE_ALPHABET, LINK_REQUESTS_PER_HOUR, CODE_ATTEMPT_LIMIT } = require('../src/economy-worker/mc-points-service.cjs');
const { PostgresEconomyAccrual } = require('../src/economy-worker/postgres-accrual.cjs');
const { NexusEconomyStore, NexusEconomyWorker } = require('../src/sentinel/nexus-economy-worker.cjs');
const { planMinecraftContribution, otherPresenceOnline, MC_DAILY_CAP_MS } = require('../src/economy-worker/mc-playtime-accounting.cjs');
const { parseGiveResponse } = require('../src/craft/mc-rcon-text.cjs');
const { verifyIdentityProof } = require('../src/sentinel/nexus-economy-identity-proof.cjs');
const { isMinecraftShopOrder } = require('../src/economy-worker/mc-points-service.cjs');
const { mcEarnEligible } = require('../src/economy-worker/mc-points-service.cjs');

const UUID = '853c80ef-3c37-49fd-aa49-938b674adae6';
const UUID_2 = '22222222-2222-4222-8222-222222222222';
const DISCORD = '111111111111111111';
const DISCORD_2 = '222222222222222222';
const STAFF = '333333333333333333';
const SECRET = 'nexus-identity-proof-secret-32ch';

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
      ...(extra.env || {})
    },
    createOrderId: extra.createOrderId
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
  assert.deepEqual(presenceBody({ provider: 'minecraft', mcUuid: UUID, online: true, rankId: 'shadow-recruit', server: 'minecraft', flags: { dryRun: false }, now: 0 }), {
    provider: 'minecraft',
    mcUuid: UUID,
    online: true,
    rankId: 'shadow-recruit',
    server: 'minecraft'
  });
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
    const body = JSON.stringify({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft', flags: { pointsEnabled: true, dryRun: false }, now: 1 });
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

test('give replies count only an exact count, item, and player', () => {
  assert.equal(parseGiveResponse('Gave 4 [minecraft:diamond] to Steve', { count: 4, itemId: 'minecraft:diamond', name: 'Steve' }).outcome, 'delivered');
  assert.equal(parseGiveResponse('Gave 4 [minecraft:diamond] to Steve extra', { count: 4, itemId: 'minecraft:diamond', name: 'Steve' }).outcome, 'unconfirmed');
  assert.equal(parseGiveResponse('Gave 4 [minecraft:diamond] to Alex', { count: 4, itemId: 'minecraft:diamond', name: 'Steve' }).outcome, 'unconfirmed');
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
    linkArkIdentity: () => { calls.push('link'); return { ok: true }; },
    minecraft: {
      buy: async () => { calls.push('buy'); return { ok: true }; },
      quote: async () => { calls.push('quote'); return { ok: true }; },
      refund: async () => { calls.push('refund'); return { ok: true }; },
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
    for (const path of ['/wallet/credit', '/wallet/spend', '/identity/link', '/mc-shop/buy', '/mc-shop/quote', '/mc-shop/refund']) {
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

test('minecraft playtime does not require EOS when the identity and link are verified', async () => {
  assert.equal(mcEarnEligible({ status: 'verified', verifiedAt: '2026-01-01' }, { verifiedAt: '2026-01-02', mcUuid: UUID }), true);
  assert.equal(mcEarnEligible({ status: 'verified', verifiedAt: '2026-01-01' }, null), false);
  assert.equal(mcEarnEligible({ status: 'restricted' }, { verifiedAt: '2026-01-02', mcUuid: UUID }), false);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-eos-'));
  let now = Date.parse('2026-10-01T16:00:00Z');
  const worker = new NexusEconomyWorker({
    store: new NexusEconomyStore(root),
    now: () => now,
    env: { MC_POINTS_ENABLED: 'true', MC_PLAYTIME_NP_ENABLED: 'true', MC_PLAYTIME_DRY_RUN: 'false' }
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

test('disabled minecraft master flag rejects posts before a database connection', async () => {
  const accrual = new PostgresEconomyAccrual({
    env: { MC_POINTS_ENABLED: 'false', MC_PLAYTIME_NP_ENABLED: 'true', MC_PLAYTIME_DRY_RUN: 'false' },
    pool: { async connect() { throw new Error('should not connect'); } }
  });
  const result = await accrual.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'not-minecraft', flags: { pointsEnabled: true, dryRun: false } });
  assert.equal(result.reason, 'mc-points-disabled');
});
