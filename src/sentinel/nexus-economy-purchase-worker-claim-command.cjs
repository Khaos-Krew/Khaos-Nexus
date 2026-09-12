'use strict';

const { createNexusEconomyPurchaseWorkerClaimAuthorization } = require('./nexus-economy-purchase-worker-claim-authorization.cjs');

function reject(reason, actionId = null) {
  return Object.freeze({
    ok: false,
    commandReady: false,
    claimPermitted: false,
    executionPermitted: false,
    reason,
    actionId,
    command: null
  });
}

function createNexusEconomyPurchaseWorkerClaimCommand({ env = process.env } = {}) {
  const authorizationBoundary = createNexusEconomyPurchaseWorkerClaimAuthorization({ env });

  return Object.freeze({
    prepare(action, suppliedTicket, suppliedClaimRequest) {
      const authorized = authorizationBoundary.authorize(action, suppliedTicket, suppliedClaimRequest);
      if (!authorized.ok) return reject(authorized.reason, authorized.actionId);

      const auth = authorized.authorization;
      if (!auth || auth.authorizationReady !== true) {
        return reject('worker-claim-authorization-not-ready', authorized.actionId);
      }

      const command = Object.freeze({
        schemaVersion: 1,
        operation: 'action-store.compare-and-set-status',
        actionId: auth.actionId,
        expectedStatus: auth.expectedStatus,
        nextStatus: auth.nextStatus,
        idempotencyKey: auth.idempotencyKey,
        correlationId: auth.correlationId,
        subject: auth.subject,
        claimId: auth.claimId,
        claimDigest: auth.claimDigest,
        destructive: false,
        persistPermitted: false,
        claimPermitted: false,
        executionPermitted: false
      });

      return Object.freeze({
        ok: true,
        commandReady: true,
        claimPermitted: false,
        executionPermitted: false,
        reason: 'purchase-worker-claim-command-ready-but-disabled',
        actionId: auth.actionId,
        command
      });
    }
  });
}

module.exports = {
  createNexusEconomyPurchaseWorkerClaimCommand
};
