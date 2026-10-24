'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAdapterDispatchProposal } = require('../src/sentinel/nexus-protocol-adapter-dispatch-proposal.cjs');
const { issueAdapterDispatchAuthorization } = require('../src/sentinel/nexus-protocol-adapter-dispatch-authorization.cjs');
const { buildAdapterDispatchReservation } = require('../src/sentinel/nexus-protocol-adapter-dispatch-reservation.cjs');
const {
  buildAdapterDispatchConsumptionPlan,
  assertAdapterDispatchConsumptionPlan
} = require('../src/sentinel/nexus-protocol-adapter-dispatch-consumption-plan.cjs');

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
  const reservation = buildAdapterDispatchReservation(authorization, proposal, a, c, SECRET, { reservedAt: 1400 });
  return { a, c, proposal, authorization, reservation };
}

test('builds a deterministic single-use consumption plan without dispatch authority', () => {
  const { a, c, proposal, authorization, reservation } = fixture();
  const plan = buildAdapterDispatchConsumptionPlan(reservation, authorization, proposal, a, c, SECRET, { plannedAt: 1500 });
  const repeat = buildAdapterDispatchConsumptionPlan(reservation, authorization, proposal, a, c, SECRET, { plannedAt: 1600 });
  assert.equal(plan.consumptionKey, repeat.consumptionKey);
  assert.equal(plan.requiresAtomicConsumptionBeforeDispatch, true);
  assert.equal(plan.requiresSingleUseReservation, true);
  assert.equal(plan.authorizesAdapterDispatch, false);
  assert.equal(plan.executesCommand, false);
  assert.equal(plan.persistsConsumption, false);
  assert.equal(plan.idempotencyKeyDigest, 'd'.repeat(64));
  assert.equal(assertAdapterDispatchConsumptionPlan(plan, reservation, authorization, proposal, a, c, SECRET), true);
});

test('rejects a reservation that the durable store reports as already consumed', () => {
  const { a, c, proposal, authorization, reservation } = fixture();
  assert.throws(() => buildAdapterDispatchConsumptionPlan(reservation, authorization, proposal, a, c, SECRET, {
    plannedAt: 1500,
    consumedReservationKeys: [reservation.reservationKey]
  }), /already consumed/);
});

test('rejects plans outside the signed authorization window', () => {
  const { a, c, proposal, authorization, reservation } = fixture();
  assert.throws(() => buildAdapterDispatchConsumptionPlan(reservation, authorization, proposal, a, c, SECRET, { plannedAt: 1000 }), /stale or outside/);
  assert.throws(() => buildAdapterDispatchConsumptionPlan(reservation, authorization, proposal, a, c, SECRET, { plannedAt: 70000 }), /stale or outside/);
});

test('rejects reservation or authorization substitution', () => {
  const { a, c, proposal, authorization, reservation } = fixture();
  assert.throws(() => buildAdapterDispatchConsumptionPlan({ ...reservation, actionId: 'other' }, authorization, proposal, a, c, SECRET, { plannedAt: 1500 }), /no longer matches/);
  assert.throws(() => buildAdapterDispatchConsumptionPlan(reservation, { ...authorization, actionId: 'other' }, proposal, a, c, SECRET, { plannedAt: 1500 }), /signature mismatch|no longer matches/);
});

test('rejects consumption-plan tampering and authority escalation', () => {
  const { a, c, proposal, authorization, reservation } = fixture();
  const plan = buildAdapterDispatchConsumptionPlan(reservation, authorization, proposal, a, c, SECRET, { plannedAt: 1500 });
  assert.throws(() => assertAdapterDispatchConsumptionPlan({ ...plan, authorizesAdapterDispatch: true }, reservation, authorization, proposal, a, c, SECRET), /Invalid/);
  assert.throws(() => assertAdapterDispatchConsumptionPlan({ ...plan, authorizesRetry: true }, reservation, authorization, proposal, a, c, SECRET), /Invalid/);
  assert.throws(() => assertAdapterDispatchConsumptionPlan({ ...plan, executesCommand: true }, reservation, authorization, proposal, a, c, SECRET), /Invalid/);
  assert.throws(() => assertAdapterDispatchConsumptionPlan({ ...plan, consumptionKey: 'f'.repeat(64) }, reservation, authorization, proposal, a, c, SECRET), /no longer matches/);
});
