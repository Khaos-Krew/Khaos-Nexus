'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCatalog } = require('../src/sentinel/cluster-shop-service.cjs');
const { NexusEconomyPostgresShopService } = require('../src/sentinel/nexus-economy-postgres-shop-service.cjs');
const { createNexusEconomyPurchaseActionRequest } = require('../src/sentinel/nexus-economy-purchase-action-request.cjs');

function fixture({ balance = 100 } = {}) {
  const calls = [];
  const wallet = {
    async balance() { return balance; },
    async commitPurchase(input) {
      calls.push(input);
      return { ok: true, duplicate: false, order: { orderId: input.record.orderId, status: 'PAID_QUEUED' }, balance: input.record.payload.projectedBalance };
    }
  };
  const repository = {
    async getOrder() { return null; },
    async listOrdersByStatus() { return []; },
    async updateOrderDelivery() { return { ok: true }; }
  };
  const catalog = loadCatalog(JSON.stringify([{
    id: 'metal', name: 'Metal', blueprint: '/Game/PrimalEarth/CoreBlueprints/Resources/PrimalItemResource_Metal.PrimalItemResource_Metal',
    baseQuantity: 100, buyPrice: 40, maxBundles: 100, buyable: true
  }]));
  return { service: new NexusEconomyPostgresShopService({ wallet, repository, catalog }), calls };
}

test('postgres shop builds a valid deterministic outbox record before atomic commit', async () => {
  const { service, calls } = fixture();
  const input = { discordUserId: '123456789', eosId: 'EOS_verified', itemId: 'metal', bundles: 2, idempotencyKey: 'interaction-abc' };
  const first = await service.createBuyOrder(input);
  const second = await service.createBuyOrder(input);
  assert.equal(first.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].record.orderId, calls[1].record.orderId);
  assert.equal(calls[0].record.actionId, `action_${calls[0].record.payload.planDigest.slice(0, 24)}`);
  assert.equal(calls[0].record.payload.quantity, 2);
  assert.equal(calls[0].record.payload.totalPrice, 80);
  assert.equal(calls[0].record.payload.projectedBalance, 20);
  assert.equal(calls[0].quote.totalQuantity, 200);
  assert.equal(createNexusEconomyPurchaseActionRequest().prepare(calls[0].record).ok, true);
});

test('postgres shop requires idempotency, caps action bundles, and never commits insufficient funds', async () => {
  const { service, calls } = fixture({ balance: 50 });
  await assert.rejects(service.createBuyOrder({ discordUserId: '123456789', eosId: 'EOS_verified', itemId: 'metal' }), /idempotency key/i);
  await assert.rejects(service.createBuyOrder({ discordUserId: '123456789', eosId: 'EOS_verified', itemId: 'metal', bundles: 26, idempotencyKey: 'too-many' }), /limited to 25/i);
  const result = await service.createBuyOrder({ discordUserId: '123456789', eosId: 'EOS_verified', itemId: 'metal', bundles: 2, idempotencyKey: 'no-funds' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'insufficient-funds');
  assert.equal(calls.length, 0);
});