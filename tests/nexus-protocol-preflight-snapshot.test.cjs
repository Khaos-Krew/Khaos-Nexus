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
  createPreflightSnapshot,
  assertPreflightSnapshot
} = require('../src/sentinel/nexus-protocol-preflight-snapshot.cjs');

function envelope() {
  const plan = protocolExecutionPlan({
    protocolId: 'dark-zone-weekly',
    createdAt: 1000,
    dryRun: false,
    reloadCountdown: true,
    ratePreset: 'darkzone',
    reward: { eosId: 'EOS_player_1234', rewardId: 'dz_weekly_1' }
  });
  return buildExecutionEnvelope(plan, {
    serverId: 'asa-rag',
    idempotencyKey: 'protocol:season:9'
  });
}

function failedReceipt(env, index, completedAt = 1100) {
  const action = env.actions[index];
  return normalizeExecutorReceipt({
    serverId: env.serverId,
    protocolId: env.protocolId,
    actionId: action.actionId,
    idempotencyKey: action.idempotencyKey,
    status: 'failed',
    completedAt
  });
}

test('binds a ready executor preflight to the exact envelope and receipt frontier without dispatch authority', () => {
  const env = envelope();
  const receipts = [failedReceipt(env, 1)];
  const snapshot = createPreflightSnapshot(env, receipts, { now: 1200, issuedAt: 1200, ttlMs: 5000 });

  assert.equal(snapshot.ready, true);
  assert.equal(snapshot.executesCommands, false);
  assert.equal(snapshot.dispatchAuthorized, false);
  assert.deepEqual(snapshot.actionIds, env.actions.map((action) => action.actionId));
  assert.equal(assertPreflightSnapshot(snapshot, env, receipts, { now: 1300 }), true);
});

test('rejects a snapshot when a receipt arrives after preflight', () => {
  const env = envelope();
  const snapshot = createPreflightSnapshot(env, [], { now: 1200, issuedAt: 1200, ttlMs: 5000 });
  const changedReceipts = [failedReceipt(env, 1, 1250)];

  assert.throws(
    () => assertPreflightSnapshot(snapshot, env, changedReceipts, { now: 1300 }),
    /integrity mismatch|no longer matches/i
  );
});

test('rejects envelope tampering after preflight', () => {
  const env = envelope();
  const snapshot = createPreflightSnapshot(env, [], { now: 1200, issuedAt: 1200, ttlMs: 5000 });
  const changed = structuredClone(env);
  changed.actions[0].command = 'RA.Reload';

  assert.throws(
    () => assertPreflightSnapshot(snapshot, changed, [], { now: 1300 }),
    /invalid action|identity mismatch|integrity mismatch/i
  );
});

test('expires quickly and cannot be reused as durable execution authority', () => {
  const env = envelope();
  const snapshot = createPreflightSnapshot(env, [], { now: 1200, issuedAt: 1200, ttlMs: 1000 });
  assert.throws(() => assertPreflightSnapshot(snapshot, env, [], { now: 2201 }), /expired/i);
});

test('cannot create a snapshot when preflight is blocked by successful or uncertain receipts', () => {
  const env = envelope();
  const action = env.actions[1];
  for (const status of ['succeeded', 'uncertain']) {
    const receipt = normalizeExecutorReceipt({
      serverId: env.serverId,
      protocolId: env.protocolId,
      actionId: action.actionId,
      idempotencyKey: action.idempotencyKey,
      status,
      completedAt: 1100
    });
    assert.throws(
      () => createPreflightSnapshot(env, [receipt], { now: 1200, issuedAt: 1200 }),
      /preflight is blocked/i
    );
  }
});
