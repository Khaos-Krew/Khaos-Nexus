'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createNexusEconomyPurchaseOutboxRecord } = require('../src/sentinel/nexus-economy-purchase-outbox-record.cjs');
const { createNexusEconomyPurchaseActionSubmitter } = require('../src/sentinel/nexus-economy-purchase-action-submit.cjs');

function buildRecord() {
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
  return record;
}

function activeEnv(overrides = {}) {
  return { NEXUS_ECONOMY_RUNTIME_MODE: 'active', NEXUS_ECONOMY_RUNTIME_ENABLED: 'true', NEXUS_ECONOMY_AUTHORITY: 'nexus', NEXUS_ECONOMY_PURCHASES_ENABLED: 'true', NEXUS_ECONOMY_ACTION_SUBMISSION_ENABLED: 'true', ...overrides };
}

function durableResult(request, overrides = {}) {
  return { ...request, status: 'requested', persisted: true, ...overrides };
}

test('submission stays default-off and does not call ActionStore', async () => {
  let calls = 0;
  const result = await createNexusEconomyPurchaseActionSubmitter({
    env: activeEnv({ NEXUS_ECONOMY_ACTION_SUBMISSION_ENABLED: 'false' }),
    actionStore: { request: async () => { calls += 1; } }
  }).submit(buildRecord());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'purchase-action-submission-disabled');
  assert.equal(result.executionPermitted, false);
  assert.equal(calls, 0);
});

test('persists one verified RewardsAscended action with stable order idempotency and still forbids execution', async () => {
  const record = buildRecord();
  const calls = [];
  const result = await createNexusEconomyPurchaseActionSubmitter({
    env: activeEnv(),
    actionStore: { request: async (request) => { calls.push(request); return durableResult(request); } }
  }).submit(record);
  assert.equal(result.ok, true);
  assert.equal(result.persisted, true);
  assert.equal(result.executionPermitted, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].idempotencyKey, record.orderId);
  assert.equal(calls[0].correlationId, record.requestId);
  assert.equal(calls[0].request.payload.fulfillment, 'rewards-ascended-item');
  assert.equal(result.action.fulfillment, 'rewards-ascended-item');
  const serialized = JSON.stringify(result).toLowerCase();
  assert.equal(serialized.includes('dino-cache'), false);
  assert.equal(serialized.includes('blueprint'), false);
  assert.equal(serialized.includes('ra.reward'), false);
  assert.equal(serialized.includes('rcon'), false);
});

test('fails closed before ActionStore on tampered records', async () => {
  const record = buildRecord();
  let calls = 0;
  const result = await createNexusEconomyPurchaseActionSubmitter({ env: activeEnv(), actionStore: { request: async () => { calls += 1; } } })
    .submit({ ...record, payload: { ...record.payload, quantity: 3 } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'record-digest-mismatch');
  assert.equal(calls, 0);
});

test('non-durable ActionStore responses are rejected rather than treated as submitted purchases', async () => {
  const record = buildRecord();
  const result = await createNexusEconomyPurchaseActionSubmitter({
    env: activeEnv(),
    actionStore: { request: async (request) => durableResult(request, { persisted: false }) }
  }).submit(record);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'action-store-not-durable');
  assert.equal(result.persisted, false);
  assert.equal(result.executionPermitted, false);
});

test('rejects durable action identity, status, or fulfillment mismatches', async () => {
  const record = buildRecord();
  const cases = [
    [{ actionId: 'action_wrong' }, 'action-store-id-mismatch'],
    [{ status: 'running' }, 'action-store-status-mismatch'],
    [{ request: { payload: { fulfillment: 'dino-cache' } } }, 'action-store-fulfillment-mismatch']
  ];
  for (const [overrides, reason] of cases) {
    const result = await createNexusEconomyPurchaseActionSubmitter({
      env: activeEnv(), actionStore: { request: async (request) => durableResult(request, overrides) }
    }).submit(record);
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal(result.executionPermitted, false);
  }
});

test('ActionStore failures are sanitized and execution remains disabled', async () => {
  const error = new Error('secret database details'); error.code = 'ECONNRESET';
  const result = await createNexusEconomyPurchaseActionSubmitter({ env: activeEnv(), actionStore: { request: async () => { throw error; } } }).submit(buildRecord());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'action-store-request-failed');
  assert.equal(result.errorCode, 'ECONNRESET');
  assert.equal(JSON.stringify(result).includes('secret database details'), false);
  assert.equal(result.executionPermitted, false);
});
