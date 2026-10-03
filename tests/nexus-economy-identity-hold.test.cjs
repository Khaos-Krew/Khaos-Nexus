'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createEconomyServer } = require('../src/economy-worker/server.cjs');
const { PostgresEconomyAccrual } = require('../src/economy-worker/postgres-accrual.cjs');
const { PostgresMcPoints } = require('../src/economy-worker/mc-points-postgres.cjs');
const { NexusEconomyStore, NexusEconomyWorker } = require('../src/sentinel/nexus-economy-worker.cjs');
const { ClusterShopService, ShopOrderStore, loadCatalog } = require('../src/sentinel/cluster-shop-service.cjs');
const { NexusEconomyWalletCore } = require('../src/sentinel/nexus-economy-wallet-core.cjs');
const { NexusEconomyPostgresRepository } = require('../src/sentinel/nexus-economy-postgres-repository.cjs');
const { routeWalletCredit, COMMUNITY_LEVEL_UP_SOURCE } = require('../src/sentinel/nexus-economy-community-level-coins.cjs');
const {
  SCHEMA_IDENTITY_STATUSES,
  BLOCKED_MEMBER_STATUSES,
  MEMBER_HOLD_MESSAGE,
  memberIdentityHold
} = require('../src/sentinel/nexus-economy-identity-hold.cjs');
const { catalogFingerprint, loadMcShopCatalog } = require('../src/shared/mc-shop-catalog.cjs');
const { mcMemberText } = require('../src/shared/mc-member-text.cjs');
const { reasonText, handleMcPointsCommand } = require('../src/craft/mc-points-commands.cjs');
const { mcShopBuyFailureText } = require('../src/sentinel/mc-shop-ui-extension.cjs');
const { orderFailureCopy } = require('../src/sentinel/cluster-shop-copy.cjs');
const { NexusEconomyClient } = require('../src/sentinel/nexus-economy-client.cjs');
const { handleInteraction, newSession } = require('../src/sentinel/cluster-shop-ui-extension.cjs');
const { runCycle } = require('../src/sentinel/cluster-shop-delivery-worker.cjs');
const { NexusEconomyPostgresRuntimeRepository } = require('../src/sentinel/nexus-economy-postgres-runtime-repository.cjs');
const { publicRequestError } = require('../src/economy-worker/server.cjs');

const MESSAGE = 'Your account is on hold. Ask an Admin for help.';
const DISCORD = '111111111111111111';
const EOS = 'EOS_HOLD_TEST_1';
const UUID = '853c80ef-3c37-49fd-aa49-938b674adae6';
const STAFF = '333333333333333333';
const LINK_SECRET = 'mc-link-code-hmac-secret-32chars!';
const TOKEN = 'hold-test-token';
const BLOCKED = ['quarantined', 'restricted', 'disabled'];

function assertHold(result) {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.reason, 'account-hold');
  assert.equal(result.message, MESSAGE);
}

class LockingRepo {
  constructor() {
    this.links = new Map();
    this.wallets = new Map();
    this.ledger = new Map();
    this.orders = new Map();
    this.nextId = 1;
    this.flip = null;
    this.lockedReads = 0;
  }

  link(discordUserId, economicIdentityId, { status = 'verified', holdReason = '', verifiedAt = '2026-09-12T00:00:00.000Z' } = {}) {
    const row = {
      economic_identity_id: economicIdentityId,
      status,
      hold_reason: holdReason,
      verified_at: status === 'verified' ? verifiedAt : verifiedAt
    };
    this.links.set(`discord:${discordUserId}`, row);
    this.links.set(`id:${economicIdentityId}`, row);
    return row;
  }

  async getIdentityByLink(_provider, externalId) {
    return this.links.get(`discord:${externalId}`) || null;
  }

  async getWalletByDiscord(discordUserId, currency) {
    const identity = this.links.get(`discord:${discordUserId}`);
    if (!identity) return null;
    return this.wallets.get(`${identity.economic_identity_id}:${currency}`) || { balance: 0 };
  }

  async resolveVerifiedIdentity() {
    return null;
  }

  async transact(economicIdentityId, currency, fn) {
    const walletKey = `${economicIdentityId}:${currency}`;
    const tx = {
      lockIdentity: async () => {
        this.lockedReads += 1;
        const row = this.links.get(`id:${economicIdentityId}`);
        if (this.flip) {
          row.status = this.flip;
          if (this.flip === 'restricted' && !row.hold_reason) row.hold_reason = 'staff';
        }
        return row ? { economic_identity_id: economicIdentityId, status: row.status, hold_reason: row.hold_reason || null } : null;
      },
      findLedgerByKey: async (key) => this.ledger.get(key) || null,
      findOrder: async (orderId) => this.orders.get(orderId) || null,
      findIdentity: async () => {
        const row = this.links.get(`id:${economicIdentityId}`);
        return row && row.status === 'verified' ? { economic_identity_id: economicIdentityId, status: 'verified' } : null;
      },
      getOrCreateWallet: async () => {
        if (!this.wallets.has(walletKey)) this.wallets.set(walletKey, { economic_identity_id: economicIdentityId, currency, balance: 0 });
        return this.wallets.get(walletKey);
      },
      appendLedger: async (entry) => {
        const saved = { id: `tx-${this.nextId++}`, ...entry };
        this.ledger.set(entry.idempotencyKey, saved);
        return saved;
      },
      setBalance: async (_id, _currency, balance) => {
        const current = this.wallets.get(walletKey) || { economic_identity_id: economicIdentityId, currency };
        this.wallets.set(walletKey, { ...current, balance });
      },
      appendOrder: async (order) => { this.orders.set(order.orderId, order); },
      appendOutbox: async () => {}
    };
    return fn(tx);
  }
}

function catalog() {
  return loadCatalog(JSON.stringify([{
    id: 'metal',
    name: 'Metal',
    kind: 'resource',
    baseQuantity: 100,
    buyPrice: 50,
    sellPrice: 17,
    minBundles: 1,
    maxBundles: 50,
    buyable: true,
    sellable: true,
    blueprint: '/Game/PrimalEarth/CoreBlueprints/Resources/PrimalItemResource_Metal.PrimalItemResource_Metal'
  }]));
}

function workerFixture(status = 'verified', options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-hold-'));
  const now = Date.parse('2026-10-01T12:00:00.000Z');
  const worker = new NexusEconomyWorker({
    store: new NexusEconomyStore(root),
    now: () => now,
    env: {
      MC_POINTS_ENABLED: 'true',
      MC_PLAYTIME_NP_ENABLED: 'true',
      MC_PLAYTIME_DRY_RUN: 'false',
      MC_SHOP_ENABLED: 'true',
      MC_LINK_CODE_SECRET: LINK_SECRET,
      NEXUS_MC_REFUND_STAFF_IDS: STAFF
    }
  });
  worker.linkArkIdentity({ discordUserId: DISCORD, eosId: EOS, rankId: 'cipher-runner' });
  const state = worker.store.read();
  const holdReason = options.holdReason != null ? options.holdReason : (status === 'restricted' ? 'staff' : '');
  state.accounts[DISCORD].status = status;
  state.accounts[DISCORD].holdReason = holdReason;
  state.accounts[DISCORD].balance = 500;
  state.accounts[DISCORD].online = false;
  state.accounts[DISCORD].lastPassiveAt = new Date(now - 5 * 3_600_000).toISOString();
  state.accounts[DISCORD].offlineSince = state.accounts[DISCORD].lastPassiveAt;
  worker.store.write(state);
  const shop = new ClusterShopService({
    economy: worker,
    store: new ShopOrderStore(root),
    catalog: catalog()
  });
  return { worker, shop, root, now };
}

function call(port, pathname, method, data) {
  const payload = Buffer.from(JSON.stringify(data || {}));
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
        'content-length': payload.length
      }
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function withServer(status, fn) {
  const { worker, shop } = workerFixture(status);
  const runtime = createEconomyServer({ worker, shop, token: TOKEN, writesEnabled: true });
  const port = await new Promise((resolve) => runtime.server.listen(0, '127.0.0.1', () => resolve(runtime.server.address().port)));
  try {
    await fn({ port, worker, shop });
  } finally {
    await new Promise((resolve) => runtime.server.close(resolve));
  }
}

test('blocked statuses match the identity schema, plus the literal quarantined hold', () => {
  const sql = NexusEconomyPostgresRepository.schemaSql();
  assert.match(sql, /CHECK \(status IN \('verified','restricted','disabled'\)\)/);
  assert.deepEqual(SCHEMA_IDENTITY_STATUSES, ['verified', 'restricted', 'disabled']);
  for (const status of ['restricted', 'disabled']) assert.equal(BLOCKED_MEMBER_STATUSES.includes(status), true);
  assert.equal(BLOCKED_MEMBER_STATUSES.includes('quarantined'), true);
  assert.match(sql, /hold_reason TEXT/);
  assert.match(sql, /held_by TEXT/);
  assert.equal(memberIdentityHold({ status: 'verified', economicIdentityId: 'econ_ok' }), null);
  assert.equal(memberIdentityHold({ status: 'restricted', economicIdentityId: 'econ_shadow' }), null);
  assert.equal(memberIdentityHold({ status: 'restricted', holdReason: 'o9-demote', economicIdentityId: 'econ_mark' }).reason, 'account-hold');
  assert.equal(memberIdentityHold({ status: 'verified', holdReason: 'staff', economicIdentityId: 'econ_staff' }).reason, 'account-hold');
  assert.equal(memberIdentityHold({ status: 'verified', economicIdentityId: 'econ_q', env: { NEXUS_ECONOMY_QUARANTINE_DENYLIST: 'econ_q' } }).reason, 'quarantined');
  assert.equal(MEMBER_HOLD_MESSAGE, MESSAGE);
});

test('wallet spend and non-level-up credit refuse each blocked status and still allow verified', async () => {
  for (const status of BLOCKED) {
    const repository = new LockingRepo();
    repository.link(DISCORD, 'econ_hold', { status, holdReason: status === 'restricted' ? 'staff' : '', verifiedAt: '2026-09-12T00:00:00.000Z' });
    const wallet = new NexusEconomyWalletCore({ repository, now: () => new Date('2026-10-01T00:00:00.000Z') });
    const spent = await wallet.spend({ discordUserId: DISCORD, amount: 10, orderId: `order_${status}` });
    const credited = await wallet.credit({ discordUserId: DISCORD, amount: 10, idempotencyKey: `credit_${status}` });
    assertHold(spent);
    assertHold(credited);
    assert.equal(repository.ledger.size, 0);
    assert.equal(repository.wallets.size, 0);
    assert.ok(repository.lockedReads >= 2);
  }

  const repository = new LockingRepo();
  repository.link(DISCORD, 'econ_ok', { status: 'verified' });
  const wallet = new NexusEconomyWalletCore({ repository, now: () => new Date('2026-10-01T00:00:00.000Z') });
  const credited = await wallet.credit({ discordUserId: DISCORD, amount: 40, idempotencyKey: 'seed_ok' });
  const spent = await wallet.spend({ discordUserId: DISCORD, amount: 15, orderId: 'order_ok' });
  assert.equal(credited.ok, true);
  assert.equal(spent.ok, true);
  assert.equal(spent.balance, 25);
});

test('a status change inside the identity lock is the status the spend uses', async () => {
  const repository = new LockingRepo();
  repository.link(DISCORD, 'econ_race', { status: 'verified' });
  repository.wallets.set('econ_race:NEXUS_POINTS', { economic_identity_id: 'econ_race', currency: 'NEXUS_POINTS', balance: 80 });
  repository.flip = 'restricted';
  const wallet = new NexusEconomyWalletCore({ repository, now: () => new Date('2026-10-01T00:00:00.000Z') });
  const spent = await wallet.spend({ discordUserId: DISCORD, amount: 10, orderId: 'race_order' });
  assertHold(spent);
  assert.equal(repository.wallets.get('econ_race:NEXUS_POINTS').balance, 80);
  assert.equal(repository.ledger.size, 0);
  assert.equal(repository.links.get('id:econ_race').status, 'restricted');
});

test('level-up Coins still credit a restricted identity while member spend stays refused', async () => {
  const repository = new LockingRepo();
  repository.link(DISCORD, 'econ_level', { status: 'restricted', verifiedAt: null });
  const wallet = new NexusEconomyWalletCore({ repository, now: () => new Date('2026-10-01T00:00:00.000Z') });
  const coins = await routeWalletCredit(wallet, {
    discordUserId: DISCORD,
    amount: 25,
    currency: 'NEXUS_COINS',
    source: COMMUNITY_LEVEL_UP_SOURCE,
    idempotencyKey: 'community-level-up:111111111111111111:1:2',
    metadata: { reason: COMMUNITY_LEVEL_UP_SOURCE, beforeLevel: 1, afterLevel: 2 }
  });
  assert.equal(coins.ok, true);
  assert.equal(coins.currency, 'NEXUS_COINS');
  assert.equal(coins.balance, 25);
  await assert.rejects(
    () => wallet.spend({ discordUserId: DISCORD, amount: 1, orderId: 'coin_spend', currency: 'NEXUS_COINS' }),
    (error) => {
      assert.equal(error.message, 'Verified economic identity is required.');
      assert.doesNotMatch(error.message, /on hold/);
      return true;
    }
  );
  await assert.rejects(
    () => wallet.credit({ discordUserId: DISCORD, amount: 1, idempotencyKey: 'coin_credit', currency: 'NEXUS_COINS' }),
    (error) => {
      assert.equal(error.message, 'Verified economic identity is required.');
      return true;
    }
  );
  assert.equal(repository.wallets.get('econ_level:NEXUS_COINS').balance, 25);
  await assert.rejects(
    () => wallet.spend({ discordUserId: DISCORD, amount: 1, orderId: 'np_spend', currency: 'NEXUS_POINTS' }),
    (error) => {
      assert.equal(error.message, 'Verified economic identity is required.');
      assert.doesNotMatch(error.message, /on hold/);
      return true;
    }
  );
  repository.link(DISCORD, 'econ_marked', { status: 'restricted', holdReason: 'o9-demote', verifiedAt: null });
  const marked = new NexusEconomyWalletCore({ repository, now: () => new Date('2026-10-01T00:00:00.000Z') });
  const markedCoins = await marked.spend({ discordUserId: DISCORD, amount: 1, orderId: 'marked_coins', currency: 'NEXUS_COINS' });
  assertHold(markedCoins);
  const markedLevel = await routeWalletCredit(marked, {
    discordUserId: DISCORD,
    amount: 10,
    currency: 'NEXUS_COINS',
    source: COMMUNITY_LEVEL_UP_SOURCE,
    idempotencyKey: 'community-level-up:111111111111111111:1:2',
    metadata: { reason: COMMUNITY_LEVEL_UP_SOURCE, beforeLevel: 1, afterLevel: 2 }
  });
  assert.equal(markedLevel.ok, false);
  assert.equal(markedLevel.skipped, 'account-hold');
  assert.equal(markedLevel.credited, 0);
  assert.equal(repository.ledger.size, 1);
});

test('a hold taken under the identity lock skips level-up Coins with no back-pay after lift', async () => {
  const repository = new LockingRepo();
  repository.link(DISCORD, 'econ_race_level', { status: 'verified' });
  repository.flip = 'restricted';
  const wallet = new NexusEconomyWalletCore({ repository, now: () => new Date('2026-10-01T00:00:00.000Z') });
  const skipped = await routeWalletCredit(wallet, {
    discordUserId: DISCORD,
    amount: 10,
    currency: 'NEXUS_COINS',
    source: COMMUNITY_LEVEL_UP_SOURCE,
    idempotencyKey: 'community-level-up:111111111111111111:1:2',
    metadata: { reason: COMMUNITY_LEVEL_UP_SOURCE, beforeLevel: 1, afterLevel: 2 }
  });
  assert.equal(skipped.ok, false);
  assert.equal(skipped.skipped, 'account-hold');
  assert.equal(skipped.credited, 0);
  assert.equal(repository.ledger.size, 0);
  assert.equal(repository.wallets.has('econ_race_level:NEXUS_COINS'), false);
  repository.flip = null;
  repository.link(DISCORD, 'econ_race_level', { status: 'verified', holdReason: '' });
  const next = await routeWalletCredit(wallet, {
    discordUserId: DISCORD,
    amount: 15,
    currency: 'NEXUS_COINS',
    source: COMMUNITY_LEVEL_UP_SOURCE,
    idempotencyKey: 'community-level-up:111111111111111111:2:3',
    metadata: { reason: COMMUNITY_LEVEL_UP_SOURCE, beforeLevel: 2, afterLevel: 3 }
  });
  assert.equal(next.ok, true);
  assert.equal(next.balance, 15);
  assert.equal(repository.wallets.get('econ_race_level:NEXUS_COINS').balance, 15);
  assert.equal(repository.ledger.has('community-level-up:111111111111111111:1:2'), false);
});

test('cluster shop purchase refuses a status that changes under the wallet lock', async () => {
  const repository = new LockingRepo();
  repository.link(DISCORD, 'econ_shop', { status: 'verified' });
  repository.wallets.set('econ_shop:NEXUS_POINTS', { economic_identity_id: 'econ_shop', currency: 'NEXUS_POINTS', balance: 200 });
  repository.flip = 'disabled';
  const wallet = new NexusEconomyWalletCore({ repository, now: () => new Date('2026-10-01T00:00:00.000Z') });
  const { createHash } = require('node:crypto');
  const { createNexusEconomyPurchaseOutboxRecord } = require('../src/sentinel/nexus-economy-purchase-outbox-record.cjs');
  const planDigest = createHash('sha256').update('hold-shop').digest('hex');
  const record = createNexusEconomyPurchaseOutboxRecord().prepare({
    ok: true,
    actionReady: true,
    queueWritePermitted: false,
    executionPermitted: false,
    schemaVersion: 2,
    actionId: `action_${planDigest.slice(0, 24)}`,
    type: 'nexus.economy.purchase',
    capability: 'economy.purchase.execute',
    subject: `discord-user:${DISCORD}`,
    correlationId: 'hold-shop',
    requestId: 'hold-shop',
    idempotencyKey: 'hold-shop',
    orderId: 'hold-shop',
    planId: 'plan_hold-shop',
    payload: {
      planId: 'plan_hold-shop',
      planDigest,
      discordUserId: DISCORD,
      itemId: 'metal',
      quantity: 1,
      currency: 'Nexus Points',
      totalPrice: 50,
      projectedBalance: 150,
      fulfillment: 'rewards-ascended-item'
    }
  });
  const result = await wallet.commitPurchase({
    record,
    eosId: EOS,
    quote: { totalPrice: 50 },
    validateQuote: async () => {}
  });
  assertHold(result);
  assert.equal(repository.wallets.get('econ_shop:NEXUS_POINTS').balance, 200);
  assert.equal(repository.orders.size, 0);
});

test('economy routes refuse each blocked status and still serve a verified member', async () => {
  for (const status of BLOCKED) {
    await withServer(status, async ({ port, worker }) => {
      const before = worker.balance(DISCORD);
      const spend = await call(port, '/wallet/spend', 'POST', { discordUserId: DISCORD, amount: 10, orderId: `spend_${status}` });
      const credit = await call(port, '/wallet/credit', 'POST', { discordUserId: DISCORD, amount: 10, idempotencyKey: `credit_${status}` });
      const shop = await call(port, '/shop/buy', 'POST', { discordUserId: DISCORD, eosId: EOS, itemId: 'metal', bundles: 1 });
      const sell = await call(port, '/shop/sell', 'POST', { discordUserId: DISCORD, eosId: EOS, itemId: 'metal', bundles: 1 });
      const presence = await call(port, '/presence', 'POST', { eosId: EOS, online: true, server: 'ark' });
      const passive = await call(port, '/wallet/accrue-offline', 'POST', { discordUserId: DISCORD });
      for (const response of [spend, credit, shop, presence, passive, sell]) assertHold(response.body);
      assert.equal(shop.status, 409);
      assert.equal(shop.body.order.status, 'ACCOUNT_HOLD');
      assert.equal(sell.body.order, null);
      assert.equal(worker.balance(DISCORD), before);
    });
  }

  await withServer('verified', async ({ port, worker }) => {
    const credit = await call(port, '/wallet/credit', 'POST', { discordUserId: DISCORD, amount: 20, idempotencyKey: 'verified_credit' });
    const spend = await call(port, '/wallet/spend', 'POST', { discordUserId: DISCORD, amount: 5, orderId: 'verified_spend' });
    const shop = await call(port, '/shop/buy', 'POST', { discordUserId: DISCORD, eosId: EOS, itemId: 'metal', bundles: 1 });
    const presence = await call(port, '/presence', 'POST', { eosId: EOS, online: true, server: 'ark' });
    assert.equal(credit.body.ok, true);
    assert.equal(spend.body.ok, true);
    assert.equal(shop.status, 200);
    assert.equal(shop.body.ok, true);
    assert.equal(presence.body.ok, true);
    assert.equal(presence.body.reason, undefined);
    assert.ok(worker.balance(DISCORD) > 0);
  });
});

test('minecraft buy and refund refuse each blocked status after the member was verified', async () => {
  for (const status of BLOCKED) {
    const { worker } = workerFixture('verified');
    const challenge = await worker.minecraft.challenge({ discordUserId: DISCORD, mcUuid: UUID, mcName: 'Steve' });
    assert.equal((await worker.minecraft.confirm({ discordUserId: DISCORD, code: challenge.code })).ok, true);
    const quoted = await worker.minecraft.quote({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1 });
    assert.equal(quoted.ok, true, quoted.reason);
    const state = worker.store.read();
    state.accounts[DISCORD].status = status;
    if (status === 'restricted') state.accounts[DISCORD].holdReason = 'staff';
    worker.store.write(state);
    const bought = await worker.minecraft.buy({
      discordUserId: DISCORD,
      sku: 'mc_logs64',
      bundles: 1,
      nonce: quoted.quote.nonce,
      writesEnabled: true
    });
    assertHold(bought);
    assert.equal(worker.balance(DISCORD), 500);
    assert.equal(worker.minecraft.orders.size, 0);

    state.accounts[DISCORD].status = 'verified';
    state.accounts[DISCORD].holdReason = '';
    worker.store.write(state);
    const paid = await worker.minecraft.buy({
      discordUserId: DISCORD,
      sku: 'mc_logs64',
      bundles: 1,
      nonce: quoted.quote.nonce,
      writesEnabled: true
    });
    assert.equal(paid.ok, true, paid.reason);
    const balanceAfterBuy = worker.balance(DISCORD);
    const fresh = worker.store.read();
    fresh.accounts[DISCORD].status = status;
    fresh.accounts[DISCORD].holdReason = status === 'restricted' ? 'staff' : '';
    worker.store.write(fresh);
    paid.order.status = 'SENT_UNCONFIRMED';
    const self = await worker.minecraft.refund({
      orderId: paid.order.orderId,
      reason: 'give me my points',
      actor: DISCORD,
      writesEnabled: true
    });
    assertHold(self);
    assert.equal(worker.balance(DISCORD), balanceAfterBuy);
    assert.notEqual(worker.minecraft.orders.get(paid.order.orderId).status, 'REFUNDED');
    const refunded = await worker.minecraft.refund({
      orderId: paid.order.orderId,
      reason: 'held account',
      actor: STAFF,
      writesEnabled: true
    });
    assert.equal(refunded.ok, true, JSON.stringify(refunded));
    assert.equal(worker.balance(DISCORD), 500);
    assert.equal(worker.minecraft.orders.get(paid.order.orderId).status, 'REFUNDED');
    assert.match(worker.minecraft.audits.at(-1).reason, /\[account-hold\]/);
  }
});

test('a concurrent JSON wallet status change is visible to the spend lock', async () => {
  const { worker } = workerFixture('verified');
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const blocker = worker.withLock(DISCORD, async () => {
    const state = worker.store.read();
    state.accounts[DISCORD].status = 'disabled';
    worker.store.write(state);
    await gate;
  });
  await new Promise((resolve) => setImmediate(resolve));
  const spendPromise = worker.spend({ discordUserId: DISCORD, amount: 10, orderId: 'json_race' });
  release();
  const spent = await spendPromise;
  await blocker;
  assertHold(spent);
  assert.equal(worker.balance(DISCORD), 500);
});

function accrualClient({ kind, status, flip = '' }) {
  const ledger = [];
  let locked = status;
  const identity = {
    economic_identity_id: 'econ_accrual',
    status,
    discord_user_id: DISCORD,
    mc_uuid: UUID
  };
  const client = {
    async query(sql) {
      const text = String(sql);
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK' || text === 'BEGIN READ ONLY') return { rows: [] };
      if (text.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (text.includes("i.status = 'verified'")) return { rows: status === 'verified' ? [identity] : [] };
      if (text.includes('status = ANY')) return { rows: status === 'verified' ? [] : [identity] };
      if (text.includes('SELECT status') && text.includes('nexus_economic_identities')) {
        if (flip) locked = flip;
        return { rows: [{ status: locked, hold_reason: locked === 'restricted' ? 'staff' : null }] };
      }
      if (text.includes('provider = \'eos\'') && text.includes('verified_at IS NOT NULL') && !text.includes('JOIN')) {
        return { rows: [{ '?column?': 1 }] };
      }
      if (text.includes('SELECT *') && text.includes('nexus_economy_accrual_state')) {
        return {
          rows: [{
            economic_identity_id: 'econ_accrual',
            rank_id: 'cipher-runner',
            online: true,
            online_uncredited_ms: 5 * 60_000,
            online_credit_cursor: 0,
            last_accounting_at: '2026-10-01T11:50:00.000Z',
            last_presence_at: '2026-10-01T11:59:00.000Z',
            offline_since: null,
            last_passive_at: '2026-10-01T06:00:00.000Z',
            passive_credit_cursor: 0,
            presence_by_server: { ark: { online: true, at: '2026-10-01T11:59:00.000Z' } }
          }]
        };
      }
      if (text.includes('SELECT balance')) return { rows: [{ balance: 0 }] };
      if (text.includes('nexus_economy_ledger') && text.includes('INSERT')) {
        ledger.push(text);
        return { rowCount: 1, rows: [{ id: 1 }] };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {}
  };
  return {
    ledger,
    pool: {
      async connect() { return client; },
      async query() { return { rows: [{ version: 1 }], rowCount: 1 }; }
    },
    kind
  };
}

test('ARK and passive points accrual refuse each blocked status under the wallet lock', async () => {
  for (const status of BLOCKED) {
    const presence = accrualClient({ status });
    const accrual = new PostgresEconomyAccrual({ pool: presence.pool, now: () => Date.parse('2026-10-01T12:00:00.000Z') });
    const earned = await accrual.recordPresence({ eosId: EOS, online: true, server: 'ark' });
    assertHold(earned);
    assert.equal(presence.ledger.length, 0);

    const passivePool = accrualClient({ status });
    const passive = new PostgresEconomyAccrual({ pool: passivePool.pool, now: () => Date.parse('2026-10-01T12:00:00.000Z') });
    const offline = await passive.accrueOffline(DISCORD);
    assertHold(offline);
    assert.equal(passivePool.ledger.length, 0);
  }

  const allowed = accrualClient({ status: 'verified' });
  const accrual = new PostgresEconomyAccrual({ pool: allowed.pool, now: () => Date.parse('2026-10-01T12:00:00.000Z') });
  const earned = await accrual.recordPresence({ eosId: EOS, online: true, server: 'ark' });
  assert.equal(earned.ok, true, JSON.stringify(earned));
  assert.equal(earned.reason, undefined);
  assert.ok(allowed.ledger.length > 0);

  const raced = accrualClient({ status: 'verified', flip: 'quarantined' });
  const racer = new PostgresEconomyAccrual({ pool: raced.pool, now: () => Date.parse('2026-10-01T12:00:00.000Z') });
  const denied = await racer.recordPresence({ eosId: EOS, online: true, server: 'ark' });
  assertHold(denied);
  assert.equal(raced.ledger.length, 0);
});

function shopClient({ status, flip = '', missingStatus = false } = {}) {
  const catalogHash = catalogFingerprint(loadMcShopCatalog());
  const writes = [];
  const audits = [];
  let locked = status;
  const quote = {
    nonce: 'logs-hold',
    discord_user_id: DISCORD,
    economic_identity_id: 'econ_shop',
    mc_uuid: UUID,
    sku: 'mc_logs64',
    bundles: 1,
    qty: 64,
    price: 10,
    item_id: 'minecraft:oak_log',
    catalog_version: 'test',
    catalog_hash: catalogHash,
    signature: '',
    expires_at: '2026-10-01T19:00:00.000Z',
    consumed_at: null
  };
  const order = {
    orderId: 'refund-hold',
    economicIdentityId: 'econ_shop',
    discordUserId: DISCORD,
    status: 'SENT_UNCONFIRMED',
    price: 10,
    sku: 'mc_logs64',
    refunded: false
  };
  const client = {
    async query(sql, params = []) {
      const text = String(sql);
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (text.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
      if (text.includes('nexus_mc_quotes') && text.includes('SELECT')) return { rows: [quote], rowCount: 1 };
      if (text.includes('nexus_mc_orders') && text.includes('WHERE nonce')) return { rows: [], rowCount: 0 };
      if (text.includes('SELECT order_data FROM')) return { rows: [{ order_data: order }], rowCount: 1 };
      if (text.includes('nexus_mc_grants') || (text.includes('nexus_mc_refund_audit') && text.includes('SELECT'))) return { rows: [], rowCount: 0 };
      if (text.includes('economicIdentityId')) return { rows: [], rowCount: 0 };
      if (text.includes('SELECT status') && text.includes('nexus_economic_identities')) {
        if (missingStatus) return { rows: [], rowCount: 0 };
        if (flip) locked = flip;
        return { rows: [{ status: locked, hold_reason: locked === 'restricted' ? 'staff' : null }], rowCount: 1 };
      }
      if (text.includes('INSERT') && text.includes('nexus_mc_refund_audit')) {
        audits.push(params);
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('SELECT balance')) return { rows: [{ balance: 100 }], rowCount: 1 };
      if (text.includes('nexus_economy_ledger') && text.includes('SELECT')) return { rows: [], rowCount: 0 };
      if (text.includes('UPDATE') || (text.includes('INSERT') && text.includes('nexus_economy_ledger')) || (text.includes('INSERT') && text.includes('nexus_mc_orders'))) {
        writes.push(text);
        return { rows: [{ id: 1 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {}
  };
  return {
    writes,
    audits,
    pool: {
      async query(sql) {
        const text = String(sql);
        if (text.includes('nexus_mc_schema_version') && text.includes('SELECT')) return { rows: [{ version: 1 }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      },
      async connect() { return client; }
    }
  };
}

test('postgres minecraft buy and refund refuse each blocked status inside the balance lock', async () => {
  for (const status of BLOCKED) {
    const bought = shopClient({ status });
    const buyer = new PostgresMcPoints({
      env: { MC_POINTS_ENABLED: 'true', MC_SHOP_ENABLED: 'true' },
      now: () => Date.parse('2026-10-01T18:00:00.000Z'),
      wallet: { async balance() { return 100; } },
      pool: bought.pool
    });
    const buy = await buyer.buy({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1, nonce: 'logs-hold', writesEnabled: true });
    assertHold(buy);
    assert.equal(bought.writes.length, 0);

    const refunded = shopClient({ status });
    const refunder = new PostgresMcPoints({
      env: { MC_POINTS_ENABLED: 'true', MC_SHOP_ENABLED: 'true', NEXUS_MC_REFUND_STAFF_IDS: STAFF },
      now: () => Date.parse('2026-10-01T18:00:00.000Z'),
      wallet: { async balance() { return 100; } },
      pool: refunded.pool
    });
    const selfClient = shopClient({ status });
    const member = new PostgresMcPoints({
      env: { MC_POINTS_ENABLED: 'true', MC_SHOP_ENABLED: 'true', NEXUS_MC_REFUND_STAFF_IDS: STAFF },
      now: () => Date.parse('2026-10-01T18:00:00.000Z'),
      wallet: { async balance() { return 100; } },
      pool: selfClient.pool
    });
    const self = await member.refund({ orderId: 'refund-hold', reason: 'my points', actor: DISCORD, writesEnabled: true });
    assertHold(self);
    assert.equal(selfClient.writes.length, 0);
    assert.equal(selfClient.audits.length, 0);

    const refund = await refunder.refund({ orderId: 'refund-hold', reason: 'held account', actor: STAFF, writesEnabled: true });
    assert.equal(refund.ok, true, JSON.stringify(refund));
    assert.ok(refunded.writes.length > 0);
    assert.match(String(refunded.audits[0]?.[2] || ''), /\[account-hold\]/);
  }

  const raced = shopClient({ status: 'verified', flip: 'disabled' });
  const buyer = new PostgresMcPoints({
    env: { MC_POINTS_ENABLED: 'true', MC_SHOP_ENABLED: 'true' },
    now: () => Date.parse('2026-10-01T18:00:00.000Z'),
    wallet: { async balance() { return 100; } },
    pool: raced.pool
  });
  const buy = await buyer.buy({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1, nonce: 'logs-hold', writesEnabled: true });
  assertHold(buy);
  assert.equal(raced.writes.length, 0);
});

test('held member routes render the exact hold sentence', async () => {
  assert.equal(mcMemberText('account-hold'), MESSAGE);
  assert.equal(mcMemberText('quarantined'), MESSAGE);
  assert.equal(reasonText('account-hold'), MESSAGE);
  assert.equal(reasonText('quarantined'), MESSAGE);
  assert.equal(mcShopBuyFailureText({ ok: false, reason: 'account-hold', balance: 1000 }, { quote: { price: 200, balance: 1000 } }), MESSAGE);
  assert.equal(mcShopBuyFailureText({ ok: false, reason: 'quarantined' }, {}), MESSAGE);
  assert.doesNotMatch(
    mcShopBuyFailureText({ ok: false, reason: 'insufficient-funds', balance: 1000 }, { quote: { price: 200, balance: 1000 } }),
    /on hold/
  );
  const falseBalance = orderFailureCopy({
    ok: false,
    reason: 'account-hold',
    message: MESSAGE,
    balance: 1000,
    order: { status: 'PAYMENT_REJECTED' }
  }, { price: 200, balance: 1000 });
  assert.equal(falseBalance, MESSAGE);
  assert.equal(orderFailureCopy({ ok: false, reason: 'quarantined', balance: 1000 }, { price: 200, balance: 1000 }), MESSAGE);
  assert.match(
    orderFailureCopy({ ok: false, reason: 'insufficient-funds', balance: 5, order: { status: 'PAYMENT_REJECTED' } }, { price: 20, balance: 5 }),
    /Not enough Nexus Points/
  );
  assert.doesNotMatch(
    orderFailureCopy({ ok: false, reason: 'account-hold', balance: 1000, order: { status: 'ACCOUNT_HOLD' } }, { price: 200, balance: 1000 }),
    /Not enough Nexus Points/
  );

  const replies = [];
  await handleMcPointsCommand({
    commandName: 'mc',
    user: { id: DISCORD },
    options: {
      getSubcommand: () => 'confirm',
      getSubcommandGroup: () => 'link',
      getString: () => 'ABC-DEF'
    },
    async reply(payload) { replies.push(payload.content || payload); }
  }, {
    ephemeral: (text) => ({ content: text }),
    points: { async confirm() { return { ok: false, reason: 'account-hold' }; } },
    env: {}
  });
  assert.equal(replies[0], MESSAGE);
});

test('postgres offline accrual skips held time instead of paying it later', async () => {
  const start = Date.parse('2026-10-01T06:00:00.000Z');
  let now = Date.parse('2026-10-01T12:00:00.000Z');
  let status = 'restricted';
  const ledger = [];
  const state = {
    economic_identity_id: 'econ_accrual',
    rank_id: 'cipher-runner',
    online: false,
    online_uncredited_ms: 0,
    online_credit_cursor: 0,
    last_accounting_at: new Date(start).toISOString(),
    last_presence_at: new Date(start).toISOString(),
    offline_since: new Date(start).toISOString(),
    last_passive_at: new Date(start).toISOString(),
    passive_credit_cursor: 0,
    presence_by_server: {}
  };
  const identity = { economic_identity_id: 'econ_accrual', status, discord_user_id: DISCORD };
  const client = {
    async query(sql, params = []) {
      const text = String(sql);
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (text.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
      if (text.includes("i.status = 'verified'")) return { rows: status === 'verified' ? [identity] : [] };
      if (text.includes('status = ANY')) return { rows: status === 'verified' ? [] : [{ ...identity, status }] };
      if (text.includes('SELECT status') && text.includes('nexus_economic_identities')) {
        return { rows: [{ status, hold_reason: status === 'restricted' ? 'staff' : null }] };
      }
      if (text.includes("provider = 'eos'") && !text.includes('JOIN')) return { rows: [{ '?column?': 1 }] };
      if (text.includes('nexus_economy_accrual_state') && (text.includes('SELECT *') || text.includes('FOR UPDATE'))) {
        return { rows: [{ ...state }], rowCount: 1 };
      }
      if (text.includes('SELECT balance')) return { rows: [{ balance: 0 }], rowCount: 1 };
      if (text.includes('UPDATE') && text.includes('offline_since = $2') && text.includes('last_presence_at = $2')) {
        state.online = false;
        state.online_since = null;
        state.offline_since = params[1];
        state.last_passive_at = params[1];
        state.last_presence_at = params[1];
        state.last_accounting_at = params[1];
        state.online_uncredited_ms = 0;
        return { rowCount: 1, rows: [] };
      }
      if (text.includes('UPDATE') && text.includes('last_accounting_at=$2')) {
        state.last_accounting_at = params[1];
        state.online_uncredited_ms = params[2];
        state.last_passive_at = params[3];
        return { rowCount: 1, rows: [] };
      }
      if (text.includes('UPDATE') && text.includes('last_passive_at=$5')) {
        state.online = params[1];
        state.online_since = params[2];
        state.offline_since = params[3];
        state.last_passive_at = params[4];
        state.passive_credit_cursor = params[5];
        return { rowCount: 1, rows: [] };
      }
      if (text.includes('nexus_economy_ledger') && text.includes('INSERT')) {
        ledger.push(params);
        return { rowCount: 1, rows: [{ id: ledger.length }] };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {}
  };
  const pool = { async connect() { return client; }, async query() { return { rows: [], rowCount: 0 }; } };
  const accrual = new PostgresEconomyAccrual({ pool, now: () => now });
  const held = await accrual.accrueOffline(DISCORD);
  assertHold(held);
  assert.equal(ledger.length, 0);
  assert.equal(state.last_passive_at, new Date(now).toISOString());

  status = 'verified';
  identity.status = 'verified';
  const after = await accrual.accrueOffline(DISCORD);
  assert.equal(after.ok, true, JSON.stringify(after));
  assert.equal(after.credited, 0);
  assert.equal(ledger.length, 0);

  now += 3_600_000;
  const nextHour = await accrual.accrueOffline(DISCORD);
  assert.equal(nextHour.ok, true, JSON.stringify(nextHour));
  assert.equal(nextHour.credited, 4);
  assert.equal(ledger.length, 1);
});

function backpayPool(state, statusBox, ledger) {
  const identity = { economic_identity_id: 'econ_accrual', discord_user_id: DISCORD };
  const client = {
    async query(sql, params = []) {
      const text = String(sql);
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (text.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
      if (text.includes("i.status = 'verified'")) return { rows: statusBox.status === 'verified' ? [{ ...identity, status: statusBox.status }] : [] };
      if (text.includes('status = ANY')) return { rows: statusBox.status === 'verified' ? [] : [{ ...identity, status: statusBox.status }] };
      if (text.includes('SELECT status') && text.includes('nexus_economic_identities')) {
        return { rows: [{ status: statusBox.status, hold_reason: statusBox.status === 'restricted' ? (statusBox.holdReason || 'staff') : null }] };
      }
      if (text.includes("provider = 'eos'") && !text.includes('JOIN')) return { rows: [{ '?column?': 1 }] };
      if (text.includes('nexus_economy_accrual_state') && (text.includes('SELECT *') || text.includes('FOR UPDATE'))) {
        return { rows: [{ ...state }], rowCount: 1 };
      }
      if (text.includes('SELECT balance')) return { rows: [{ balance: 0 }], rowCount: 1 };
      if (text.includes('UPDATE') && text.includes('offline_since = $2') && text.includes('last_presence_at = $2')) {
        state.online = false;
        state.online_since = null;
        state.offline_since = params[1];
        state.last_passive_at = params[1];
        state.last_presence_at = params[1];
        state.last_accounting_at = params[1];
        state.online_uncredited_ms = 0;
        return { rowCount: 1, rows: [] };
      }
      if (text.includes('UPDATE') && text.includes('last_passive_at=$5')) {
        state.online = params[1];
        state.online_since = params[2];
        state.offline_since = params[3];
        state.last_passive_at = params[4];
        state.passive_credit_cursor = params[5];
        return { rowCount: 1, rows: [] };
      }
      if (text.includes('nexus_economy_ledger') && text.includes('INSERT')) {
        ledger.push(params);
        return { rowCount: 1, rows: [{ id: ledger.length }] };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {}
  };
  return { async connect() { return client; }, async query() { return { rows: [], rowCount: 0 }; } };
}

test('online-at-hold and offline-at-hold both pay nothing for the held window after the lift', async () => {
  const start = Date.parse('2026-10-01T06:00:00.000Z');
  let now = Date.parse('2026-10-01T12:00:00.000Z');
  const statusBox = { status: 'restricted' };
  const ledger = [];
  const onlineState = {
    economic_identity_id: 'econ_accrual',
    rank_id: 'cipher-runner',
    online: true,
    online_uncredited_ms: 5 * 60_000,
    online_credit_cursor: 0,
    last_accounting_at: new Date(start).toISOString(),
    last_presence_at: new Date(start).toISOString(),
    offline_since: null,
    last_passive_at: new Date(start).toISOString(),
    passive_credit_cursor: 0,
    presence_by_server: { ark: { online: true, at: new Date(start).toISOString() } }
  };
  const accrual = new PostgresEconomyAccrual({ pool: backpayPool(onlineState, statusBox, ledger), now: () => now });
  const ping = await accrual.recordPresence({ eosId: EOS, online: true, server: 'ark' });
  assertHold(ping);
  assert.equal(ledger.length, 0);
  assert.equal(onlineState.online, false);
  assert.equal(onlineState.last_passive_at, new Date(now).toISOString());
  assert.equal(onlineState.last_presence_at, new Date(now).toISOString());
  assert.equal(onlineState.offline_since, new Date(now).toISOString());

  statusBox.status = 'verified';
  const lifted = await accrual.accrueOffline(DISCORD);
  assert.equal(lifted.ok, true, JSON.stringify(lifted));
  assert.equal(lifted.credited, 0);
  assert.equal(ledger.length, 0);

  now += 3_600_000;
  const nextHour = await accrual.accrueOffline(DISCORD);
  assert.equal(nextHour.credited, 4);
  assert.equal(ledger.length, 1);

  now = Date.parse('2026-10-01T12:00:00.000Z');
  statusBox.status = 'restricted';
  ledger.length = 0;
  const offlineState = {
    ...onlineState,
    online: false,
    online_uncredited_ms: 0,
    last_accounting_at: new Date(start).toISOString(),
    last_presence_at: new Date(start).toISOString(),
    offline_since: new Date(start).toISOString(),
    last_passive_at: new Date(start).toISOString(),
    passive_credit_cursor: 0,
    presence_by_server: {}
  };
  const offline = new PostgresEconomyAccrual({ pool: backpayPool(offlineState, statusBox, ledger), now: () => now });
  const heldOffline = await offline.accrueOffline(DISCORD);
  assertHold(heldOffline);
  assert.equal(ledger.length, 0);
  assert.equal(offlineState.last_passive_at, new Date(now).toISOString());
  statusBox.status = 'verified';
  const afterOffline = await offline.accrueOffline(DISCORD);
  assert.equal(afterOffline.ok, true, JSON.stringify(afterOffline));
  assert.equal(afterOffline.credited, 0);
  assert.equal(ledger.length, 0);
});

test('a missing identity row is held for member spend and accrual', async () => {
  const missing = memberIdentityHold({ missingRow: true, status: 'verified', economicIdentityId: 'econ_missing' });
  assert.equal(missing.reason, 'account-hold');
  assert.equal(missing.message, MESSAGE);
  const denylisted = memberIdentityHold({
    missingRow: true,
    economicIdentityId: 'econ_q',
    env: { NEXUS_ECONOMY_QUARANTINE_DENYLIST: 'econ_q' }
  });
  assert.equal(denylisted.reason, 'quarantined');
  assert.equal(denylisted.message, MESSAGE);

  const repository = new LockingRepo();
  repository.link(DISCORD, 'econ_missing', { status: 'verified', verifiedAt: '2026-09-12T00:00:00.000Z' });
  repository.links.delete('id:econ_missing');
  const wallet = new NexusEconomyWalletCore({ repository, now: () => new Date('2026-10-01T00:00:00.000Z') });
  const spent = await wallet.spend({ discordUserId: DISCORD, amount: 10, orderId: 'missing_row' });
  assertHold(spent);
  assert.equal(repository.ledger.size, 0);

  const queries = [];
  const accrual = new PostgresEconomyAccrual({
    pool: {
      async query() { return { rows: [], rowCount: 0 }; },
      async connect() {
        return {
          async query(sql) {
            const text = String(sql);
            queries.push(text);
            if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK' || text.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
            if (text.includes("i.status = 'verified'")) return { rows: [{ economic_identity_id: 'econ_missing', discord_user_id: DISCORD }] };
            return { rows: [], rowCount: 0 };
          },
          release() {}
        };
      }
    },
    now: () => Date.parse('2026-10-01T12:00:00.000Z')
  });
  const earned = await accrual.accrueOffline(DISCORD);
  assertHold(earned);
  assert.equal(queries.some((sql) => /nexus_economy_ledger/i.test(sql)), false);

  const bought = shopClient({ status: 'verified', missingStatus: true });
  const buyer = new PostgresMcPoints({
    env: { MC_POINTS_ENABLED: 'true', MC_SHOP_ENABLED: 'true' },
    now: () => Date.parse('2026-10-01T18:00:00.000Z'),
    wallet: { async balance() { return 100; } },
    pool: bought.pool
  });
  const buy = await buyer.buy({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1, nonce: 'logs-hold', writesEnabled: true });
  assertHold(buy);
  assert.equal(bought.writes.length, 0);
});

function confirmInteraction(sessionId) {
  const edits = [];
  const interaction = {
    customId: `nexus-shop:confirm:${sessionId}`,
    id: `ix-${sessionId}`,
    user: { id: DISCORD },
    deferred: false,
    replied: false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    async deferUpdate() { this.deferred = true; },
    async editReply(payload) { edits.push(payload); },
    async update(payload) { edits.push(payload); },
    async reply(payload) { edits.push(payload); }
  };
  return { interaction, edits };
}

test('PG cluster buy and shop confirm show the hold sentence', async () => {
  assert.deepEqual(publicRequestError(new Error('Economic identity is disabled.')), {
    statusCode: 409,
    body: { ok: false, reason: 'account-hold', message: MESSAGE, error: MESSAGE, credited: 0 }
  });
  assert.equal(publicRequestError(new Error('database offline')).body.error, 'internal-error');

  const hits = [];
  const worker = {
    async linkArkIdentity() {
      hits.push('/identity/link');
      throw new Error('Economic identity is disabled.');
    }
  };
  const shop = {
    createBuyOrder() {
      hits.push('/shop/buy');
      return { ok: true };
    },
    listCatalog() { return []; }
  };
  const runtime = createEconomyServer({ worker, shop, token: TOKEN, writesEnabled: true });
  const port = await new Promise((resolve) => runtime.server.listen(0, '127.0.0.1', () => resolve(runtime.server.address().port)));
  const priorUrl = process.env.NEXUS_ECONOMY_URL;
  const priorToken = process.env.NEXUS_ECONOMY_TOKEN;
  process.env.NEXUS_ECONOMY_URL = `http://127.0.0.1:${port}`;
  process.env.NEXUS_ECONOMY_TOKEN = TOKEN;
  try {
    const direct = await call(port, '/identity/link', 'POST', { discordUserId: DISCORD, eosId: EOS });
    assert.equal(direct.status, 409);
    assert.equal(direct.body.message, MESSAGE);
    assert.equal(direct.body.error, MESSAGE);

    hits.length = 0;
    const client = new NexusEconomyClient({
      identityStoreFactory: () => ({
        profileByDiscord: (id) => (id === DISCORD ? { discordUserId: DISCORD, rankId: 'cipher-runner', arkAccounts: [{ eosId: EOS }] } : null)
      }),
      memberVerificationStoreFactory: () => ({
        get: (id) => (String(id) === DISCORD ? { discordUserId: DISCORD, state: 'verified' } : null)
      })
    });
    const buy = await client.shopBuy({ discordUserId: DISCORD, eosId: EOS, itemId: 'metal', bundles: 1, idempotencyKey: 'hold-buy' });
    assertHold(buy);
    assert.deepEqual(hits, ['/identity/link']);

    hits.length = 0;
    worker.linkArkIdentity = async () => {
      hits.push('/identity/link');
      return { ok: false, reason: 'quarantined', message: MESSAGE, status: 'quarantined' };
    };
    const quarantined = await client.shopBuy({ discordUserId: DISCORD, eosId: EOS, itemId: 'metal', bundles: 1, idempotencyKey: 'hold-buy-q' });
    assert.equal(quarantined.ok, false);
    assert.equal(quarantined.reason, 'quarantined');
    assert.equal(quarantined.message, MESSAGE);
    assert.deepEqual(hits, ['/identity/link']);
  } finally {
    if (priorUrl == null) delete process.env.NEXUS_ECONOMY_URL; else process.env.NEXUS_ECONOMY_URL = priorUrl;
    if (priorToken == null) delete process.env.NEXUS_ECONOMY_TOKEN; else process.env.NEXUS_ECONOMY_TOKEN = priorToken;
    await new Promise((resolve) => runtime.server.close(resolve));
  }

  const identityStore = {
    read() {
      return { profiles: { [DISCORD]: { arkAccounts: [{ eosId: EOS }] } } };
    }
  };
  const session = () => newSession({
    userId: DISCORD,
    action: 'buy',
    itemId: 'metal',
    bundles: 1,
    quote: { totalPrice: 50 },
    catalog: []
  });

  const returned = confirmInteraction(session());
  await handleInteraction(returned.interaction, {
    economyClient: {
      async shopBuy() {
        return { ok: false, reason: 'account-hold', message: MESSAGE, balance: 1000 };
      }
    },
    identityStore
  });
  assert.equal(returned.edits.at(-1).content, MESSAGE);
  assert.doesNotMatch(returned.edits.at(-1).content, /Cluster Shop error|Not enough Nexus Points/);

  const thrown = confirmInteraction(session());
  await handleInteraction(thrown.interaction, {
    economyClient: {
      async shopBuy() { throw new Error('Economic identity is disabled.'); }
    },
    identityStore
  });
  assert.equal(thrown.edits.at(-1).content, MESSAGE);
  assert.doesNotMatch(thrown.edits.at(-1).content, /Cluster Shop error|internal-error/);

  const other = confirmInteraction(session());
  await handleInteraction(other.interaction, {
    economyClient: {
      async shopBuy() { throw new Error('database offline'); }
    },
    identityStore
  });
  assert.match(other.edits.at(-1).content, /❌ Cluster Shop error: database offline/);
});

test('JSON and memory identity reads fail closed when status is missing', async () => {
  const { worker } = workerFixture('verified');
  const state = worker.store.read();
  delete state.accounts[DISCORD].status;
  worker.store.write(state);
  const spent = await worker.spend({ discordUserId: DISCORD, amount: 10, orderId: 'missing_status' });
  assertHold(spent);
  assert.equal(worker.balance(DISCORD), 500);
  const resolved = await worker.minecraft.wallet.resolve(DISCORD);
  assert.equal(resolved.status, '');
  const memoryHold = await worker.minecraft.wallet.resolve(DISCORD);
  assert.equal(String(memoryHold.status || ''), '');
});

test('an unmarked restricted wallet is not shown the hold sentence', async () => {
  const { worker } = workerFixture('restricted', { holdReason: '' });
  const spent = await worker.spend({ discordUserId: DISCORD, amount: 10, orderId: 'shadow_np' });
  assert.equal(spent.ok, false);
  assert.equal(spent.reason, 'verified-identity-required');
  assert.doesNotMatch(String(spent.message || ''), /on hold/);
  assert.equal(worker.balance(DISCORD), 500);
});

test('CREDIT_FAILED sell orders retry once after the hold lifts', async () => {
  const { worker, shop } = workerFixture('verified');
  const created = await shop.createSellOrder({ discordUserId: DISCORD, eosId: EOS, itemId: 'metal', bundles: 1 });
  assert.equal(created.ok, true, JSON.stringify(created));
  const heldState = worker.store.read();
  heldState.accounts[DISCORD].status = 'disabled';
  worker.store.write(heldState);
  const failed = await shop.confirmSellRemoval({ orderId: created.order.orderId, removalReceipt: 'removed-1' });
  assert.equal(failed.ok, false);
  assert.equal(failed.order.status, 'CREDIT_FAILED');
  const heldSweep = await shop.sweepCreditFailedSells();
  assert.equal(heldSweep[0].skipped, 'account-hold');
  await shop.sweepCreditFailedSells();
  await shop.sweepCreditFailedSells();
  const heldAudits = (shop.store.read().audits || []).filter((row) => row.type === 'credit-failed-retry');
  assert.equal(heldAudits.length, 1);
  assert.equal(shop.store.read().orders[created.order.orderId].creditRetries.length, 1);
  assert.equal(shop.store.read().orders[created.order.orderId].status, 'CREDIT_FAILED');
  const lifted = worker.store.read();
  lifted.accounts[DISCORD].status = 'verified';
  lifted.accounts[DISCORD].holdReason = '';
  worker.store.write(lifted);
  const before = worker.balance(DISCORD);
  const swept = await shop.sweepCreditFailedSells();
  assert.equal(swept[0].ok, true, JSON.stringify(swept));
  assert.equal(shop.store.read().orders[created.order.orderId].status, 'COMPLETE');
  const price = created.order.quote.totalPrice;
  assert.equal(worker.balance(DISCORD), before + price);
  const again = await shop.sweepCreditFailedSells();
  assert.equal(again.length, 0);
  assert.equal(worker.balance(DISCORD), before + price);
  const audits = shop.store.read().audits || [];
  assert.ok(audits.some((row) => row.skipped === 'account-hold'));
  assert.ok(audits.some((row) => row.ok === true && row.reason === 'credited'));
});

test('the shop delivery sweep asks for CREDIT_FAILED retries', async () => {
  const calls = [];
  const economyClient = {
    configured: () => true,
    async sweepCreditFailedSells() {
      calls.push('sweep');
      return { ok: true, results: [{ orderId: 'NXSELL-1', ok: true }] };
    },
    async pendingShopOrders() {
      calls.push('pending');
      return { orders: [] };
    }
  };
  const results = await runCycle({ economyClient });
  assert.equal(calls[0], 'sweep');
  assert.ok(results.some((row) => Array.isArray(row.creditFailedSweep)));
});

test('hold apply and lift checkpoint the passive cursor', async () => {
  const calls = [];
  const client = {
    async query(text, params = []) {
      calls.push({ text: String(text), params });
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (/nexus_economic_identity_links/.test(text) && /SELECT/.test(text)) return { rows: [{ economic_identity_id: 'econ_cp' }] };
      if (/SELECT economic_identity_id, status, hold_reason, held_by/.test(text)) {
        return { rows: [{ economic_identity_id: 'econ_cp', status: 'verified', hold_reason: 'staff', held_by: STAFF }] };
      }
      if (/INSERT INTO/.test(text) && /nexus_economy_identity_hold_audit/.test(text)) return { rows: [{ audit_id: 7 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {}
  };
  const repository = new NexusEconomyPostgresRuntimeRepository({
    pool: {
      async connect() { return client; },
      async query() { return { rows: [], rowCount: 0 }; }
    },
    now: () => Date.parse('2026-10-03T00:00:00.000Z')
  });
  const applied = await repository.placeStaffHold(DISCORD, { reason: 'staff', heldBy: STAFF });
  assert.equal(applied.checkpointAt, '2026-10-03T00:00:00.000Z');
  assert.equal(applied.auditId, 7);
  const applyUpdate = calls.find((call) => /nexus_economy_accrual_state SET online = false/.test(call.text));
  assert.equal(applyUpdate.params[1], '2026-10-03T00:00:00.000Z');
  const placeAudit = calls.find((call) => /INSERT INTO/.test(call.text) && /nexus_economy_identity_hold_audit/.test(call.text));
  assert.deepEqual(placeAudit.params, ['econ_cp', 'place', 'staff', 'staff', STAFF, '2026-10-03T00:00:00.000Z']);
  const placeCommit = calls.findIndex((call) => call.text === 'COMMIT');
  const placeAuditAt = calls.indexOf(placeAudit);
  const placeLock = calls.findIndex((call) => /SELECT economic_identity_id, status, hold_reason, held_by/.test(call.text) && /FOR UPDATE/.test(call.text));
  assert.ok(placeLock >= 0 && placeLock < placeAuditAt && placeAuditAt < placeCommit);
  calls.length = 0;
  const lifted = await repository.liftIdentityHold(DISCORD, { actor: STAFF });
  assert.equal(lifted.lifted, true);
  assert.equal(lifted.checkpointAt, '2026-10-03T00:00:00.000Z');
  assert.equal(lifted.auditId, 7);
  const liftUpdate = calls.find((call) => /nexus_economy_accrual_state SET online = false/.test(call.text));
  assert.ok(liftUpdate);
  assert.equal(liftUpdate.params[1], '2026-10-03T00:00:00.000Z');
  const liftAudit = calls.find((call) => /INSERT INTO/.test(call.text) && /nexus_economy_identity_hold_audit/.test(call.text));
  assert.equal(liftAudit.params[1], 'lift');
  assert.equal(liftAudit.params[3], 'staff');
  assert.equal(liftAudit.params[4], STAFF);
  assert.ok(calls.indexOf(liftAudit) < calls.findIndex((call) => call.text === 'COMMIT'));
});

test('legacy-review backfill takes the advisory lock before creating tables and ignores coin ledger rows', async () => {
  const calls = [];
  const client = {
    async query(text) {
      calls.push(String(text));
      if (/schema_migrations WHERE/.test(text)) return { rows: [] };
      if (/hold_reason = 'legacy-review'/.test(text)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    },
    release() {}
  };
  const repository = new NexusEconomyPostgresRuntimeRepository({
    pool: {
      async connect() { return client; },
      async query() { return { rows: [], rowCount: 0 }; }
    }
  });
  const result = await repository.backfillLegacyRestrictedHolds();
  assert.equal(result.ok, true);
  assert.equal(result.marked, 0);
  const lockAt = calls.findIndex((text) => /pg_advisory_xact_lock/.test(text));
  const migrationsAt = calls.findIndex((text) => /CREATE TABLE IF NOT EXISTS/.test(text) && /nexus_economy_schema_migrations/.test(text));
  const auditAt = calls.findIndex((text) => /CREATE TABLE IF NOT EXISTS/.test(text) && /nexus_economy_identity_hold_audit/.test(text));
  const updateAt = calls.findIndex((text) => /hold_reason = 'legacy-review'/.test(text));
  assert.ok(lockAt > calls.indexOf('BEGIN'));
  assert.ok(migrationsAt > lockAt);
  assert.ok(auditAt > lockAt && auditAt < updateAt);
  assert.match(calls[updateAt], /g\.currency IN \('NEXUS_POINTS', 'DINO_CACHE_TOKENS'\)/);
  assert.doesNotMatch(calls[updateAt], /NEXUS_COINS/);
});

test('a staff hold rolls back when the audit insert fails', async () => {
  const calls = [];
  const client = {
    async query(text) {
      calls.push(String(text));
      if (/INSERT INTO/.test(text) && /nexus_economy_identity_hold_audit/.test(text)) throw new Error('audit down');
      if (/SELECT economic_identity_id, status, hold_reason, held_by/.test(text)) {
        return { rows: [{ economic_identity_id: 'econ_cp', status: 'restricted', hold_reason: null, held_by: null }] };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {}
  };
  const repository = new NexusEconomyPostgresRuntimeRepository({
    pool: {
      async connect() { return client; },
      async query() { return { rows: [], rowCount: 0 }; }
    }
  });
  await assert.rejects(
    () => repository.placeIdentityHold('econ_cp', { reason: 'staff', heldBy: 'ops' }),
    /audit down/
  );
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.equal(calls.includes('COMMIT'), false);
  const lockAt = calls.findIndex((text) => /FOR UPDATE/.test(text));
  const updateAt = calls.findIndex((text) => /SET hold_reason/.test(text));
  assert.ok(lockAt >= 0 && lockAt < updateAt);
});

test('offline accrual pays nothing for held time when the lift checkpointed the cursor and nobody pinged', async () => {
  const start = Date.parse('2026-10-01T06:00:00.000Z');
  const lift = Date.parse('2026-10-01T18:00:00.000Z');
  let now = lift;
  const ledger = [];
  const state = {
    economic_identity_id: 'econ_accrual',
    rank_id: 'cipher-runner',
    online: false,
    online_uncredited_ms: 0,
    online_credit_cursor: 0,
    last_accounting_at: new Date(start).toISOString(),
    last_presence_at: new Date(start).toISOString(),
    offline_since: new Date(lift).toISOString(),
    last_passive_at: new Date(lift).toISOString(),
    passive_credit_cursor: 0,
    presence_by_server: {}
  };
  const accrual = new PostgresEconomyAccrual({
    pool: backpayPool(state, { status: 'verified' }, ledger),
    now: () => now
  });
  const immediate = await accrual.accrueOffline(DISCORD);
  assert.equal(immediate.ok, true, JSON.stringify(immediate));
  assert.equal(immediate.credited, 0);
  assert.equal(ledger.length, 0);
  now += 3_600_000;
  const nextHour = await accrual.accrueOffline(DISCORD);
  assert.equal(nextHour.credited, 4);
  assert.equal(ledger.length, 1);
});
