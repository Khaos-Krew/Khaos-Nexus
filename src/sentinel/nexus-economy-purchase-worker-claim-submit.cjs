'use strict';

const { createNexusEconomyPurchaseWorkerClaimCommand } = require('./nexus-economy-purchase-worker-claim-command.cjs');

function enabled(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function reject(reason, actionId = null, errorCode = null) {
  return Object.freeze({
    ok: false,
    claimed: false,
    persisted: false,
    executionPermitted: false,
    reason,
    actionId,
    action: null,
    errorCode
  });
}

function submissionGate(env = {}) {
  if (!enabled(env.NEXUS_ECONOMY_WORKER_CAS_SUBMISSION_ENABLED)) {
    return 'economy-worker-cas-submission-disabled';
  }
  return null;
}

function validateClaimedAction(stored, command) {
  if (!stored || typeof stored !== 'object') return 'invalid-action-store-claim-result';
  if (stored.actionId !== command.actionId) return 'action-store-claim-id-mismatch';
  if (stored.status !== command.nextStatus) return 'action-store-claim-status-mismatch';
  if (stored.idempotencyKey !== command.idempotencyKey) return 'action-store-claim-idempotency-mismatch';
  if (stored.correlationId !== command.correlationId) return 'action-store-claim-correlation-mismatch';
  if (stored.subject !== command.subject) return 'action-store-claim-subject-mismatch';
  if (stored.persisted !== true) return 'action-store-claim-not-persisted';
  return null;
}

function createNexusEconomyPurchaseWorkerClaimSubmitter({ actionStore, env = process.env } = {}) {
  const commandBoundary = createNexusEconomyPurchaseWorkerClaimCommand({ env });

  return Object.freeze({
    async claim(action, suppliedTicket, suppliedClaimRequest) {
      const prepared = commandBoundary.prepare(action, suppliedTicket, suppliedClaimRequest);
      if (!prepared.ok || !prepared.commandReady || !prepared.command) {
        return reject(prepared.reason || 'purchase-worker-claim-command-not-ready', prepared.actionId || null);
      }

      const gateError = submissionGate(env);
      if (gateError) return reject(gateError, prepared.actionId);

      if (!actionStore || typeof actionStore.compareAndSetStatus !== 'function') {
        return reject('action-store-cas-unavailable', prepared.actionId);
      }

      const command = prepared.command;
      const request = Object.freeze({
        actionId: command.actionId,
        expectedStatus: command.expectedStatus,
        nextStatus: command.nextStatus,
        idempotencyKey: command.idempotencyKey,
        correlationId: command.correlationId,
        subject: command.subject,
        claimId: command.claimId,
        claimDigest: command.claimDigest
      });

      let stored;
      try {
        stored = await actionStore.compareAndSetStatus(request);
      } catch (error) {
        return reject(
          'action-store-cas-failed',
          command.actionId,
          error && error.code ? String(error.code) : null
        );
      }

      const validationError = validateClaimedAction(stored, command);
      if (validationError) return reject(validationError, command.actionId);

      return Object.freeze({
        ok: true,
        claimed: true,
        persisted: true,
        executionPermitted: false,
        reason: 'purchase-worker-action-claimed',
        actionId: stored.actionId,
        action: Object.freeze({
          actionId: stored.actionId,
          status: stored.status,
          idempotencyKey: stored.idempotencyKey,
          correlationId: stored.correlationId,
          subject: stored.subject,
          persisted: true
        }),
        errorCode: null
      });
    }
  });
}

module.exports = {
  createNexusEconomyPurchaseWorkerClaimSubmitter,
  submissionGate,
  validateClaimedAction
};
