'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PostgresEconomyPersistence } = require('../src/economy-worker/postgres-persistence.cjs');
const { createEconomyService } = require('../src/economy-worker/entry.cjs');
let PGlite;
try { ({ PGlite } = require('@electric-sql/pglite')); } catch {}

const env = { NEXUS_ECONOMY_WRITES_ENABLED: 'true', NEXUS_ECONOMY_TOKEN: 'test-auth-'.repeat(8), NEXUS_ECONOMY_RECOVERY_TOKEN: 'test-recovery-'.repeat(8), NEXUS_CLUSTER_SHOP_CHECKOUT_ENABLED: 'true', NEXUS_ECONOMY_AUTHORITY: 'nexus' };
async function fixture(t) {
  const db = await PGlite.create();
  const pool = { query: (sql, args) => db.query(sql, args), connect: async () => ({ query: (sql, args) => db.query(sql, args), release() {} }), end: () => db.close() };
  const persistence = new PostgresEconomyPersistence({ pool });
  const app = createEconomyService({ persistence, env });
  await app.initialize();
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); await persistence.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (path, data, admin = false) => {
    const res = await fetch(base + path, { method: data ? 'POST' : 'GET', headers: { authorization: `Bearer ${admin ? env.NEXUS_ECONOMY_RECOVERY_TOKEN : env.NEXUS_ECONOMY_TOKEN}`, 'content-type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) });
    return { status: res.status, ...await res.json() };
  };
  return { db, pool, persistence, app, call, base };
}

test('Postgres HTTP path commits wallet and checkout once, persists, and refunds once', { skip: !PGlite }, async t => {
  const { call, db, persistence, app } = await fixture(t);
  assert.equal((await call('/health/ready')).storage, 'postgres');
  await call('/identity/link', { discordUserId: '1234567890', eosId: 'EOS_test_1234' });
  assert.equal((await call('/wallet/1234567890')).balance, 0);
  await call('/wallet/credit', { discordUserId: '1234567890', amount: 1000, idempotencyKey: 'seed' });
  const catalog = await call('/shop/catalog');
  const item = catalog.items[0];
  const quote = (await call('/shop/quote', { itemId: item.id, bundles: 1 })).quote;
  const input = { discordUserId: '1234567890', eosId: 'EOS_test_1234', itemId: item.id, bundles: 1, idempotencyKey: 'checkout', expectedQuote: quote };
  const replies = await Promise.all(Array.from({ length: 8 }, () => call('/shop/buy', input)));
  assert.ok(replies.every(r => r.ok));
  assert.equal(new Set(replies.map(r => r.order.orderId)).size, 1);
  assert.equal((await call('/wallet/1234567890')).balance, 1000 - quote.totalPrice);
  const order = replies[0].order;
  const claims = await Promise.all([1, 2].map(() => call('/shop/buy/delivery-status', { orderId: order.orderId, status: 'DELIVERY_IN_PROGRESS' })));
  assert.equal(claims.filter(c => c.ok).length, 1);
  const claimId = claims.find(c => c.ok).order.claimId;
  await call('/shop/buy/delivery-status', { orderId: order.orderId, status: 'SENT_UNCONFIRMED', claimId });
  const resolution = { orderId: order.orderId, action: 'refund', actorDiscordUserId: '9876543210', evidence: 'Test inventory verified empty after stopping delivery worker', expectedStatus: 'SENT_UNCONFIRMED', deliveryStopped: true, itemsNotReceived: true };
  assert.equal((await call('/admin/order/resolve', resolution)).status, 401);
  assert.equal((await call('/admin/order/resolve', resolution, true)).ok, true);
  assert.equal((await call('/admin/order/resolve', resolution, true)).duplicate, true);
  assert.equal((await call('/wallet/1234567890')).balance, 1000);
  const persisted = (await db.query('SELECT state FROM nexus_economy_state WHERE id=1')).rows[0].state;
  assert.equal(persisted.shop.orders[order.orderId].status, 'REFUNDED');
  assert.equal(persisted.wallet.accounts['1234567890'].balance, 1000);
  // A failed action must not persist a successful in-memory credit.
  await assert.rejects(persistence.transaction(async () => { await app.worker.credit({ discordUserId: '1234567890', amount: 50, idempotencyKey: 'rollback' }); throw new Error('crash before commit'); }), /crash/);
  assert.equal((await call('/wallet/1234567890')).balance, 1000);
  assert.equal((await call('/shop/sell', {})).status, 503);
});

test('database rollback on order write failure preserves both balance and order state', { skip: !PGlite }, async t => {
  const { app, call } = await fixture(t);
  await call('/identity/link', { discordUserId: '1234567890', eosId: 'EOS_test_1234' });
  await call('/wallet/credit', { discordUserId: '1234567890', amount: 1000, idempotencyKey: 'seed' });
  const item = (await call('/shop/catalog')).items[0];
  const original = app.shop.store.write;
  app.shop.store.write = state => { if (Object.values(state.orders).some(o => o.status === 'PAID_QUEUED')) throw new Error('simulated crash after debit'); return original(state); };
  assert.equal((await call('/shop/buy', { discordUserId: '1234567890', eosId: 'EOS_test_1234', itemId: item.id, idempotencyKey: 'crash' })).status, 400);
  app.shop.store.write = original;
  assert.equal((await call('/wallet/1234567890')).balance, 1000);
  assert.equal((await call('/shop/orders/pending')).orders.length, 0);
});
