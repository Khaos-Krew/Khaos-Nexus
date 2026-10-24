'use strict';

const crypto = require('node:crypto');
const {
  verifyAdapterDispatchAuthorization
} = require('./nexus-protocol-adapter-dispatch-authorization.cjs');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function buildAdapterDispatchReservation(authorization, proposal, admission, commandContract, secret, options = {}) {
  const reservedAt = Number(options.reservedAt ?? Date.now());
  verifyAdapterDispatchAuthorization(authorization, proposal, admission, commandContract, secret, { now: reservedAt });

  const authorizationSignatureDigest = crypto.createHash('sha256')
    .update(String(authorization.authorizationSignature).toLowerCase())
    .digest('hex');
  const reservationKey = digest({
    protocolId: authorization.protocolId,
    serverId: authorization.serverId,
    actionId: authorization.actionId,
    actionIndex: authorization.actionIndex,
    adapter: authorization.adapter,
    operation: authorization.operation,
    attemptId: authorization.attemptId,
    authorizationSignatureDigest
  });

  const existingReservationKeys = new Set((options.existingReservationKeys || []).map((value) => String(value).toLowerCase()));
  if (existingReservationKeys.has(reservationKey)) {
    throw new Error('Protocol adapter dispatch authorization already has a reservation');
  }

  const payload = {
    version: 1,
    kind: 'protocol-adapter-dispatch-reservation',
    protocolId: authorization.protocolId,
    serverId: authorization.serverId,
    actionId: authorization.actionId,
    actionIndex: authorization.actionIndex,
    adapter: authorization.adapter,
    operation: authorization.operation,
    attemptId: authorization.attemptId,
    proposalDigest: String(authorization.proposalDigest).toLowerCase(),
    permitDigest: String(authorization.permitDigest).toLowerCase(),
    commandDigest: String(authorization.commandDigest).toLowerCase(),
    idempotencyKeyDigest: authorization.idempotencyKeyDigest ?? null,
    authorizationSignatureDigest,
    authorizationExpiresAt: Number(authorization.expiresAt),
    reservationKey,
    reservedAt,
    requiresAtomicPersistenceBeforeDispatch: true,
    requiresUniqueReservation: true,
    requiresAuthorizationReverificationAtDispatch: true,
    requiresReceiptPersistence: true,
    requiresPostDispatchOutcomeCapture: true,
    authorizesAdapterDispatch: false,
    authorizesRetry: false,
    executesCommand: false,
    consumesAuthorization: false,
    persistsReceipt: false,
    mutatesServerConfiguration: false,
    readOnly: true
  };

  return Object.freeze({ ...payload, reservationDigest: digest(payload) });
}

function assertAdapterDispatchReservation(reservation, authorization, proposal, admission, commandContract, secret) {
  if (!reservation || Number(reservation.version) !== 1 || reservation.kind !== 'protocol-adapter-dispatch-reservation'
    || reservation.requiresAtomicPersistenceBeforeDispatch !== true || reservation.requiresUniqueReservation !== true
    || reservation.requiresAuthorizationReverificationAtDispatch !== true || reservation.requiresReceiptPersistence !== true
    || reservation.requiresPostDispatchOutcomeCapture !== true || reservation.authorizesAdapterDispatch !== false
    || reservation.authorizesRetry !== false || reservation.executesCommand !== false || reservation.consumesAuthorization !== false
    || reservation.persistsReceipt !== false || reservation.mutatesServerConfiguration !== false || reservation.readOnly !== true
    || !/^[a-f0-9]{64}$/.test(String(reservation.reservationKey || '').toLowerCase())
    || !/^[a-f0-9]{64}$/.test(String(reservation.reservationDigest || '').toLowerCase())) {
    throw new Error('Invalid Protocol adapter dispatch reservation');
  }

  const expected = buildAdapterDispatchReservation(
    authorization,
    proposal,
    admission,
    commandContract,
    secret,
    { reservedAt: reservation.reservedAt }
  );
  if (JSON.stringify(canonical(reservation)) !== JSON.stringify(canonical(expected))) {
    throw new Error('Protocol adapter dispatch reservation no longer matches authorization');
  }
  return true;
}

module.exports = {
  buildAdapterDispatchReservation,
  assertAdapterDispatchReservation
};
