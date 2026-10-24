'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { protocolExecutionPlan, buildExecutionEnvelope } = require('../src/sentinel/nexus-protocol-executors.cjs');
const { createPreflightSnapshot } = require('../src/sentinel/nexus-protocol-preflight-snapshot.cjs');
const { createExecutorHandoff, assertExecutorHandoff } = require('../src/sentinel/nexus-protocol-executor-handoff.cjs');

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
  return { envelope, receipts, snapshot, now };
}

test('binds future executor handoff to exact preflight action set without executing commands', () => {
  const { envelope, receipts, snapshot, now } = fixture();
  const handoff = createExecutorHandoff(snapshot, envelope, receipts, { now, issuedAt: now, serverId: 'asa-gen1' });
  assert.equal(handoff.executesCommands, false);
  assert.equal(handoff.mutatesServerConfiguration, false);
  assert.equal(handoff.requiresAdapterRevalidation, true);
  assert.equal(handoff.actions.length, envelope.actions.length);
  assert.equal(handoff.actions.every((action) => !Object.hasOwn(action, 'command')), true);
  assert.equal(assertExecutorHandoff(handoff, snapshot, envelope, receipts, { now, serverId: 'asa-gen1' }), true);
});

test('rejects action substitution after preflight', () => {
  const { envelope, receipts, snapshot, now } = fixture();
  const handoff = createExecutorHandoff(snapshot, envelope, receipts, { now, issuedAt: now, serverId: 'asa-gen1' });
  const changed = {
    ...envelope,
    actions: envelope.actions.map((action, index) => index === 0 ? { ...action, command: 'RA.Reload' } : action)
  };
  assert.throws(() => assertExecutorHandoff(handoff, snapshot, changed, receipts, { now, serverId: 'asa-gen1' }));
});

test('rejects receipt-set changes after handoff creation', () => {
  const { envelope, receipts, snapshot, now } = fixture();
  const handoff = createExecutorHandoff(snapshot, envelope, receipts, { now, issuedAt: now, serverId: 'asa-gen1' });
  const changedReceipts = [{
    version: 1,
    actionId: envelope.actions[0].actionId,
    protocolId: envelope.protocolId,
    serverId: envelope.serverId,
    outcome: 'success',
    attemptedAt: now,
    completedAt: now,
    commandDigest: 'a'.repeat(64),
    digest: 'b'.repeat(64)
  }];
  assert.throws(() => assertExecutorHandoff(handoff, snapshot, envelope, changedReceipts, { now, serverId: 'asa-gen1' }));
});

test('handoff expires no later than the preflight snapshot', () => {
  const { envelope, receipts, snapshot, now } = fixture();
  const handoff = createExecutorHandoff(snapshot, envelope, receipts, { now, issuedAt: now, serverId: 'asa-gen1' });
  assert.equal(handoff.expiresAt, snapshot.expiresAt);
  assert.throws(() => assertExecutorHandoff(handoff, snapshot, envelope, receipts, {
    now: snapshot.expiresAt + 1,
    serverId: 'asa-gen1'
  }), /expired/);
});
