'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { protocolExecutionPlan, buildExecutionEnvelope } = require('../src/sentinel/nexus-protocol-executors.cjs');
const { createPreflightSnapshot } = require('../src/sentinel/nexus-protocol-preflight-snapshot.cjs');
const { createExecutorHandoff } = require('../src/sentinel/nexus-protocol-executor-handoff.cjs');
const { createAdapterPermit } = require('../src/sentinel/nexus-protocol-adapter-permit.cjs');
const { createAdapterOutcome } = require('../src/sentinel/nexus-protocol-adapter-outcome.cjs');
const {
  createReceiptPersistenceProposal,
  assertReceiptPersistenceProposal
} = require('../src/sentinel/nexus-protocol-receipt-persistence-proposal.cjs');

function fixture(actionIndex = 0, acknowledgement = 'confirmed_success', now = 100000) {
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
  const receiptState = { version: 1, revision: 7, updatedAt: now - 1, receipts: [] };
  const snapshot = createPreflightSnapshot(envelope, receiptState.receipts, {
    now, issuedAt: now, ttlMs: 15000, serverId: 'asa-gen1'
  });
  const handoff = createExecutorHandoff(snapshot, envelope, receiptState.receipts, {
    now, issuedAt: now, serverId: 'asa-gen1'
  });
  const action = envelope.actions[actionIndex];
  const permit = createAdapterPermit(handoff, snapshot, envelope, receiptState.receipts, actionIndex, {
    now, serverId: 'asa-gen1', adapter: action.plugin
  });
  const outcome = createAdapterOutcome(permit, handoff, snapshot, envelope, receiptState.receipts, {
    acknowledgement, completedAt: now
  }, { now, serverId: 'asa-gen1' });
  return { now, envelope, receiptState, snapshot, handoff, permit, outcome };
}

test('binds an adapter outcome to an exact durable receipt-store revision without persisting it', () => {
  const value = fixture(0);
  const proposal = createReceiptPersistenceProposal(
    value.outcome, value.permit, value.handoff, value.snapshot, value.envelope, value.receiptState,
    { now: value.now, serverId: 'asa-gen1' }
  );
  assert.equal(proposal.adapter, 'EventCountdown');
  assert.equal(proposal.expectedStoreRevision, 7);
  assert.equal(proposal.proposedReceipt.status, 'succeeded');
  assert.equal(proposal.requiresAtomicCompareAndAppend, true);
  assert.equal(proposal.persistsReceipt, false);
  assert.equal(proposal.executesCommand, false);
  assert.equal(assertReceiptPersistenceProposal(
    proposal, value.outcome, value.permit, value.handoff, value.snapshot, value.envelope, value.receiptState,
    { now: value.now, serverId: 'asa-gen1' }
  ), true);
});

test('uncertain RewardsAscended outcomes remain uncertain at the persistence boundary', () => {
  const value = fixture(2, 'unknown');
  const proposal = createReceiptPersistenceProposal(
    value.outcome, value.permit, value.handoff, value.snapshot, value.envelope, value.receiptState,
    { now: value.now, serverId: 'asa-gen1' }
  );
  assert.equal(proposal.adapter, 'RewardsAscended');
  assert.equal(proposal.proposedReceipt.status, 'uncertain');
  assert.equal(proposal.requiresReceiptPersistence, true);
});

test('store revision changes invalidate a previously created persistence proposal', () => {
  const value = fixture(1, 'confirmed_failure');
  const proposal = createReceiptPersistenceProposal(
    value.outcome, value.permit, value.handoff, value.snapshot, value.envelope, value.receiptState,
    { now: value.now, serverId: 'asa-gen1' }
  );
  const changed = { ...value.receiptState, revision: value.receiptState.revision + 1 };
  assert.throws(() => assertReceiptPersistenceProposal(
    proposal, value.outcome, value.permit, value.handoff, value.snapshot, value.envelope, changed,
    { now: value.now, serverId: 'asa-gen1' }
  ), /no longer matches/);
});

test('existing or conflicting durable receipts block a new persistence proposal', () => {
  const value = fixture(0);
  const alreadyRecorded = { ...value.receiptState, receipts: [value.outcome.receipt] };
  assert.throws(() => createReceiptPersistenceProposal(
    value.outcome, value.permit, value.handoff, value.snapshot, value.envelope, alreadyRecorded,
    { now: value.now, serverId: 'asa-gen1' }
  ));
});

test('proposal tampering or persistence-authority escalation fails validation', () => {
  const value = fixture(0);
  const proposal = createReceiptPersistenceProposal(
    value.outcome, value.permit, value.handoff, value.snapshot, value.envelope, value.receiptState,
    { now: value.now, serverId: 'asa-gen1' }
  );
  assert.throws(() => assertReceiptPersistenceProposal(
    { ...proposal, persistsReceipt: true }, value.outcome, value.permit, value.handoff, value.snapshot, value.envelope, value.receiptState,
    { now: value.now, serverId: 'asa-gen1' }
  ), /Invalid Protocol receipt persistence proposal/);
  assert.throws(() => assertReceiptPersistenceProposal(
    { ...proposal, proposedReceiptDigest: '0'.repeat(64) }, value.outcome, value.permit, value.handoff, value.snapshot, value.envelope, value.receiptState,
    { now: value.now, serverId: 'asa-gen1' }
  ), /no longer matches/);
});
