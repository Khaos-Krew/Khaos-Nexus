'use strict';

const { createNexusEconomyPurchaseWorkerIntake } = require('./nexus-economy-purchase-worker-intake.cjs');
const { CLUSTER_SHOP_FULFILLMENT } = require('./nexus-economy-purchase-action-request.cjs');

function enabled(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function reject(reason, action = {}) {
  return Object.freeze({
    ok: false,
    claimed: false,
    persisted: false,
    executionPermitted: false,
    reason,
    actionId: action && typeof action.actionId === 'string' ? action.actionId : null,
    claim: null
  });
}

function claimGate(env = {}) {
  if (String(env.NEXUS_ECONOMY_RUNTIME_MODE || '').trim().toLowerCase() !== 'active') return 'economy-runtime-not-active';
  if (!enabled(env.NEXUS_ECONOMY_RUNTIME_ENABLED)) return 'economy-runtime-disabled';
  if (String(env.NEXUS_ECONOMY_AUTHORITY || '').trim().toLowerCase() !== 'nexus') return 'economy-authority-not-nexus';
  if (!enabled(env.NEXUS_ECONOMY_PURCHASES_ENABLED)) return 'economy-purchases-disabled';
  if (!enabled(env.NEXUS_ECONOMY_WORKER_CLAIM_ENABLED)) return 'purchase-worker-claim-disabled';
  return null;
}

function validateClaim(claim, action) {
  if (!claim || typeof claim !== 'object') return 'invalid-action-store-claim';
  if (claim.claimed !== true) return 'action-not-claimed';
  if (claim.persisted !== true) return 'action-claim-not-durable';
  if (claim.status !== 'running') return 'action-claim-status-mismatch';
  if (claim.actionId !== action.actionId) return 'action-claim-id-mismatch';
  if (claim.attempt !== 1) return 'action-claim-attempt-mismatch';
  if (!claim.action || claim.action.status !== 'running') return 'claimed-action-status-mismatch';
  if (claim.action.idempotencyKey !== action.idempotencyKey) return 'claimed-action-idempotency-mismatch';
  if (claim.action.correlationId !== action.correlationId) return 'claimed-action-correlation-mismatch';
  if (!claim.action.request || !claim.action.request.payload || claim.action.request.payload.fulfillment !== CLUSTER_SHOP_FULFILLMENT) return 'claimed-action-fulfillment-mismatch';
  return null;
}

function createNexusEconomyPurchaseWorkerClaimer({ actionStore, env = process.env } = {}) {
  const intake = createNexusEconomyPurchaseWorkerIntake();
  return Object.freeze({
    async claim(action) {
      const prepared = intake.prepare(action);
      if (!prepared.ok) return reject(prepared.reason, action);
      const gateError = claimGate(env);
      if (gateError) return reject(gateError, action);
      if (!actionStore || typeof actionStore.claimRequested !== 'function') return reject('action-store-atomic-claim-unavailable', action);

      let claimed;
      try {
        claimed = await actionStore.claimRequested(action.actionId, 1);
      } catch (error) {
        return Object.freeze({ ...reject('action-store-claim-failed', action), errorCode: error && error.code ? String(error.code) : null });
      }

      const validationError = validateClaim(claimed, action);
      if (validationError) return reject(validationError, action);

      return Object.freeze({
        ok: true,
        claimed: true,
        persisted: true,
        executionPermitted: false,
        reason: 'purchase-worker-claim-persisted',
        actionId: action.actionId,
        claim: Object.freeze({
          actionId: action.actionId,
          attempt: 1,
          status: 'running',
          idempotencyKey: action.idempotencyKey,
          orderId: action.idempotencyKey,
          correlationId: action.correlationId,
          requestId: action.correlationId,
          fulfillment: CLUSTER_SHOP_FULFILLMENT,
          persisted: true,
          executionPermitted: false
        })
      });
    }
  });
}

module.exports = { createNexusEconomyPurchaseWorkerClaimer, claimGate, validateClaim };
