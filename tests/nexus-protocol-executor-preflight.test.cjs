'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  protocolExecutionPlan,
  buildExecutionEnvelope
} = require('../src/sentinel/nexus-protocol-executors.cjs');
const {
  normalizeExecutorReceipt
} = require('../src/sentinel/nexus-protocol-executor-receipts.cjs');
const {
  preflightExecutionEnvelope,
  assertPreflightReady
} = require('../src/sentinel/nexus-protocol-executor-preflight.cjs');

const NOW = 1788770000000;

function envelope() {
  const plan = protocolExecutionPlan({
    protocolId: 'alpha-purge-week-1',
    createdAt: NOW,
    dryRun: false,
    reloadCountdown: true,
    ratePreset: 'alpha_weekend',
    reward: { eosId: 'EOS_12345678', rewardId: 'alpha_cache' }
  });
  return buildExecutionEnvelope(plan, {
    serverId: 'genesis-1',
    idempotencyKey: 'protocol:alpha:week1'
  });
}

function receiptFor(env, index, status) {
  const action = env.actions[index];
  return normalizeExecutorReceipt({
    serverId: env.serverId,
    protocolId: env.protocolId,
    actionId: action.actionId,
    idempotencyKey: action.idempotencyKey,
    status,
    completedAt: NOW + 1000
  });
}

test('marks a fresh validated EventCountdown/rates/reward envelope ready without executing it', () => {
  const env = envelope();
  const result = preflightExecutionEnvelope(env, [], { now: NOW + 2000 });

  assert.equal(result.ready, true);
  assert.equal(result.executesCommands, false);
  assert.equal(result.actionCount, 3);
  assert.deepEqual(result.blockers, []);
  assert.equal(assertPreflightReady(result), true);
});

test('blocks replay of an action that already succeeded', () => {
  const env = envelope();
  const result = preflightExecutionEnvelope(env, [receiptFor(env, 1, 'succeeded')], { now: NOW + 2000 });

  assert.equal(result.ready, false);
  assert.equal(result.actions[1].reason, 'already_succeeded');
  assert.equal(result.actions[1].priorStatus, 'succeeded');
  assert.throws(() => assertPreflightReady(result), /blocked/i);
});

test('quarantines an uncertain executor result instead of allowing a blind retry', () => {
  const env = envelope();
  const result = preflightExecutionEnvelope(env, [receiptFor(env, 2, 'uncertain')], { now: NOW + 2000 });

  assert.equal(result.ready, false);
  assert.equal(result.actions[2].reason, 'uncertain_requires_reconciliation');
  assert.equal(result.actions[2].priorStatus, 'uncertain');
});

test('permits controlled retry after an explicitly failed receipt', () => {
  const env = envelope();
  const result = preflightExecutionEnvelope(env, [receiptFor(env, 2, 'failed')], { now: NOW + 2000 });

  assert.equal(result.ready, true);
  assert.equal(result.actions[2].reason, 'retry_failed_action');
  assert.equal(result.actions[2].priorStatus, 'failed');
});

test('applies a stricter per-call plugin policy without changing the envelope', () => {
  const env = envelope();
  const result = preflightExecutionEnvelope(env, [], {
    now: NOW + 2000,
    allowedPlugins: ['EventCountdown', 'RewardsAscended']
  });

  assert.equal(result.ready, false);
  assert.equal(result.actions[1].plugin, 'CousinCustomRates');
  assert.equal(result.actions[1].reason, 'plugin_not_allowed');
  assert.deepEqual(result.blockers, ['1:plugin_not_allowed']);
});

test('fails before preflight classification when the envelope is stale', () => {
  const env = envelope();
  assert.throws(
    () => preflightExecutionEnvelope(env, [], { now: NOW + 400000, maxAgeMs: 300000 }),
    /stale|timestamp/i
  );
});
