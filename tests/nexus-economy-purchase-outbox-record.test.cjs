'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PURCHASE_OUTBOX_SCHEMA_VERSION,
  createNexusEconomyPurchaseOutboxRecord
} = require('../src/sentinel/nexus-economy-purchase-outbox-record.cjs');

function buildEnvelope(overrides = {}) {
  const planDigest = 'a'.repeat(64);
  const envelope = {
    ok: true,
    actionReady: true,
    queueWritePermitted: false,
    executionPermitted: false,
    reason: 'purchase-action-envelope-ready',
    schemaVersion: 2,
    actionId: `action_${planDigest.slice(0, 24)}`,
    type: 'nexus.economy.purchase',
    capability: 'economy.purchase.execute',
    subject: 'discord-user:123456789',
    correlationId: 'discord_abc12345',
    idempotencyKey: 'shop_discord_abc12345',
    requestId: 'discord_abc12345',
    orderId: 'shop_discord_abc12345',
    planId: 'purchase_abc12345',
    payload: {
      planId: 'purchase_abc12345',
      planDigest,
      discordUserId: '123456789',
      itemId: 'metal-ingot',
      quantity: 2,
      currency: 'Nexus Points',
      totalPrice: 300,
      projectedBalance: 700,
      fulfillment: 'rewards-ascended-item'
    }
  };
  return { ...envelope, ...overrides };
}

test('creates deterministic immutable RewardsAscended purchase outbox records', () => {
  const boundary = createNexusEconomyPurchaseOutboxRecord();
  const envelope = buildEnvelope();
  const first = boundary.prepare(envelope);
  const second = boundary.prepare(envelope);

  assert.deepEqual(first, second);
  assert.equal(first.ok, true);
  assert.equal(first.recordReady, true);
  assert.equal(first.persistPermitted, false);
  assert.equal(first.queueWritePermitted, false);
  assert.equal(first.executionPermitted, false);
  assert.equal(first.schemaVersion, PURCHASE_OUTBOX_SCHEMA_VERSION);
  assert.match(first.recordId, /^outbox_[a-f0-9]{24}$/);
  assert.match(first.recordDigest, /^[a-f0-9]{64}$/);
  assert.equal(first.idempotencyKey, envelope.orderId);
  assert.equal(first.correlationId, envelope.requestId);
  assert.equal(first.payload.fulfillment, 'rewards-ascended-item');
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.payload), true);
});

test('rejects Dino Cache fulfillment semantics', () => {
  const envelope = buildEnvelope();
  const result = createNexusEconomyPurchaseOutboxRecord().prepare({
    ...envelope,
    payload: { ...envelope.payload, fulfillment: 'dino-cache' }
  });

  assert.equal(result.ok, false);
  assert.equal(result.recordReady, false);
  assert.equal(result.persistPermitted, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.reason, 'invalid-cluster-shop-fulfillment');
});

test('rejects idempotency and correlation tampering', () => {
  const boundary = createNexusEconomyPurchaseOutboxRecord();

  assert.equal(boundary.prepare({ ...buildEnvelope(), idempotencyKey: 'shop_other' }).reason, 'idempotency-key-mismatch');
  assert.equal(boundary.prepare({ ...buildEnvelope(), correlationId: 'discord_other' }).reason, 'correlation-id-mismatch');
});

test('rejects unsafe action permission flags and action schema drift', () => {
  const boundary = createNexusEconomyPurchaseOutboxRecord();

  assert.equal(boundary.prepare({ ...buildEnvelope(), queueWritePermitted: true }).reason, 'unsafe-action-envelope-flags');
  assert.equal(boundary.prepare({ ...buildEnvelope(), executionPermitted: true }).reason, 'unsafe-action-envelope-flags');
  assert.equal(boundary.prepare({ ...buildEnvelope(), schemaVersion: 1 }).reason, 'unsupported-action-envelope-schema');
});

test('outbox record exposes no direct wallet operation or ARK transport internals', () => {
  const result = createNexusEconomyPurchaseOutboxRecord().prepare(buildEnvelope());
  const serialized = JSON.stringify(result).toLowerCase();

  assert.equal(serialized.includes('wallet-debit'), false);
  assert.equal(serialized.includes('dino-cache'), false);
  assert.equal(serialized.includes('operations'), false);
  assert.equal(serialized.includes('blueprint'), false);
  assert.equal(serialized.includes('ra.reward'), false);
  assert.equal(serialized.includes('rcon'), false);
  assert.equal(serialized.includes('sftp'), false);
});
