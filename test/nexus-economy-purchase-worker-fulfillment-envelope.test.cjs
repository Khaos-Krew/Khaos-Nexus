'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNexusClusterShopCatalog } = require('../src/sentinel/nexus-cluster-shop-catalog.cjs');
const { createNexusEconomyPurchaseWorkerFulfillmentEnvelope } = require('../src/sentinel/nexus-economy-purchase-worker-fulfillment-envelope.cjs');

function intent(overrides = {}) {
  return {
    operation: 'rewards-ascended-item-fulfillment',
    fulfillment: 'rewards-ascended-item',
    actionId: 'action_aaaaaaaaaaaaaaaaaaaaaaaa',
    orderId: 'shop_discord_abc12345',
    idempotencyKey: 'shop_discord_abc12345',
    correlationId: 'discord_abc12345',
    requestId: 'discord_abc12345',
    discordUserId: '123456789',
    eosProductUserId: '0123456789abcdef0123456789abcdef',
    serverId: 'gen1',
    itemId: 'metal-ingot',
    quantity: 2,
    debitTransactionId: 42,
    debitBalance: 700,
    presenceObservedAt: '2026-09-12T23:00:00.000Z',
    fulfillmentPermitted: false,
    executionPermitted: false,
    ...overrides
  };
}

function catalog(overrides = {}) {
  const item = {
    id: 'metal-ingot',
    name: 'Metal Ingot Bundle',
    category: 'Resources',
    kind: 'item',
    blueprint: '/Game/PrimalEarth/CoreBlueprints/Resources/PrimalItemResource_MetalIngot.PrimalItemResource_MetalIngot',
    baseQuantity: 100,
    buyPrice: 150,
    minBundles: 1,
    maxBundles: 10,
    buyable: true,
    ...overrides
  };
  return buildNexusClusterShopCatalog([item]);
}

test('binds a validated fulfillment intent to the approved catalog item without emitting an executable command', () => {
  const result = createNexusEconomyPurchaseWorkerFulfillmentEnvelope().prepare(intent(), catalog());

  assert.equal(result.ok, true);
  assert.equal(result.fulfillmentEnvelopeReady, true);
  assert.equal(result.fulfillmentPermitted, false);
  assert.equal(result.executionPermitted, false);
  assert.deepEqual(result.envelope, {
    schemaVersion: 1,
    operation: 'rewards-ascended-item-delivery',
    fulfillment: 'rewards-ascended-item',
    actionId: 'action_aaaaaaaaaaaaaaaaaaaaaaaa',
    orderId: 'shop_discord_abc12345',
    idempotencyKey: 'shop_discord_abc12345',
    correlationId: 'discord_abc12345',
    requestId: 'discord_abc12345',
    discordUserId: '123456789',
    eosProductUserId: '0123456789abcdef0123456789abcdef',
    serverId: 'gen1',
    itemId: 'metal-ingot',
    itemKind: 'item',
    blueprint: '/Game/PrimalEarth/CoreBlueprints/Resources/PrimalItemResource_MetalIngot.PrimalItemResource_MetalIngot',
    bundleQuantity: 2,
    baseQuantity: 100,
    totalItemQuantity: 200,
    debitTransactionId: 42,
    debitBalance: 700,
    presenceObservedAt: '2026-09-12T23:00:00.000Z',
    transport: 'rewards-ascended',
    command: null,
    fulfillmentPermitted: false,
    executionPermitted: false
  });
  const serialized = JSON.stringify(result).toLowerCase();
  for (const forbidden of ['dino-cache', 'ra.reward', 'rcon', 'sftp']) assert.equal(serialized.includes(forbidden), false);
});

test('fails closed on tampered fulfillment identity and unsafe execution flags', () => {
  const builder = createNexusEconomyPurchaseWorkerFulfillmentEnvelope();
  const cases = [
    [intent({ operation: 'dino-cache-fulfillment' }), 'fulfillment-operation-mismatch'],
    [intent({ fulfillment: 'dino-cache-fulfillment' }), 'fulfillment-type-mismatch'],
    [intent({ fulfillmentPermitted: true }), 'unsafe-fulfillment-intent-flags'],
    [intent({ executionPermitted: true }), 'unsafe-fulfillment-intent-flags'],
    [intent({ idempotencyKey: 'different-order' }), 'fulfillment-idempotency-mismatch'],
    [intent({ correlationId: 'different-request' }), 'fulfillment-correlation-mismatch']
  ];

  for (const [candidate, reason] of cases) {
    const result = builder.prepare(candidate, catalog());
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal(result.fulfillmentPermitted, false);
    assert.equal(result.executionPermitted, false);
  }
});

test('fails closed when catalog resolution is missing, non-buyable, out of bounds, or unsafe', () => {
  const builder = createNexusEconomyPurchaseWorkerFulfillmentEnvelope();

  const missing = builder.prepare(intent({ itemId: 'polymer' }), catalog());
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'cluster-shop-item-not-found');

  const nonBuyable = builder.prepare(intent(), catalog({ buyable: false }));
  assert.equal(nonBuyable.ok, false);
  assert.equal(nonBuyable.reason, 'cluster-shop-item-not-buyable');

  const quantity = builder.prepare(intent({ quantity: 11 }), catalog());
  assert.equal(quantity.ok, false);
  assert.equal(quantity.reason, 'fulfillment-quantity-out-of-catalog-bounds');

  assert.throws(() => catalog({ kind: 'dino' }), /Dino Cache\/creature kind/);
  assert.throws(() => catalog({ blueprint: 'not-a-blueprint' }), /invalid RewardsAscended blueprint path/);
});
