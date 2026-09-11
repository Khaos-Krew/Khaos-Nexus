'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAdapterDispatchProposal
} = require('../src/sentinel/nexus-protocol-adapter-dispatch-proposal.cjs');
const {
  issueAdapterDispatchAuthorization,
  verifyAdapterDispatchAuthorization
} = require('../src/sentinel/nexus-protocol-adapter-dispatch-authorization.cjs');

const SECRET = 'nexus-protocol-dispatch-secret-32-bytes-minimum';

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
    expiresAt: 120000,
    requiresFreshAdapterPermit: true,
    requiresReceiptPersistence: true,
    executesCommand: false,
    mutatesServerConfiguration: false,
    grantsRetryAuthority: false,
    readOnly: true,
    ...overrides
  };
}

function fixture() {
  const a = admission();
  const c = contract();
  const proposal = buildAdapterDispatchProposal(a, c, { preparedAt: 1200 });
  return { a, c, proposal };
}

test('issues a short-lived signed single-use dispatch authorization without executing', () => {
  const { a, c, proposal } = fixture();
  const auth = issueAdapterDispatchAuthorization(proposal, a, c, SECRET, { issuedAt: 1300, ttlMs: 60000 });
  assert.equal(auth.authorizesAdapterDispatch, true);
  assert.equal(auth.authorizesRetry, false);
  assert.equal(auth.singleUseRequired, true);
  assert.equal(auth.executesCommand, false);
  assert.equal(auth.persistsReceipt, false);
  assert.equal(auth.idempotencyKeyDigest, 'd'.repeat(64));
  assert.equal(verifyAdapterDispatchAuthorization(auth, proposal, a, c, SECRET, { now: 2000 }), true);
});

test('rejects weak signing secrets and authorization lifetimes above two minutes', () => {
  const { a, c, proposal } = fixture();
  assert.throws(() => issueAdapterDispatchAuthorization(proposal, a, c, 'weak', { issuedAt: 1300 }), /at least 32 bytes/);
  assert.throws(() => issueAdapterDispatchAuthorization(proposal, a, c, SECRET, { issuedAt: 1300, ttlMs: 120001 }), /Invalid Protocol adapter dispatch authorization window/);
});

test('rejects expired authorization and proposal-window overflow', () => {
  const { a, c, proposal } = fixture();
  const auth = issueAdapterDispatchAuthorization(proposal, a, c, SECRET, { issuedAt: 1300, ttlMs: 60000 });
  assert.throws(() => verifyAdapterDispatchAuthorization(auth, proposal, a, c, SECRET, { now: 70000 }), /stale or outside/);

  const shortContract = contract({ expiresAt: 5000 });
  const shortProposal = buildAdapterDispatchProposal(a, shortContract, { preparedAt: 1200 });
  const clipped = issueAdapterDispatchAuthorization(shortProposal, a, shortContract, SECRET, { issuedAt: 1300, ttlMs: 60000 });
  assert.equal(clipped.expiresAt, 5000);
});

test('rejects forged signatures and proposal substitution', () => {
  const { a, c, proposal } = fixture();
  const auth = issueAdapterDispatchAuthorization(proposal, a, c, SECRET, { issuedAt: 1300 });
  assert.throws(() => verifyAdapterDispatchAuthorization({ ...auth, authorizationSignature: '0'.repeat(64) }, proposal, a, c, SECRET, { now: 1400 }), /signature mismatch/);
  assert.throws(() => verifyAdapterDispatchAuthorization({ ...auth, actionId: 'other-action' }, proposal, a, c, SECRET, { now: 1400 }), /signature mismatch|no longer matches/);
});

test('rejects retry, execution, receipt, and server-configuration authority escalation', () => {
  const { a, c, proposal } = fixture();
  const auth = issueAdapterDispatchAuthorization(proposal, a, c, SECRET, { issuedAt: 1300 });
  assert.throws(() => verifyAdapterDispatchAuthorization({ ...auth, authorizesRetry: true }, proposal, a, c, SECRET, { now: 1400 }), /Invalid/);
  assert.throws(() => verifyAdapterDispatchAuthorization({ ...auth, executesCommand: true }, proposal, a, c, SECRET, { now: 1400 }), /Invalid/);
  assert.throws(() => verifyAdapterDispatchAuthorization({ ...auth, persistsReceipt: true }, proposal, a, c, SECRET, { now: 1400 }), /Invalid/);
  assert.throws(() => verifyAdapterDispatchAuthorization({ ...auth, mutatesServerConfiguration: true }, proposal, a, c, SECRET, { now: 1400 }), /Invalid/);
});
