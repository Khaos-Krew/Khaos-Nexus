'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAdapterDispatchProposal
} = require('../src/sentinel/nexus-protocol-adapter-dispatch-proposal.cjs');
const {
  issueAdapterDispatchAuthorization
} = require('../src/sentinel/nexus-protocol-adapter-dispatch-authorization.cjs');
const {
  buildAdapterDispatchReservation,
  assertAdapterDispatchReservation
} = require('../src/sentinel/nexus-protocol-adapter-dispatch-reservation.cjs');

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
  const authorization = issueAdapterDispatchAuthorization(proposal, a, c, SECRET, { issuedAt: 1300, ttlMs: 60000 });
  return { a, c, proposal, authorization };
}

test('builds a deterministic reservation that must be atomically persisted before dispatch', () => {
  const { a, c, proposal, authorization } = fixture();
  const reservation = buildAdapterDispatchReservation(authorization, proposal, a, c, SECRET, { reservedAt: 1400 });
  assert.equal(reservation.requiresAtomicPersistenceBeforeDispatch, true);
  assert.equal(reservation.requiresUniqueReservation, true);
  assert.equal(reservation.requiresAuthorizationReverificationAtDispatch, true);
  assert.equal(reservation.authorizesAdapterDispatch, false);
  assert.equal(reservation.executesCommand, false);
  assert.equal(reservation.consumesAuthorization, false);
  assert.equal(reservation.idempotencyKeyDigest, 'd'.repeat(64));
  assert.equal(assertAdapterDispatchReservation(reservation, authorization, proposal, a, c, SECRET), true);
});

test('uses a stable reservation key for the same authorization and rejects known duplicates', () => {
  const { a, c, proposal, authorization } = fixture();
  const first = buildAdapterDispatchReservation(authorization, proposal, a, c, SECRET, { reservedAt: 1400 });
  const second = buildAdapterDispatchReservation(authorization, proposal, a, c, SECRET, { reservedAt: 1500 });
  assert.equal(first.reservationKey, second.reservationKey);
  assert.throws(() => buildAdapterDispatchReservation(authorization, proposal, a, c, SECRET, {
    reservedAt: 1500,
    existingReservationKeys: [first.reservationKey]
  }), /already has a reservation/);
});

test('rejects reservation after authorization expiry', () => {
  const { a, c, proposal, authorization } = fixture();
  assert.throws(() => buildAdapterDispatchReservation(authorization, proposal, a, c, SECRET, { reservedAt: 70000 }), /stale or outside/);
});

test('rejects authorization or proposal substitution before reservation', () => {
  const { a, c, proposal, authorization } = fixture();
  assert.throws(() => buildAdapterDispatchReservation({ ...authorization, actionId: 'other' }, proposal, a, c, SECRET, { reservedAt: 1400 }), /signature mismatch|no longer matches/);
  assert.throws(() => buildAdapterDispatchReservation(authorization, { ...proposal, actionId: 'other' }, a, c, SECRET, { reservedAt: 1400 }), /proposal|matches/);
});

test('rejects reservation tampering and execution or retry authority escalation', () => {
  const { a, c, proposal, authorization } = fixture();
  const reservation = buildAdapterDispatchReservation(authorization, proposal, a, c, SECRET, { reservedAt: 1400 });
  assert.throws(() => assertAdapterDispatchReservation({ ...reservation, authorizesAdapterDispatch: true }, authorization, proposal, a, c, SECRET), /Invalid/);
  assert.throws(() => assertAdapterDispatchReservation({ ...reservation, authorizesRetry: true }, authorization, proposal, a, c, SECRET), /Invalid/);
  assert.throws(() => assertAdapterDispatchReservation({ ...reservation, executesCommand: true }, authorization, proposal, a, c, SECRET), /Invalid/);
  assert.throws(() => assertAdapterDispatchReservation({ ...reservation, reservationKey: 'f'.repeat(64) }, authorization, proposal, a, c, SECRET), /no longer matches/);
});
