'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { protocolExecutionPlan, buildExecutionEnvelope } = require('../src/sentinel/nexus-protocol-executors.cjs');
const { createPreflightSnapshot } = require('../src/sentinel/nexus-protocol-preflight-snapshot.cjs');
const { createExecutorHandoff } = require('../src/sentinel/nexus-protocol-executor-handoff.cjs');
const { createAdapterPermit, assertAdapterPermit } = require('../src/sentinel/nexus-protocol-adapter-permit.cjs');

function fixture(now = 100000) {
  const plan = protocolExecutionPlan({
    protocolId: 'dark-zone-001',
    createdAt: now,
    dryRun: false,
    reloadCountdown: true,
    ratePreset: 'darkzone',
    reward: { eosId: 'EOS_12345678', rewardId: 'dz-win' }
  });
  const envelope = buildExecutionEnvelope(plan, {
    serverId: 'asa-gen1',
    idempotencyKey: 'protocol:dark-zone-001'
  });
  const receipts = [];
  const snapshot = createPreflightSnapshot(envelope, receipts, {
    now,
    issuedAt: now,
    ttlMs: 15000,
    serverId: 'asa-gen1'
  });
  const handoff = createExecutorHandoff(snapshot, envelope, receipts, {
    now,
    issuedAt: now,
    serverId: 'asa-gen1'
  });
  return { now, envelope, receipts, snapshot, handoff };
}

test('creates a non-executing permit for the exact plugin-bound action', () => {
  const { now, envelope, receipts, snapshot, handoff } = fixture();
  const permit = createAdapterPermit(handoff, snapshot, envelope, receipts, 0, {
    now,
    serverId: 'asa-gen1',
    adapter: 'EventCountdown'
  });
  assert.equal(permit.allowed, true);
  assert.equal(permit.attemptReason, 'new_action');
  assert.equal(permit.executesCommand, false);
  assert.equal(permit.requiresCommandRevalidation, true);
  assert.equal(permit.requiresReceiptPersistence, true);
  assert.equal(Object.hasOwn(permit, 'command'), false);
  assert.equal(assertAdapterPermit(permit, handoff, snapshot, envelope, receipts, {
    now,
    serverId: 'asa-gen1'
  }), true);
});

test('rejects cross-plugin adapter substitution', () => {
  const { now, envelope, receipts, snapshot, handoff } = fixture();
  assert.throws(() => createAdapterPermit(handoff, snapshot, envelope, receipts, 0, {
    now,
    serverId: 'asa-gen1',
    adapter: 'RewardsAscended'
  }), /does not match action plugin/);
});

test('blocks already-succeeded actions before an adapter can consume them', () => {
  const { now, envelope } = fixture();
  const action = envelope.actions[1];
  const receipts = [{
    serverId: envelope.serverId,
    protocolId: envelope.protocolId,
    actionId: action.actionId,
    idempotencyKey: action.idempotencyKey,
    status: 'succeeded',
    completedAt: now
  }];
  const snapshot = createPreflightSnapshot(envelope, receipts, {
    now,
    issuedAt: now,
    ttlMs: 15000,
    serverId: 'asa-gen1'
  });
  const handoff = createExecutorHandoff(snapshot, envelope, receipts, {
    now,
    issuedAt: now,
    serverId: 'asa-gen1'
  });
  const permit = createAdapterPermit(handoff, snapshot, envelope, receipts, 1, {
    now,
    serverId: 'asa-gen1',
    adapter: 'CousinCustomRates'
  });
  assert.equal(permit.allowed, false);
  assert.equal(permit.attemptReason, 'already_succeeded');
});

test('quarantines uncertain outcomes instead of granting retry authority', () => {
  const { now, envelope } = fixture();
  const action = envelope.actions[2];
  const receipts = [{
    serverId: envelope.serverId,
    protocolId: envelope.protocolId,
    actionId: action.actionId,
    idempotencyKey: action.idempotencyKey,
    status: 'uncertain',
    completedAt: now
  }];
  const snapshot = createPreflightSnapshot(envelope, receipts, {
    now,
    issuedAt: now,
    ttlMs: 15000,
    serverId: 'asa-gen1'
  });
  const handoff = createExecutorHandoff(snapshot, envelope, receipts, {
    now,
    issuedAt: now,
    serverId: 'asa-gen1'
  });
  const permit = createAdapterPermit(handoff, snapshot, envelope, receipts, 2, {
    now,
    serverId: 'asa-gen1',
    adapter: 'RewardsAscended'
  });
  assert.equal(permit.allowed, false);
  assert.equal(permit.attemptReason, 'uncertain_requires_reconciliation');
});

test('invalidates permits when receipt state changes after issuance', () => {
  const { now, envelope, receipts, snapshot, handoff } = fixture();
  const permit = createAdapterPermit(handoff, snapshot, envelope, receipts, 2, {
    now,
    serverId: 'asa-gen1',
    adapter: 'RewardsAscended'
  });
  const action = envelope.actions[2];
  const changedReceipts = [{
    serverId: envelope.serverId,
    protocolId: envelope.protocolId,
    actionId: action.actionId,
    idempotencyKey: action.idempotencyKey,
    status: 'succeeded',
    completedAt: now
  }];
  assert.throws(() => assertAdapterPermit(permit, handoff, snapshot, envelope, changedReceipts, {
    now,
    serverId: 'asa-gen1'
  }));
});

test('permits cannot outlive the executor handoff', () => {
  const { now, envelope, receipts, snapshot, handoff } = fixture();
  const permit = createAdapterPermit(handoff, snapshot, envelope, receipts, 0, {
    now,
    serverId: 'asa-gen1',
    adapter: 'EventCountdown'
  });
  assert.equal(permit.expiresAt, handoff.expiresAt);
  assert.throws(() => assertAdapterPermit(permit, handoff, snapshot, envelope, receipts, {
    now: handoff.expiresAt + 1,
    serverId: 'asa-gen1'
  }), /expired/);
});
