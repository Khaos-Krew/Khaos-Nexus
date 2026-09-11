'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAdapterDispatchProposal,
  assertAdapterDispatchProposal
} = require('../src/sentinel/nexus-protocol-adapter-dispatch-proposal.cjs');

function admission(overrides = {}) {
  return {
    version: 1,
    kind: 'protocol-adapter-fresh-attempt-admission',
    protocolId: 'alpha-purge',
    serverId: 'rag-1',
    actionId: 'reward-1',
    adapter: 'RewardsAscended',
    attemptId: 'attempt-2',
    attemptReason: 'retry_failed_action',
    permitDigest: 'a'.repeat(64),
    admittedAt: 1000,
    requiresFreshCommandContract: true,
    requiresReceiptPersistence: true,
    reusesPriorPermit: false,
    reusesPriorPreflight: false,
    grantsRetryAuthority: false,
    executesCommand: false,
    persistsReceipt: false,
    mutatesServerConfiguration: false,
    readOnly: true,
    admissionDigest: 'b'.repeat(64),
    ...overrides
  };
}

function contract(overrides = {}) {
  return {
    version: 1,
    protocolId: 'alpha-purge',
    serverId: 'rag-1',
    actionId: 'reward-1',
    actionIndex: 0,
    plugin: 'RewardsAscended',
    operation: 'grant_reward',
    commandDigest: 'c'.repeat(64),
    permitDigest: 'a'.repeat(64),
    mutating: true,
    requiresIdempotencyKey: true,
    idempotencyKeyDigest: 'd'.repeat(64),
    checkedAt: 1100,
    expiresAt: 2000,
    requiresFreshAdapterPermit: true,
    requiresReceiptPersistence: true,
    executesCommand: false,
    mutatesServerConfiguration: false,
    grantsRetryAuthority: false,
    readOnly: true,
    ...overrides
  };
}

test('builds a sealed non-executing dispatch proposal for an admitted action', () => {
  const a = admission();
  const c = contract();
  const proposal = buildAdapterDispatchProposal(a, c, { preparedAt: 1200 });
  assert.equal(proposal.operation, 'grant_reward');
  assert.equal(proposal.mutating, true);
  assert.equal(proposal.requiresFreshExecutorAuthorization, true);
  assert.equal(proposal.requiresPostDispatchOutcomeCapture, true);
  assert.equal(proposal.executesCommand, false);
  assert.equal(proposal.grantsRetryAuthority, false);
  assert.equal(assertAdapterDispatchProposal(proposal, a, c), true);
});

test('rejects adapter and permit substitution', () => {
  assert.throws(() => buildAdapterDispatchProposal(admission(), contract({ plugin: 'EventCountdown' })), /same admitted adapter action/);
  assert.throws(() => buildAdapterDispatchProposal(admission(), contract({ permitDigest: 'e'.repeat(64) })), /same admitted adapter action/);
});

test('rejects a command contract older than admission', () => {
  assert.throws(() => buildAdapterDispatchProposal(admission({ admittedAt: 1200 }), contract({ checkedAt: 1100 })), /stale/);
});

test('rejects proposal preparation outside the permit window', () => {
  assert.throws(() => buildAdapterDispatchProposal(admission(), contract(), { preparedAt: 2100 }), /Invalid Protocol dispatch proposal time/);
});

test('rejects execution, retry, and persistence authority escalation', () => {
  const a = admission();
  const c = contract();
  const proposal = buildAdapterDispatchProposal(a, c, { preparedAt: 1200 });
  assert.throws(() => assertAdapterDispatchProposal({ ...proposal, executesCommand: true }, a, c), /Invalid/);
  assert.throws(() => assertAdapterDispatchProposal({ ...proposal, grantsRetryAuthority: true }, a, c), /Invalid/);
  assert.throws(() => assertAdapterDispatchProposal({ ...proposal, persistsReceipt: true }, a, c), /Invalid/);
});

test('rejects sealed proposal tampering', () => {
  const a = admission();
  const c = contract();
  const proposal = buildAdapterDispatchProposal(a, c, { preparedAt: 1200 });
  assert.throws(() => assertAdapterDispatchProposal({ ...proposal, attemptId: 'attempt-99' }, a, c), /no longer matches/);
});
