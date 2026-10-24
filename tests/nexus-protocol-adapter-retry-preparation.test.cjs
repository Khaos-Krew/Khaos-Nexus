'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAdapterFreshAttemptPreparation,
  assertAdapterFreshAttemptPreparation
} = require('../src/sentinel/nexus-protocol-adapter-retry-preparation.cjs');

function decision(overrides = {}) {
  return {
    version: 1,
    kind: 'protocol-adapter-reconciliation-decision',
    outcomeDigest: 'a'.repeat(64),
    persistenceCommitDigest: 'b'.repeat(64),
    reconciliationDigest: 'c'.repeat(64),
    protocolId: 'alpha-purge',
    serverId: 'asa-gen1',
    actionId: 'rates-activate-1',
    adapter: 'cousin-custom-rates',
    durableStatus: 'failed',
    decision: 'prepare_new_attempt',
    nextAction: 'require_fresh_preflight_and_permit',
    reviewer: 'sentinel',
    rationale: 'known failed execution',
    decidedAt: 1000,
    requiresFreshPreflight: true,
    requiresFreshAdapterPermit: true,
    reusesPriorPermit: false,
    grantsRetryAuthority: false,
    executesCommand: false,
    persistsReceipt: false,
    mutatesServerConfiguration: false,
    readOnly: true,
    ...overrides
  };
}

test('failed durable action can prepare only a completely fresh attempt', () => {
  const source = decision();
  const preparation = buildAdapterFreshAttemptPreparation(source, {
    attemptId: 'attempt-2',
    preparedBy: 'sentinel',
    preparedAt: 1100
  });
  assert.equal(preparation.requiresFreshPreflight, true);
  assert.equal(preparation.requiresFreshAdapterPermit, true);
  assert.equal(preparation.requiresNewIdempotencyEvaluation, true);
  assert.equal(preparation.reusesPriorPermit, false);
  assert.equal(preparation.reusesPriorPreflight, false);
  assert.equal(preparation.grantsRetryAuthority, false);
  assert.equal(preparation.executesCommand, false);
  assert.equal(assertAdapterFreshAttemptPreparation(preparation, source), true);
});

test('uncertain and successful outcomes cannot enter fresh-attempt preparation', () => {
  assert.throws(() => buildAdapterFreshAttemptPreparation(decision({
    durableStatus: 'uncertain',
    decision: 'investigate',
    nextAction: 'manual_reconciliation_required',
    requiresFreshPreflight: false,
    requiresFreshAdapterPermit: false
  }), { attemptId: 'attempt-2' }), /Invalid Protocol reconciliation/);
  assert.throws(() => buildAdapterFreshAttemptPreparation(decision({
    durableStatus: 'succeeded',
    decision: 'accept_success',
    nextAction: 'complete',
    requiresFreshPreflight: false,
    requiresFreshAdapterPermit: false
  }), { attemptId: 'attempt-2' }), /Invalid Protocol reconciliation/);
});

test('fresh attempt preparation cannot precede reconciliation decision', () => {
  assert.throws(() => buildAdapterFreshAttemptPreparation(decision(), {
    attemptId: 'attempt-2',
    preparedAt: 999
  }), /preparation time/);
});

test('permit reuse, execution authority, and retry authority escalation fail closed', () => {
  const source = decision();
  const preparation = buildAdapterFreshAttemptPreparation(source, { attemptId: 'attempt-2', preparedAt: 1100 });
  assert.throws(() => assertAdapterFreshAttemptPreparation({ ...preparation, reusesPriorPermit: true }, source), /Invalid/);
  assert.throws(() => assertAdapterFreshAttemptPreparation({ ...preparation, executesCommand: true }, source), /Invalid/);
  assert.throws(() => assertAdapterFreshAttemptPreparation({ ...preparation, grantsRetryAuthority: true }, source), /Invalid/);
});

test('substituting the action or reconciliation digest invalidates the preparation', () => {
  const source = decision();
  const preparation = buildAdapterFreshAttemptPreparation(source, { attemptId: 'attempt-2', preparedAt: 1100 });
  assert.throws(() => assertAdapterFreshAttemptPreparation({ ...preparation, actionId: 'different-action' }, source), /no longer matches/);
  assert.throws(() => assertAdapterFreshAttemptPreparation({ ...preparation, reconciliationDigest: 'd'.repeat(64) }, source), /no longer matches/);
});
