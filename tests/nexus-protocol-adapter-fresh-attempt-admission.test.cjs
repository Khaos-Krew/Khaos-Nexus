'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAdapterFreshAttemptAdmission,
  assertAdapterFreshAttemptAdmission
} = require('../src/sentinel/nexus-protocol-adapter-fresh-attempt-admission.cjs');

function preparation(overrides = {}) {
  return {
    version: 1,
    kind: 'protocol-adapter-fresh-attempt-preparation',
    preparationDigest: 'a'.repeat(64),
    protocolId: 'dark-zone',
    serverId: 'astraeos-1',
    actionId: '0123456789abcdef01234567',
    adapter: 'RewardsAscended',
    attemptId: 'retry-2',
    preparedAt: 1000,
    requiresFreshPreflight: true,
    requiresFreshAdapterPermit: true,
    requiresNewIdempotencyEvaluation: true,
    reusesPriorPermit: false,
    reusesPriorPreflight: false,
    grantsRetryAuthority: false,
    executesCommand: false,
    persistsReceipt: false,
    mutatesServerConfiguration: false,
    readOnly: true,
    ...overrides
  };
}

function preflight(overrides = {}) {
  return {
    version: 1,
    protocolId: 'dark-zone',
    serverId: 'astraeos-1',
    envelopeCreatedAt: 1100,
    ready: true,
    executesCommands: false,
    blockers: [],
    actions: [{
      actionId: '0123456789abcdef01234567',
      index: 0,
      plugin: 'RewardsAscended',
      allowed: true,
      reason: 'retry_failed_action',
      priorStatus: 'failed'
    }],
    ...overrides
  };
}

function permit(overrides = {}) {
  return {
    version: 1,
    permitDigest: 'b'.repeat(64),
    protocolId: 'dark-zone',
    serverId: 'astraeos-1',
    actionId: '0123456789abcdef01234567',
    actionIndex: 0,
    adapter: 'RewardsAscended',
    attemptReason: 'retry_failed_action',
    allowed: true,
    issuedAt: 1200,
    expiresAt: 5000,
    requiresCommandRevalidation: true,
    requiresReceiptPersistence: true,
    executesCommand: false,
    mutatesServerConfiguration: false,
    ...overrides
  };
}

test('admits a fresh retry only after fresh preflight and permit', () => {
  const prep = preparation();
  const flight = preflight();
  const auth = permit();
  const admission = buildAdapterFreshAttemptAdmission(prep, flight, auth, { now: 1300 });
  assert.equal(admission.attemptReason, 'retry_failed_action');
  assert.equal(admission.requiresFreshCommandContract, true);
  assert.equal(admission.reusesPriorPermit, false);
  assert.equal(admission.grantsRetryAuthority, false);
  assert.equal(admission.executesCommand, false);
  assert.equal(assertAdapterFreshAttemptAdmission(admission, prep, flight, auth), true);
});

test('stale preflight or permit state fails closed', () => {
  assert.throws(() => buildAdapterFreshAttemptAdmission(preparation(), preflight({ envelopeCreatedAt: 999 }), permit()), /stale preflight or permit/);
  assert.throws(() => buildAdapterFreshAttemptAdmission(preparation(), preflight(), permit({ issuedAt: 999 })), /stale preflight or permit/);
});

test('adapter and action substitution fail closed', () => {
  assert.throws(() => buildAdapterFreshAttemptAdmission(preparation(), preflight(), permit({ adapter: 'EventCountdown' })), /same adapter action/);
  assert.throws(() => buildAdapterFreshAttemptAdmission(preparation(), preflight(), permit({ actionId: 'aaaaaaaaaaaaaaaaaaaaaaaa' })), /not bound/);
});

test('blocked preflight and invalid attempt classifications fail closed', () => {
  assert.throws(() => buildAdapterFreshAttemptAdmission(preparation(), preflight({ ready: false, blockers: ['0:already_succeeded'] }), permit()), /Invalid fresh Protocol executor preflight/);
  assert.throws(() => buildAdapterFreshAttemptAdmission(preparation(), preflight(), permit({ attemptReason: 'uncertain_requires_reconciliation' })), /invalid attempt classification/);
});

test('authority escalation and admission tampering fail closed', () => {
  const prep = preparation();
  const flight = preflight();
  const auth = permit();
  const admission = buildAdapterFreshAttemptAdmission(prep, flight, auth, { now: 1300 });
  assert.throws(() => assertAdapterFreshAttemptAdmission({ ...admission, executesCommand: true }, prep, flight, auth), /Invalid/);
  assert.throws(() => assertAdapterFreshAttemptAdmission({ ...admission, grantsRetryAuthority: true }, prep, flight, auth), /Invalid/);
  assert.throws(() => assertAdapterFreshAttemptAdmission({ ...admission, adapter: 'EventCountdown' }, prep, flight, auth), /no longer matches/);
});
