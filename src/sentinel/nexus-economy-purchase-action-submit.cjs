'use strict';

const { createNexusEconomyPurchaseActionRequest } = require('./nexus-economy-purchase-action-request.cjs');

function enabled(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function reject(reason, record = {}) {
  return Object.freeze({
    ok: false,
    submitted: false,
    persisted: false,
    executionPermitted: false,
    reason,
    actionId: record && typeof record.actionId === 'string' ? record.actionId : null,
    recordId: record && typeof record.recordId === 'string' ? record.recordId : null,
    action: null
  });
}

function submissionGate(env = {}) {
  if (String(env.NEXUS_ECONOMY_RUNTIME_MODE || '').trim().toLowerCase() !== 'active') return 'economy-runtime-not-active';
  if (!enabled(env.NEXUS_ECONOMY_RUNTIME_ENABLED)) return 'economy-runtime-disabled';
  if (String(env.NEXUS_ECONOMY_AUTHORITY || '').trim().toLowerCase() !== 'nexus') return 'economy-authority-not-nexus';
  if (!enabled(env.NEXUS_ECONOMY_PURCHASES_ENABLED)) return 'economy-purchases-disabled';
  if (!enabled(env.NEXUS_ECONOMY_ACTION_SUBMISSION_ENABLED)) return 'purchase-action-submission-disabled';
  return null;
}

function validateStoredAction(stored, request) {
  if (!stored || typeof stored !== 'object') return 'invalid-action-store-result';
  if (stored.actionId !== request.actionId) return 'action-store-id-mismatch';
  if (stored.capability !== request.capability) return 'action-store-capability-mismatch';
  if (stored.idempotencyKey !== request.idempotencyKey) return 'action-store-idempotency-mismatch';
  if (stored.correlationId !== request.correlationId) return 'action-store-correlation-mismatch';
  if (stored.destructive !== false) return 'action-store-destructive-mismatch';
  if (stored.status !== 'requested') return 'action-store-status-mismatch';
  return null;
}

function createNexusEconomyPurchaseActionSubmitter({ actionStore, env = process.env } = {}) {
  const projector = createNexusEconomyPurchaseActionRequest();

  return Object.freeze({
    async submit(record) {
      const projected = projector.prepare(record);
      if (!projected.ok) return reject(projected.reason, record);

      const gateError = submissionGate(env);
      if (gateError) return reject(gateError, record);

      if (!actionStore || typeof actionStore.request !== 'function') {
        return reject('action-store-unavailable', record);
      }

      const request = projected.actionRequest;
      let stored;
      try {
        stored = await actionStore.request(request);
      } catch (error) {
        return Object.freeze({
          ok: false,
          submitted: false,
          persisted: false,
          executionPermitted: false,
          reason: 'action-store-request-failed',
          actionId: record.actionId,
          recordId: record.recordId,
          action: null,
          errorCode: error && error.code ? String(error.code) : null
        });
      }

      const validationError = validateStoredAction(stored, request);
      if (validationError) return reject(validationError, record);

      return Object.freeze({
        ok: true,
        submitted: true,
        persisted: stored.persisted === true,
        executionPermitted: false,
        reason: stored.persisted === true ? 'purchase-action-persisted' : 'purchase-action-submitted-without-persistence',
        actionId: stored.actionId,
        recordId: record.recordId,
        action: Object.freeze({
          actionId: stored.actionId,
          capability: stored.capability,
          source: stored.source,
          actor: stored.actor,
          subject: stored.subject,
          destructive: stored.destructive,
          status: stored.status,
          idempotencyKey: stored.idempotencyKey,
          correlationId: stored.correlationId,
          persisted: stored.persisted === true
        })
      });
    }
  });
}

module.exports = {
  createNexusEconomyPurchaseActionSubmitter,
  submissionGate,
  validateStoredAction
};
