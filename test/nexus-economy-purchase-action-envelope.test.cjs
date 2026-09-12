'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PURCHASE_EXECUTION_PLAN_VERSION,
  CLUSTER_SHOP_FULFILLMENT,
  canonicalPlanPayload,
  digestPayload
} = require('../src/sentinel/nexus-economy-purchase-execution-plan.cjs');
const {
  PURCHASE_ACTION_SCHEMA_VERSION,
  createNexusEconomyPurchaseActionEnvelope
} = require('../src/sentinel/nexus-economy-purchase-action-envelope.cjs');

function buildPlan(overrides = {}) {
  const source = {
    orderId: 'shop_discord_abc12345',
    requestId: 'discord_abc12345',
    discordUserId: '123456789',
    itemId: 'metal-ingot',
    quantity: 2,
    currency: 'Nexus Points',
    unitPrice: 150,
    currentTotalPrice: 300,
    projectedBalance: 700,
    ...overrides
  };
  const payload = canonicalPlanPayload(source);
  const planDigest = digestPayload(payload);

  return Object.freeze({
    ok: true,
    planReady: true,
    executionPermitted: false,
    reason: 'purchase-execution-plan-ready',
    mode: 'active',
    requestId: source.requestId,
    orderId: source.orderId,
    discordUserId: source.discordUserId,
    itemId: source.itemId,
    displayName: 'Metal Ingot',
    quantity: source.quantity,
    currency: source.currency,
    unitPrice: source.unitPrice,
    totalPrice: source.currentTotalPrice,
    balance: source.currentTotalPrice + source.projectedBalance,
    projectedBalance: source.projectedBalance,
    fulfillment: CLUSTER_SHOP_FULFILLMENT,
    planVersion: PURCHASE_EXECUTION_PLAN_VERSION,
    planId: `purchase_${planDigest.slice(0, 24)}`,
    planDigest,
    operations: Object.freeze([
      Object.freeze({
        type: 'wallet-debit',
        amount: source.currentTotalPrice,
        idempotencyKey: source.orderId
      }),
      Object.freeze({
        type: 'rewards-ascended-item-fulfillment',
        fulfillment: CLUSTER_SHOP_FULFILLMENT,
        itemId: source.itemId,
        quantity: source.quantity,
        idempotencyKey: source.orderId
      })
    ])
  });
}

test('creates a deterministic worker-safe RewardsAscended purchase action envelope', () => {
  const plan = buildPlan();
  const boundary = createNexusEconomyPurchaseActionEnvelope();
  const first = boundary.prepare(plan);
  const second = boundary.prepare(plan);

  assert.deepEqual(first, second);
  assert.equal(first.ok, true);
  assert.equal(first.actionReady, true);
  assert.equal(first.queueWritePermitted, false);
  assert.equal(first.executionPermitted, false);
  assert.equal(first.schemaVersion, PURCHASE_ACTION_SCHEMA_VERSION);
  assert.equal(first.type, 'nexus.economy.purchase');
  assert.equal(first.capability, 'economy.purchase.execute');
  assert.equal(first.idempotencyKey, plan.orderId);
  assert.equal(first.correlationId, plan.requestId);
  assert.equal(first.actionId, `action_${plan.planDigest.slice(0, 24)}`);
  assert.equal(first.payload.fulfillment, CLUSTER_SHOP_FULFILLMENT);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.payload), true);
});

test('rejects tampered plans instead of creating an action', () => {
  const plan = buildPlan();
  const boundary = createNexusEconomyPurchaseActionEnvelope();
  const result = boundary.prepare({ ...plan, quantity: 3, totalPrice: 450, projectedBalance: 550 });

  assert.equal(result.ok, false);
  assert.equal(result.actionReady, false);
  assert.equal(result.queueWritePermitted, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.actionId, null);
});

test('rejects Dino Cache fulfillment semantics', () => {
  const plan = buildPlan();
  const boundary = createNexusEconomyPurchaseActionEnvelope();
  const result = boundary.prepare({
    ...plan,
    fulfillment: 'dino-cache',
    operations: [
      plan.operations[0],
      {
        type: 'dino-cache-fulfillment',
        fulfillment: 'dino-cache',
        itemId: plan.itemId,
        quantity: plan.quantity,
        idempotencyKey: plan.orderId
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.actionReady, false);
  assert.equal(result.executionPermitted, false);
});

test('envelope does not expose direct wallet operations or transport internals', () => {
  const result = createNexusEconomyPurchaseActionEnvelope().prepare(buildPlan());
  const serialized = JSON.stringify(result).toLowerCase();

  assert.equal(serialized.includes('wallet-debit'), false);
  assert.equal(serialized.includes('dino-cache-fulfillment'), false);
  assert.equal(serialized.includes('operations'), false);
  assert.equal(serialized.includes('blueprint'), false);
  assert.equal(serialized.includes('rcon'), false);
  assert.equal(serialized.includes('sftp'), false);
  assert.equal(serialized.includes('ra.reward'), false);
});
