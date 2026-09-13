'use strict';

const { ACTION_SOURCE, CLUSTER_SHOP_FULFILLMENT } = require('./nexus-economy-purchase-action-request.cjs');

const ACTION_TYPE = 'nexus.economy.purchase';
const ACTION_CAPABILITY = 'economy.purchase.execute';
const SAFE_ID = /^[A-Za-z0-9:_-]{1,128}$/;

function reject(reason, action = {}) {
  return Object.freeze({
    ok: false,
    intakeReady: false,
    claimPermitted: false,
    executionPermitted: false,
    reason,
    actionId: action && typeof action.actionId === 'string' ? action.actionId : null,
    claimPlan: null
  });
}

function validatePurchaseAction(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return 'invalid-action';
  if (action.persisted !== true) return 'action-not-durable';
  if (action.status !== 'requested') return 'action-not-requested';
  if (action.capability !== ACTION_CAPABILITY) return 'unexpected-action-capability';
  if (action.source !== ACTION_SOURCE) return 'unexpected-action-source';
  if (action.destructive !== false) return 'unsafe-action-destructive-flag';
  if (typeof action.actionId !== 'string' || !SAFE_ID.test(action.actionId)) return 'invalid-action-id';
  if (typeof action.subject !== 'string' || !SAFE_ID.test(action.subject)) return 'invalid-action-subject';
  if (action.actor !== action.subject) return 'action-actor-subject-mismatch';
  if (typeof action.idempotencyKey !== 'string' || !SAFE_ID.test(action.idempotencyKey)) return 'invalid-idempotency-key';
  if (typeof action.correlationId !== 'string' || !SAFE_ID.test(action.correlationId)) return 'invalid-correlation-id';

  const request = action.request;
  if (!request || typeof request !== 'object' || Array.isArray(request)) return 'missing-action-request';
  if (request.schemaVersion !== 2) return 'unsupported-action-request-schema';
  if (request.type !== ACTION_TYPE) return 'unexpected-action-request-type';
  if (request.orderId !== action.idempotencyKey) return 'action-order-idempotency-mismatch';
  if (request.requestId !== action.correlationId) return 'action-request-correlation-mismatch';
  if (typeof request.recordId !== 'string' || !SAFE_ID.test(request.recordId)) return 'invalid-record-id';
  if (typeof request.planId !== 'string' || !SAFE_ID.test(request.planId)) return 'invalid-plan-id';

  const payload = request.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'missing-action-payload';
  if (payload.fulfillment !== CLUSTER_SHOP_FULFILLMENT) return 'invalid-cluster-shop-fulfillment';
  if (payload.planId !== request.planId) return 'action-plan-id-mismatch';
  return null;
}

function createNexusEconomyPurchaseWorkerIntake() {
  return Object.freeze({
    prepare(action) {
      const validationError = validatePurchaseAction(action);
      if (validationError) return reject(validationError, action);

      return Object.freeze({
        ok: true,
        intakeReady: true,
        claimPermitted: false,
        executionPermitted: false,
        reason: 'purchase-worker-intake-ready',
        actionId: action.actionId,
        claimPlan: Object.freeze({
          actionId: action.actionId,
          capability: action.capability,
          source: action.source,
          subject: action.subject,
          expectedStatus: 'requested',
          idempotencyKey: action.idempotencyKey,
          orderId: action.idempotencyKey,
          correlationId: action.correlationId,
          requestId: action.correlationId,
          recordId: action.request.recordId,
          planId: action.request.planId,
          fulfillment: CLUSTER_SHOP_FULFILLMENT,
          claimPermitted: false,
          executionPermitted: false
        })
      });
    }
  });
}

module.exports = { createNexusEconomyPurchaseWorkerIntake, validatePurchaseAction };
