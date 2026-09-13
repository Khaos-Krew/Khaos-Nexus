'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createNexusEconomyPurchaseOutboxRecord } = require('../src/sentinel/nexus-economy-purchase-outbox-record.cjs');
const {
  ACTION_SOURCE,
  createNexusEconomyPurchaseActionRequest
} = require('../src/sentinel/nexus-economy-purchase-action-request.cjs');

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

function buildRecord() {
  const record = createNexusEconomyPurchaseOutboxRecord().prepare(buildEnvelope());
  assert.equal(record.ok, true);
  return record;
}

test('projects a validated RewardsAscended outbox record into an inert ActionStore request', () => {
  const record = buildRecord();
  const result = createNexusEconomyPurchaseActionRequest().prepare(record);

  assert.equal(result.ok, true);
  assert.equal(result.requestReady, true);
  assert.equal(result.submitPermitted, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.actionId, record.actionId);
  assert.equal(result.recordId, record.recordId);
  assert.equal(result.actionRequest.actionId, record.actionId);
  assert.equal(result.actionRequest.capability, 'economy.purchase.execute');
  assert.equal(result.actionRequest.source, ACTION_SOURCE);
  assert.equal(result.actionRequest.actor, 'discord-user:123456789');
  assert.equal(result.actionRequest.subject, 'discord-user:123456789');
  assert.equal(result.actionRequest.destructive, false);
  assert.equal(result.actionRequest.idempotencyKey, record.orderId);
  assert.equal(result.actionRequest.correlationId, record.requestId);
  assert.equal(result.actionRequest.request.recordId, record.recordId);
  assert.equal(result.actionRequest.request.recordDigest, record.recordDigest);
  assert.deepEqual(result.actionRequest.request.payload, record.payload);
  assert.equal(result.actionRequest.request.payload.fulfillment, 'rewards-ascended-item');
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.actionRequest), true);
  assert.equal(Object.isFrozen(result.actionRequest.request), true);
  assert.equal(Object.isFrozen(result.actionRequest.request.payload), true);
});

test('projection is deterministic and retains the stable order id as ActionStore idempotency key', () => {
  const record = buildRecord();
  const boundary = createNexusEconomyPurchaseActionRequest();
  const first = boundary.prepare(record);
  const second = boundary.prepare(record);

  assert.deepEqual(first, second);
  assert.equal(first.actionRequest.idempotencyKey, record.idempotencyKey);
  assert.equal(first.actionRequest.idempotencyKey, record.orderId);
});

test('rejects record digest, record id, and purchase payload tampering', () => {
  const record = buildRecord();
  const boundary = createNexusEconomyPurchaseActionRequest();

  const badDigest = boundary.prepare({ ...record, recordDigest: '0'.repeat(64) });
  const badId = boundary.prepare({ ...record, recordId: 'outbox_deadbeefdeadbeefdeadbeef' });
  const badPayload = boundary.prepare({ ...record, payload: { ...record.payload, quantity: 3 } });

  assert.equal(badDigest.ok, false);
  assert.equal(badDigest.reason, 'record-digest-mismatch');
  assert.equal(badId.ok, false);
  assert.equal(badId.reason, 'record-id-mismatch');
  assert.equal(badPayload.ok, false);
  assert.equal(badPayload.reason, 'record-digest-mismatch');
  assert.equal(badDigest.submitPermitted, false);
  assert.equal(badId.executionPermitted, false);
});

test('rejects any outbox record that enables persistence, queue writing, or execution', () => {
  const record = buildRecord();
  const boundary = createNexusEconomyPurchaseActionRequest();

  for (const flag of ['persistPermitted', 'queueWritePermitted', 'executionPermitted']) {
    const result = boundary.prepare({ ...record, [flag]: true });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unsafe-outbox-record-flags');
    assert.equal(result.submitPermitted, false);
    assert.equal(result.executionPermitted, false);
  }
});

test('rejects Dino Cache fulfillment semantics even when the record digest is recomputed upstream', () => {
  const badEnvelope = buildEnvelope({
    payload: { ...buildEnvelope().payload, fulfillment: 'dino-cache' }
  });
  const rejectedRecord = createNexusEconomyPurchaseOutboxRecord().prepare(badEnvelope);
  assert.equal(rejectedRecord.ok, false);
  assert.equal(rejectedRecord.reason, 'invalid-cluster-shop-fulfillment');

  const result = createNexusEconomyPurchaseActionRequest().prepare(rejectedRecord);
  assert.equal(result.ok, false);
  assert.equal(result.requestReady, false);
  assert.equal(result.submitPermitted, false);
  assert.equal(result.executionPermitted, false);
});

test('projection contains no direct wallet operation, Dino Cache, blueprint, or ARK transport internals', () => {
  const result = createNexusEconomyPurchaseActionRequest().prepare(buildRecord());
  const serialized = JSON.stringify(result).toLowerCase();

  assert.equal(result.ok, true);
  assert.equal(serialized.includes('wallet-debit'), false);
  assert.equal(serialized.includes('dino-cache'), false);
  assert.equal(serialized.includes('operations'), false);
  assert.equal(serialized.includes('blueprint'), false);
  assert.equal(serialized.includes('ra.reward'), false);
  assert.equal(serialized.includes('rcon'), false);
  assert.equal(serialized.includes('sftp'), false);
});
