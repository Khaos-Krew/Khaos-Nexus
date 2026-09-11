'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAdapterReconciliationDecision,
  assertAdapterReconciliationDecision
} = require('../src/sentinel/nexus-protocol-adapter-reconciliation.cjs');

const HEX = 'a'.repeat(64);
const COMMIT_HEX = 'b'.repeat(64);
const RECEIPT_HEX = 'c'.repeat(64);

function fixtures(status = 'failed') {
  const outcome = {
    version: 1,
    protocolId: 'alpha-purge',
    serverId: 'island-1',
    actionId: 'reward-001',
    adapter: 'RewardsAscended',
    outcomeDigest: HEX,
    receiptDigest: RECEIPT_HEX,
    receipt: { status, completedAt: 1000 },
    requiresReceiptPersistence: true,
    executesCommand: false,
    persistsReceipt: false,
    mutatesServerConfiguration: false
  };
  const commit = {
    version: 1,
    protocolId: outcome.protocolId,
    serverId: outcome.serverId,
    actionId: outcome.actionId,
    adapter: outcome.adapter,
    persistedReceiptDigest: RECEIPT_HEX,
    persistedStatus: status,
    persistenceCommitDigest: COMMIT_HEX,
    durableAppendVerified: true,
    executesCommand: false,
    mutatesServerConfiguration: false,
    grantsRetryAuthority: false,
    readOnly: true
  };
  return { outcome, commit };
}

test('confirmed failure may only prepare a completely fresh attempt', () => {
  const { outcome, commit } = fixtures('failed');
  const decision = buildAdapterReconciliationDecision(outcome, commit, {
    decision: 'prepare_new_attempt', reviewer: 'sentinel', decidedAt: 1100
  });
  assert.equal(decision.nextAction, 'require_fresh_preflight_and_permit');
  assert.equal(decision.requiresFreshPreflight, true);
  assert.equal(decision.requiresFreshAdapterPermit, true);
  assert.equal(decision.reusesPriorPermit, false);
  assert.equal(decision.grantsRetryAuthority, false);
  assert.equal(decision.executesCommand, false);
  assert.equal(assertAdapterReconciliationDecision(decision, outcome, commit), true);
});

test('uncertain outcomes cannot be converted into retry attempts', () => {
  const { outcome, commit } = fixtures('uncertain');
  assert.throws(() => buildAdapterReconciliationDecision(outcome, commit, {
    decision: 'prepare_new_attempt', reviewer: 'sentinel', decidedAt: 1100
  }), /not allowed/);
  const investigation = buildAdapterReconciliationDecision(outcome, commit, {
    decision: 'investigate', reviewer: 'sentinel', decidedAt: 1100
  });
  assert.equal(investigation.nextAction, 'manual_reconciliation_required');
  assert.equal(investigation.grantsRetryAuthority, false);
});

test('success only permits completion and never retry preparation', () => {
  const { outcome, commit } = fixtures('succeeded');
  const accepted = buildAdapterReconciliationDecision(outcome, commit, {
    decision: 'accept_success', reviewer: 'sentinel', decidedAt: 1100
  });
  assert.equal(accepted.nextAction, 'complete');
  assert.throws(() => buildAdapterReconciliationDecision(outcome, commit, {
    decision: 'prepare_new_attempt', reviewer: 'sentinel', decidedAt: 1100
  }), /not allowed/);
});

test('mismatched durable receipt or adapter identity fails closed', () => {
  const { outcome, commit } = fixtures('failed');
  assert.throws(() => buildAdapterReconciliationDecision(outcome, { ...commit, persistedReceiptDigest: 'd'.repeat(64) }, {
    decision: 'hold', reviewer: 'sentinel', decidedAt: 1100
  }), /same durable execution outcome/);
  assert.throws(() => buildAdapterReconciliationDecision(outcome, { ...commit, adapter: 'EventCountdown' }, {
    decision: 'hold', reviewer: 'sentinel', decidedAt: 1100
  }), /same durable execution outcome/);
});

test('authority escalation and decision tampering invalidate reconciliation artifact', () => {
  const { outcome, commit } = fixtures('failed');
  const decision = buildAdapterReconciliationDecision(outcome, commit, {
    decision: 'hold', reviewer: 'sentinel', decidedAt: 1100
  });
  assert.throws(() => assertAdapterReconciliationDecision({ ...decision, grantsRetryAuthority: true }, outcome, commit), /Invalid/);
  assert.throws(() => assertAdapterReconciliationDecision({ ...decision, executesCommand: true }, outcome, commit), /Invalid/);
  assert.throws(() => assertAdapterReconciliationDecision({ ...decision, nextAction: 'retry_now' }, outcome, commit), /no longer matches/);
});
