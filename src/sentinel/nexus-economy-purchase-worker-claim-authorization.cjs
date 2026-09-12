'use strict';

const { createNexusEconomyPurchaseWorkerClaimRequest } = require('./nexus-economy-purchase-worker-claim-request.cjs');

function reject(reason, actionId = null) {
  return Object.freeze({
    ok: false,
    claimReady: false,
    claimAuthorized: false,
    claimPermitted: false,
    executionPermitted: false,
    reason,
    actionId,
    authorization: null
  });
}

function enabled(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function createNexusEconomyPurchaseWorkerClaimAuthorization({ env = process.env } = {}) {
  const boundary = createNexusEconomyPurchaseWorkerClaimRequest();

  return Object.freeze({
    authorize(action, suppliedTicket, suppliedClaimRequest) {
      const prepared = boundary.prepare(action, suppliedTicket);
      if (!prepared.ok) return reject(prepared.reason, prepared.actionId);

      const expected = prepared.claimRequest;
      if (!suppliedClaimRequest || typeof suppliedClaimRequest !== 'object' || Array.isArray(suppliedClaimRequest)) {
        return reject('invalid-worker-claim-request', prepared.actionId);
      }

      const exactKeys = [
        'schemaVersion', 'actionId', 'ticketId', 'intakeDigest', 'expectedStatus', 'nextStatus',
        'idempotencyKey', 'correlationId', 'subject', 'claimId', 'claimDigest', 'claimPermitted', 'executionPermitted'
      ];
      for (const key of exactKeys) {
        if (suppliedClaimRequest[key] !== expected[key]) {
          return reject(`worker-claim-${key}-mismatch`, prepared.actionId);
        }
      }

      if (!suppliedClaimRequest.compareAndSet ||
          suppliedClaimRequest.compareAndSet.expectedStatus !== expected.compareAndSet.expectedStatus ||
          suppliedClaimRequest.compareAndSet.nextStatus !== expected.compareAndSet.nextStatus) {
        return reject('worker-claim-compare-and-set-mismatch', prepared.actionId);
      }

      if (String(env.NEXUS_ECONOMY_RUNTIME_MODE || '').trim().toLowerCase() !== 'active') {
        return reject('economy-runtime-not-active', prepared.actionId);
      }
      if (String(env.NEXUS_ECONOMY_AUTHORITY || '').trim().toLowerCase() !== 'nexus') {
        return reject('economy-authority-not-nexus', prepared.actionId);
      }
      if (!enabled(env.NEXUS_ECONOMY_MUTATIONS_ENABLED)) {
        return reject('economy-mutations-disabled', prepared.actionId);
      }
      if (!enabled(env.NEXUS_ECONOMY_PURCHASES_ENABLED)) {
        return reject('economy-purchases-disabled', prepared.actionId);
      }
      if (!enabled(env.NEXUS_ECONOMY_ACTION_SUBMISSION_ENABLED)) {
        return reject('economy-action-submission-disabled', prepared.actionId);
      }
      if (!enabled(env.NEXUS_ECONOMY_WORKER_CLAIMS_ENABLED)) {
        return reject('economy-worker-claims-disabled', prepared.actionId);
      }

      const authorization = Object.freeze({
        schemaVersion: 1,
        actionId: expected.actionId,
        claimId: expected.claimId,
        claimDigest: expected.claimDigest,
        expectedStatus: expected.expectedStatus,
        nextStatus: expected.nextStatus,
        idempotencyKey: expected.idempotencyKey,
        correlationId: expected.correlationId,
        subject: expected.subject,
        authorizationReady: true,
        claimPermitted: false,
        executionPermitted: false
      });

      return Object.freeze({
        ok: true,
        claimReady: true,
        claimAuthorized: true,
        claimPermitted: false,
        executionPermitted: false,
        reason: 'purchase-worker-claim-authorized-but-disabled',
        actionId: expected.actionId,
        authorization
      });
    }
  });
}

module.exports = {
  createNexusEconomyPurchaseWorkerClaimAuthorization
};
