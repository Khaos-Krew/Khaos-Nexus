'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { NexusEconomyWalletCore } = require('../src/sentinel/nexus-economy-wallet-core.cjs');
const { createNexusEconomyPurchaseOutboxRecord } = require('../src/sentinel/nexus-economy-purchase-outbox-record.cjs');

function purchase(orderId = 'order_1', balance = 60) {
  const planDigest = createHash('sha256').update(orderId).digest('hex');
  const record = createNexusEconomyPurchaseOutboxRecord().prepare({
    ok: true, actionReady: true, queueWritePermitted: false, executionPermitted: false,
    schemaVersion: 2, actionId: `action_${planDigest.slice(0,24)}`,
    type: 'nexus.economy.purchase', capability: 'economy.purchase.execute',
    subject: 'discord-user:123456789', correlationId: orderId, requestId: orderId,
    idempotencyKey: orderId, orderId, planId: `plan_${orderId}`,
    payload: { planId: `plan_${orderId}`, planDigest, discordUserId: '123456789',
      itemId: 'metal', quantity: 1, currency: 'Nexus Points', totalPrice: 40,
      projectedBalance: balance, fulfillment: 'rewards-ascended-item' }
  });
  return { record, eosId: 'EOS_verified', quote: { totalPrice: 40 }, validateQuote: async () => {} };
}

class TransactionRepository {
  constructor() {
    this.state = { balance: 100, ledger: {}, orders: {}, outbox: {} };
    this.tail = Promise.resolve(); this.fail = null; this.verified = true;
  }
  transact(id, work) {
    const run = this.tail.then(async () => {
      const next = structuredClone(this.state);
      const tx = {
        findOrder: async (key) => next.orders[key] || null,
        findIdentity: async () => this.verified ? { discord_user_id: id } : null,
        getOrCreateAccount: async () => ({ balance: next.balance }),
        findLedgerByKey: async (key) => next.ledger[key] || null,
        appendLedger: async (entry) => { next.ledger[entry.idempotencyKey] = { ...entry, id: 'ledger_1' }; return { id: 'ledger_1' }; },
        setBalance: async (_id, balance) => { next.balance = balance; },
        appendOrder: async (order) => { if (this.fail === 'order') throw new Error('order write failed'); next.orders[order.orderId] = order; },
        appendOutbox: async (record) => { if (this.fail === 'outbox') throw new Error('outbox write failed'); next.outbox[record.recordId] = record; }
      };
      const result = await work(tx);
      this.state = next;
      return result;
    });
    this.tail = run.catch(() => {});
    return run;
  }
}
function fixture() {
  const repository = new TransactionRepository();
  return { repository, wallet: new NexusEconomyWalletCore({ repository }) };
}

test('purchase debit, order, ledger and outbox commit together and survive retries', async () => {
  const { wallet, repository } = fixture();
  const input = purchase();
  const first = await wallet.commitPurchase(input);
  const restarted = new NexusEconomyWalletCore({ repository });
  const retry = await restarted.commitPurchase({ ...input, validateQuote: async () => { throw new Error('expired'); } });
  assert.equal(first.balance, 60);
  assert.equal(retry.duplicate, true);
  assert.deepEqual(first.order, retry.order);
  assert.equal(Object.keys(repository.state.ledger).length, 1);
  assert.equal(Object.keys(repository.state.orders).length, 1);
  assert.equal(Object.keys(repository.state.outbox).length, 1);
});

test('order or outbox failure rolls back the debit and every partial write', async () => {
  for (const failure of ['order', 'outbox']) {
    const { wallet, repository } = fixture();
    const before = structuredClone(repository.state);
    repository.fail = failure;
    await assert.rejects(wallet.commitPurchase(purchase()), /write failed/);
    assert.deepEqual(repository.state, before);
    repository.fail = null;
    assert.equal((await wallet.commitPurchase(purchase())).balance, 60);
  }
});

test('concurrent duplicate purchases produce a single charge and outbox', async () => {
  const { wallet, repository } = fixture();
  const results = await Promise.all(Array.from({ length: 10 }, () => wallet.commitPurchase(purchase())));
  assert.equal(results.filter((r) => !r.duplicate).length, 1);
  assert.equal(repository.state.balance, 60);
  assert.equal(Object.keys(repository.state.outbox).length, 1);
});

test('concurrent purchases cannot overspend', async () => {
  const { wallet, repository } = fixture();
  repository.state.balance = 50;
  const results = await Promise.all([wallet.commitPurchase(purchase('first', 10)), wallet.commitPurchase(purchase('second', 10))]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(results.find((r) => !r.ok).reason, 'insufficient-funds');
  assert.equal(repository.state.balance, 10);
});

test('unverified identity, stale quote, and wrong currency never charge', async () => {
  const { wallet, repository } = fixture();
  const before = structuredClone(repository.state);
  repository.verified = false;
  await assert.rejects(wallet.commitPurchase(purchase()), /Verified economic identity/);
  repository.verified = true;
  await assert.rejects(wallet.commitPurchase({ ...purchase(), validateQuote: async () => { throw new Error('quote expired'); } }), /quote expired/);
  const wrong = purchase();
  wrong.record = { ...wrong.record, payload: { ...wrong.record.payload, currency: 'Nexus Coins' } };
  await assert.rejects(wallet.commitPurchase(wrong), /invalid-currency/);
  assert.deepEqual(repository.state, before);
});

test('duplicate order cannot be redirected to another EOS identity', async () => {
  const { wallet, repository } = fixture();
  await wallet.commitPurchase(purchase());
  await assert.rejects(wallet.commitPurchase({ ...purchase(), eosId: 'different' }), /another purchase/);
  assert.equal(repository.state.balance, 60);
});
