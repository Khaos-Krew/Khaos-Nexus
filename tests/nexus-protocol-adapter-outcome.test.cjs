'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { protocolExecutionPlan, buildExecutionEnvelope } = require('../src/sentinel/nexus-protocol-executors.cjs');
const { createPreflightSnapshot } = require('../src/sentinel/nexus-protocol-preflight-snapshot.cjs');
const { createExecutorHandoff } = require('../src/sentinel/nexus-protocol-executor-handoff.cjs');
const { createAdapterPermit } = require('../src/sentinel/nexus-protocol-adapter-permit.cjs');
const { createAdapterOutcome, assertAdapterOutcome } = require('../src/sentinel/nexus-protocol-adapter-outcome.cjs');

function fixture(actionIndex = 0, now = 100000) {
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
  const action = envelope.actions[actionIndex];
  const permit = createAdapterPermit(handoff, snapshot, envelope, receipts, actionIndex, {
    now,
    serverId: 'asa-gen1',
    adapter: action.plugin
  });
  return { now, envelope, receipts, snapshot, handoff, permit, action };
}

test('confirmed EventCountdown acknowledgement creates a succeeded receipt proposal without persisting it', () => {
  const value = fixture(0);
  const outcome = createAdapterOutcome(value.permit, value.handoff, value.snapshot, value.envelope, value.receipts, {
    acknowledgement: 'confirmed_success',
    adapterReference: 'rcon:ack:1001',
    completedAt: value.now
  }, { now: value.now, serverId: 'asa-gen1' });
  assert.equal(outcome.adapter, 'EventCountdown');
  assert.equal(outcome.receipt.status, 'succeeded');
  assert.equal(outcome.requiresReceiptPersistence, true);
  assert.equal(outcome.persistsReceipt, false);
  assert.equal(outcome.executesCommand, false);
  assert.equal(Object.hasOwn(outcome, 'command'), false);
  assert.equal(assertAdapterOutcome(outcome, value.permit, value.handoff, value.snapshot, value.envelope, value.receipts, {
    now: value.now,
    serverId: 'asa-gen1'
  }), true);
});

test('confirmed Cousin Custom Rates failure is retry-eligible only after durable receipt handling', () => {
  const value = fixture(1);
  const outcome = createAdapterOutcome(value.permit, value.handoff, value.snapshot, value.envelope, value.receipts, {
    acknowledgement: 'confirmed_failure',
    completedAt: value.now
  }, { now: value.now, serverId: 'asa-gen1' });
  assert.equal(outcome.adapter, 'CousinCustomRates');
  assert.equal(outcome.receipt.status, 'failed');
  assert.equal(outcome.retryEligible, true);
  assert.equal(outcome.requiresReconciliation, false);
});

test('unknown RewardsAscended acknowledgement is quarantined as uncertain', () => {
  const value = fixture(2);
  const outcome = createAdapterOutcome(value.permit, value.handoff, value.snapshot, value.envelope, value.receipts, {
    acknowledgement: 'unknown',
    completedAt: value.now
  }, { now: value.now, serverId: 'asa-gen1' });
  assert.equal(outcome.adapter, 'RewardsAscended');
  assert.equal(outcome.receipt.status, 'uncertain');
  assert.equal(outcome.requiresReconciliation, true);
  assert.equal(outcome.retryEligible, false);
});

test('blocked permits cannot be converted into adapter outcomes', () => {
  const value = fixture(0);
  const blocked = { ...value.permit, allowed: false };
  assert.throws(() => createAdapterOutcome(blocked, value.handoff, value.snapshot, value.envelope, value.receipts, {
    acknowledgement: 'confirmed_success',
    completedAt: value.now
  }, { now: value.now, serverId: 'asa-gen1' }));
});

test('rejects invalid acknowledgements, future completion times and unsafe adapter references', () => {
  const value = fixture(0);
  assert.throws(() => createAdapterOutcome(value.permit, value.handoff, value.snapshot, value.envelope, value.receipts, {
    acknowledgement: 'maybe', completedAt: value.now
  }, { now: value.now, serverId: 'asa-gen1' }), /acknowledgement/);
  assert.throws(() => createAdapterOutcome(value.permit, value.handoff, value.snapshot, value.envelope, value.receipts, {
    acknowledgement: 'confirmed_success', completedAt: value.now + 1
  }, { now: value.now, serverId: 'asa-gen1' }), /completion time/);
  assert.throws(() => createAdapterOutcome(value.permit, value.handoff, value.snapshot, value.envelope, value.receipts, {
    acknowledgement: 'confirmed_success', adapterReference: 'bad reference with spaces', completedAt: value.now
  }, { now: value.now, serverId: 'asa-gen1' }), /adapter reference/);
});

test('tampered outcome status or authority flags fail validation', () => {
  const value = fixture(2);
  const outcome = createAdapterOutcome(value.permit, value.handoff, value.snapshot, value.envelope, value.receipts, {
    acknowledgement: 'unknown', completedAt: value.now
  }, { now: value.now, serverId: 'asa-gen1' });
  assert.throws(() => assertAdapterOutcome({ ...outcome, persistsReceipt: true }, value.permit, value.handoff, value.snapshot, value.envelope, value.receipts, {
    now: value.now, serverId: 'asa-gen1'
  }), /Invalid Protocol adapter outcome/);
  assert.throws(() => assertAdapterOutcome({ ...outcome, retryEligible: true }, value.permit, value.handoff, value.snapshot, value.envelope, value.receipts, {
    now: value.now, serverId: 'asa-gen1'
  }), /no longer matches/);
});
