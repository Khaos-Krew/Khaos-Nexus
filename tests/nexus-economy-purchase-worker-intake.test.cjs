'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createNexusEconomyPurchaseOutboxRecord } = require('../src/sentinel/nexus-economy-purchase-outbox-record.cjs');
const { createNexusEconomyPurchaseActionRequest } = require('../src/sentinel/nexus-economy-purchase-action-request.cjs');
const { createNexusEconomyPurchaseWorkerIntake } = require('../src/sentinel/nexus-economy-purchase-worker-intake.cjs');

function buildStoredAction(overrides = {}) {
  const planDigest = 'a'.repeat(64);
  const envelope = {
    ok: true, actionReady: true, queueWritePermitted: false, executionPermitted: false,
    schemaVersion: 2,
    actionId: `action_${planDigest.slice(0, 24)}`,
    type: 'nexus.economy.purchase', capability: 'economy.purchase.execute',
    subject: 'discord-user:123456789', correlationId: 'discord_abc12345',
    idempotencyKey: 'shop_discord_abc12345', requestId: 'discord_abc12345',
    orderId: 'shop_discord_abc12345', planId: 'purchase_abc12345',
    payload: { planId: 'purchase_abc12345', planDigest, discordUserId: '123456789', itemId: 'metal-ingot', quantity: 2, currency: 'Nexus Points', totalPrice: 300, projectedBalance: 700, fulfillment: 'rewards-ascended-item' }
  };
  const record = createNexusEconomyPurchaseOutboxRecord().prepare(envelope);
  assert.equal(record.ok, true);
  const projected = createNexusEconomyPurchaseActionRequest().prepare(record);
  assert.equal(projected.ok, true);
  return { ...projected.actionRequest, status: 'requested', persisted: true, ...overrides };
}

test('prepares sanitized worker intake while keeping claim and execution disabled', () => {
  const result = createNexusEconomyPurchaseWorkerIntake().prepare(buildStoredAction());
  assert.equal(result.ok, true);
  assert.equal(result.intakeReady, true);
  assert.equal(result.claimPermitted, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.claimPlan.expectedStatus, 'requested');
  assert.equal(result.claimPlan.idempotencyKey, 'shop_discord_abc12345');
  assert.equal(result.claimPlan.orderId, 'shop_discord_abc12345');
  assert.equal(result.claimPlan.correlationId, 'discord_abc12345');
  assert.equal(result.claimPlan.requestId, 'discord_abc12345');
  assert.equal(result.claimPlan.fulfillment, 'rewards-ascended-item');

  const serialized = JSON.stringify(result).toLowerCase();
  assert.equal(serialized.includes('blueprint'), false);
  assert.equal(serialized.includes('ra.reward'), false);
  assert.equal(serialized.includes('rcon'), false);
  assert.equal(serialized.includes('sftp'), false);
  assert.equal(serialized.includes('wallet-debit'), false);
  assert.equal(serialized.includes('dino-cache'), false);
});

test('rejects actions that are not durable requested work', () => {
  const intake = createNexusEconomyPurchaseWorkerIntake();
  for (const [overrides, reason] of [
    [{ persisted: false }, 'action-not-durable'],
    [{ status: 'claimed' }, 'action-not-requested'],
    [{ status: 'completed' }, 'action-not-requested']
  ]) {
    const result = intake.prepare(buildStoredAction(overrides));
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal(result.claimPermitted, false);
    assert.equal(result.executionPermitted, false);
  }
});

test('rejects idempotency and correlation tampering', () => {
  const intake = createNexusEconomyPurchaseWorkerIntake();
  const action = buildStoredAction();
  let result = intake.prepare({ ...action, idempotencyKey: 'shop_wrong' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'action-order-idempotency-mismatch');

  result = intake.prepare({ ...action, correlationId: 'discord_wrong' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'action-request-correlation-mismatch');
});

test('rejects Dino Cache fulfillment at worker intake', () => {
  const action = buildStoredAction();
  const result = createNexusEconomyPurchaseWorkerIntake().prepare({
    ...action,
    request: { ...action.request, payload: { ...action.request.payload, fulfillment: 'dino-cache' } }
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-cluster-shop-fulfillment');
  assert.equal(result.claimPermitted, false);
  assert.equal(result.executionPermitted, false);
});

test('worker intake is pure validation and never needs an ActionStore mutator', () => {
  const throwingStore = new Proxy({}, { get() { throw new Error('worker intake must not touch ActionStore'); } });
  const intake = createNexusEconomyPurchaseWorkerIntake({ actionStore: throwingStore });
  const result = intake.prepare(buildStoredAction());
  assert.equal(result.ok, true);
  assert.equal(result.claimPermitted, false);
  assert.equal(result.executionPermitted, false);
});
