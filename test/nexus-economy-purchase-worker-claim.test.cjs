'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createNexusEconomyPurchaseOutboxRecord } = require('../src/sentinel/nexus-economy-purchase-outbox-record.cjs');
const { createNexusEconomyPurchaseActionRequest } = require('../src/sentinel/nexus-economy-purchase-action-request.cjs');
const { createNexusEconomyPurchaseWorkerClaimer } = require('../src/sentinel/nexus-economy-purchase-worker-claim.cjs');

function buildStoredAction() {
  const planDigest = 'a'.repeat(64);
  const envelope = { ok: true, actionReady: true, queueWritePermitted: false, executionPermitted: false, schemaVersion: 2, actionId: `action_${planDigest.slice(0, 24)}`, type: 'nexus.economy.purchase', capability: 'economy.purchase.execute', subject: 'discord-user:123456789', correlationId: 'discord_abc12345', idempotencyKey: 'shop_discord_abc12345', requestId: 'discord_abc12345', orderId: 'shop_discord_abc12345', planId: 'purchase_abc12345', payload: { planId: 'purchase_abc12345', planDigest, discordUserId: '123456789', itemId: 'metal-ingot', quantity: 2, currency: 'Nexus Points', totalPrice: 300, projectedBalance: 700, fulfillment: 'rewards-ascended-item' } };
  const record = createNexusEconomyPurchaseOutboxRecord().prepare(envelope);
  const projected = createNexusEconomyPurchaseActionRequest().prepare(record);
  return { ...projected.actionRequest, status: 'requested', persisted: true };
}

function activeEnv(overrides = {}) {
  return { NEXUS_ECONOMY_RUNTIME_MODE: 'active', NEXUS_ECONOMY_RUNTIME_ENABLED: 'true', NEXUS_ECONOMY_AUTHORITY: 'nexus', NEXUS_ECONOMY_PURCHASES_ENABLED: 'true', NEXUS_ECONOMY_WORKER_CLAIM_ENABLED: 'true', ...overrides };
}

function claimResult(action, overrides = {}) {
  return { actionId: action.actionId, attempt: 1, status: 'running', persisted: true, claimed: true, action: { ...action, status: 'running' }, ...overrides };
}

test('worker claim stays default-off and does not touch ActionStore', async () => {
  const action = buildStoredAction(); let calls = 0;
  const result = await createNexusEconomyPurchaseWorkerClaimer({ env: activeEnv({ NEXUS_ECONOMY_WORKER_CLAIM_ENABLED: 'false' }), actionStore: { claimRequested: async () => { calls += 1; } } }).claim(action);
  assert.equal(result.ok, false); assert.equal(result.reason, 'purchase-worker-claim-disabled'); assert.equal(result.executionPermitted, false); assert.equal(calls, 0);
});

test('claims exactly one durable requested RewardsAscended purchase and still forbids execution', async () => {
  const action = buildStoredAction(); const calls = [];
  const result = await createNexusEconomyPurchaseWorkerClaimer({ env: activeEnv(), actionStore: { claimRequested: async (...args) => { calls.push(args); return claimResult(action); } } }).claim(action);
  assert.equal(result.ok, true); assert.equal(result.claimed, true); assert.equal(result.persisted, true); assert.equal(result.executionPermitted, false);
  assert.deepEqual(calls, [[action.actionId, 1]]); assert.equal(result.claim.orderId, action.idempotencyKey); assert.equal(result.claim.requestId, action.correlationId); assert.equal(result.claim.fulfillment, 'rewards-ascended-item');
  const serialized = JSON.stringify(result).toLowerCase();
  for (const forbidden of ['dino-cache', 'blueprint', 'ra.reward', 'rcon', 'sftp', 'wallet-debit']) assert.equal(serialized.includes(forbidden), false);
});

test('fails closed when atomic durable claim cannot be proven', async () => {
  const action = buildStoredAction();
  for (const [overrides, reason] of [[{ claimed: false }, 'action-not-claimed'], [{ persisted: false }, 'action-claim-not-durable'], [{ status: 'requested' }, 'action-claim-status-mismatch']]) {
    const result = await createNexusEconomyPurchaseWorkerClaimer({ env: activeEnv(), actionStore: { claimRequested: async () => claimResult(action, overrides) } }).claim(action);
    assert.equal(result.ok, false); assert.equal(result.reason, reason); assert.equal(result.executionPermitted, false);
  }
});

test('rejects invalid intake before attempting claim', async () => {
  const action = buildStoredAction(); let calls = 0;
  const result = await createNexusEconomyPurchaseWorkerClaimer({ env: activeEnv(), actionStore: { claimRequested: async () => { calls += 1; } } }).claim({ ...action, status: 'running' });
  assert.equal(result.ok, false); assert.equal(result.reason, 'action-not-requested'); assert.equal(calls, 0);
});
