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

  link(discordUserId, economicIdentityId, { status = 'verified', verifiedAt = '2026-09-12T00:00:00.000Z' } = {}) {
    const row = {
      economic_identity_id: economicIdentityId,
      status,
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
        if (this.flip) row.status = this.flip;
        return row ? { economic_identity_id: economicIdentityId, status: row.status } : null;
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

function workerFixture(status = 'verified') {
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
  state.accounts[DISCORD].status = status;
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
  assert.equal(memberIdentityHold({ status: 'verified', economicIdentityId: 'econ_ok' }), null);
  assert.equal(memberIdentityHold({ status: 'verified', economicIdentityId: 'econ_q', env: { NEXUS_ECONOMY_QUARANTINE_DENYLIST: 'econ_q' } }).reason, 'quarantined');
  assert.equal(MEMBER_HOLD_MESSAGE, MESSAGE);
});

test('wallet spend and non-level-up credit refuse each blocked status and still allow verified', async () => {
  for (const status of BLOCKED) {
    const repository = new LockingRepo();
    repository.link(DISCORD, 'econ_hold', { status, verifiedAt: '2026-09-12T00:00:00.000Z' });
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
  const spent = await wallet.spend({ discordUserId: DISCORD, amount: 1, orderId: 'no_spend', currency: 'NEXUS_COINS' });
  assertHold(spent);
  assert.equal(repository.wallets.get('econ_level:NEXUS_COINS').balance, 25);
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
      const presence = await call(port, '/presence', 'POST', { eosId: EOS, online: true, server: 'ark' });
      const passive = await call(port, '/wallet/accrue-offline', 'POST', { discordUserId: DISCORD });
      for (const response of [spend, credit, shop, presence, passive]) assertHold(response.body);
      assert.equal(shop.status, 409);
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
    worker.store.write(fresh);
    paid.order.status = 'SENT_UNCONFIRMED';
    const refunded = await worker.minecraft.refund({
      orderId: paid.order.orderId,
      reason: 'held account',
      actor: STAFF,
      writesEnabled: true
    });
    assertHold(refunded);
    assert.equal(worker.balance(DISCORD), balanceAfterBuy);
    assert.notEqual(worker.minecraft.orders.get(paid.order.orderId).status, 'REFUNDED');
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
        return { rows: [{ status: locked }] };
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

function shopClient({ status, flip = '' }) {
  const catalogHash = catalogFingerprint(loadMcShopCatalog());
  const writes = [];
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
    async query(sql) {
      const text = String(sql);
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (text.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
      if (text.includes('nexus_mc_quotes') && text.includes('SELECT')) return { rows: [quote], rowCount: 1 };
      if (text.includes('nexus_mc_orders') && text.includes('WHERE nonce')) return { rows: [], rowCount: 0 };
      if (text.includes('SELECT order_data FROM')) return { rows: [{ order_data: order }], rowCount: 1 };
      if (text.includes('nexus_mc_grants') || (text.includes('nexus_mc_refund_audit') && text.includes('SELECT'))) return { rows: [], rowCount: 0 };
      if (text.includes('economicIdentityId')) return { rows: [], rowCount: 0 };
      if (text.includes('SELECT status') && text.includes('nexus_economic_identities')) {
        if (flip) locked = flip;
        return { rows: [{ status: locked }], rowCount: 1 };
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
    const refund = await refunder.refund({ orderId: 'refund-hold', reason: 'held account', actor: STAFF, writesEnabled: true });
    assertHold(refund);
    assert.equal(refunded.writes.length, 0);
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
