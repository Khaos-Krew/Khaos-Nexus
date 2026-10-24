'use strict';

const crypto = require('node:crypto');
const {
  assertAdapterDispatchReservation
} = require('./nexus-protocol-adapter-dispatch-reservation.cjs');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function buildAdapterDispatchConsumptionPlan(reservation, authorization, proposal, admission, commandContract, secret, options = {}) {
  assertAdapterDispatchReservation(reservation, authorization, proposal, admission, commandContract, secret);

  const plannedAt = Number(options.plannedAt ?? Date.now());
  if (!Number.isSafeInteger(plannedAt) || plannedAt < Number(reservation.reservedAt)
    || plannedAt > Number(reservation.authorizationExpiresAt)) {
    throw new Error('Protocol adapter dispatch consumption plan is stale or outside authorization window');
  }

  const consumedReservationKeys = new Set((options.consumedReservationKeys || []).map((value) => String(value).toLowerCase()));
  if (consumedReservationKeys.has(String(reservation.reservationKey).toLowerCase())) {
    throw new Error('Protocol adapter dispatch reservation is already consumed');
  }

  const consumptionKey = digest({
    reservationKey: String(reservation.reservationKey).toLowerCase(),
    reservationDigest: String(reservation.reservationDigest).toLowerCase(),
    authorizationSignatureDigest: String(reservation.authorizationSignatureDigest).toLowerCase(),
    attemptId: reservation.attemptId
  });

  const payload = {
    version: 1,
    kind: 'protocol-adapter-dispatch-consumption-plan',
    protocolId: reservation.protocolId,
    serverId: reservation.serverId,
    actionId: reservation.actionId,
    actionIndex: reservation.actionIndex,
    adapter: reservation.adapter,
    operation: reservation.operation,
    attemptId: reservation.attemptId,
    proposalDigest: reservation.proposalDigest,
    permitDigest: reservation.permitDigest,
    commandDigest: reservation.commandDigest,
    idempotencyKeyDigest: reservation.idempotencyKeyDigest ?? null,
    authorizationSignatureDigest: reservation.authorizationSignatureDigest,
    authorizationExpiresAt: reservation.authorizationExpiresAt,
    reservationKey: reservation.reservationKey,
    reservationDigest: reservation.reservationDigest,
    consumptionKey,
    plannedAt,
    requiresAtomicConsumptionBeforeDispatch: true,
    requiresSingleUseReservation: true,
    requiresAuthorizationReverificationAtDispatch: true,
    requiresReceiptPersistence: true,
    requiresPostDispatchOutcomeCapture: true,
    authorizesAdapterDispatch: false,
    authorizesRetry: false,
    executesCommand: false,
    consumesAuthorization: false,
    persistsConsumption: false,
    persistsReceipt: false,
    mutatesServerConfiguration: false,
    readOnly: true
  };

  return Object.freeze({ ...payload, consumptionPlanDigest: digest(payload) });
}

function assertAdapterDispatchConsumptionPlan(plan, reservation, authorization, proposal, admission, commandContract, secret) {
  if (!plan || Number(plan.version) !== 1 || plan.kind !== 'protocol-adapter-dispatch-consumption-plan'
    || plan.requiresAtomicConsumptionBeforeDispatch !== true || plan.requiresSingleUseReservation !== true
    || plan.requiresAuthorizationReverificationAtDispatch !== true || plan.requiresReceiptPersistence !== true
    || plan.requiresPostDispatchOutcomeCapture !== true || plan.authorizesAdapterDispatch !== false
    || plan.authorizesRetry !== false || plan.executesCommand !== false || plan.consumesAuthorization !== false
    || plan.persistsConsumption !== false || plan.persistsReceipt !== false
    || plan.mutatesServerConfiguration !== false || plan.readOnly !== true
    || !/^[a-f0-9]{64}$/.test(String(plan.consumptionKey || '').toLowerCase())
    || !/^[a-f0-9]{64}$/.test(String(plan.consumptionPlanDigest || '').toLowerCase())) {
    throw new Error('Invalid Protocol adapter dispatch consumption plan');
  }

  const expected = buildAdapterDispatchConsumptionPlan(
    reservation,
    authorization,
    proposal,
    admission,
    commandContract,
    secret,
    { plannedAt: plan.plannedAt }
  );
  if (JSON.stringify(canonical(plan)) !== JSON.stringify(canonical(expected))) {
    throw new Error('Protocol adapter dispatch consumption plan no longer matches reservation');
  }
  return true;
}

module.exports = {
  buildAdapterDispatchConsumptionPlan,
  assertAdapterDispatchConsumptionPlan
};
