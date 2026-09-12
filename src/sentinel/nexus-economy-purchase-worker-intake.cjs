'use strict';

const crypto = require('node:crypto');
const { ACTION_SOURCE } = require('./nexus-economy-purchase-action-request.cjs');

const ACTION_CAPABILITY = 'economy.purchase.execute';
const ACTION_TYPE = 'nexus.economy.purchase';
const SAFE_ID = /^[A-Za-z0-9:_-]{1,128}$/;
const HEX_64 = /^[a-f0-9]{64}$/;

function reject(reason, action = {}) {
  return Object.freeze({
    ok: false,
    intakeReady: false,
    claimPermitted: false,
    executionPermitted: false,
    reason,
    actionId: action && typeof action.actionId === 'string' ? action.actionId : null,
    ticket: null
  });
}

function canonicalTicketPayload(action) {
  return {
    schemaVersion: 1,
    actionId: action.actionId,
    capability: action.capability,
    source: action.source,
    actor: action.actor,
    subject: action.subject,
    idempotencyKey: action.idempotencyKey,
    correlationId: action.correlationId,
    recordId: action.request.recordId,
    recordDigest: action.request.recordDigest,
    requestId: action.request.requestId,
    orderId: action.request.orderId,
    planId: action.request.planId,
    payload: {
      planId: action.request.payload.planId,
      planDigest: action.request.payload.planDigest,
      discordUserId: action.request.payload.discordUserId,
      itemId: action.request.payload.itemId,
      quantity: action.request.payload.quantity,
      currency: action.request.payload.currency,
      totalPrice: action.request.payload.totalPrice,
      projectedBalance: action.request.payload.projectedBalance
    }
  };
}

function digestCanonical(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function validatePersistedPurchaseAction(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return 'invalid-action';
  if (action.persisted !== true) return 'action-not-persisted';
  if (action.status !== 'requested') return 'action-not-requested';
  if (action.capability !== ACTION_CAPABILITY) return 'unexpected-action-capability';
  if (action.source !== ACTION_SOURCE) return 'unexpected-action-source';
  if (action.destructive !== false) return 'unsafe-action-destructive-flag';

  for (const key of ['actionId', 'actor', 'subject', 'idempotencyKey', 'correlationId']) {
    if (typeof action[key] !== 'string' || !SAFE_ID.test(action[key])) return `invalid-${key}`;
  }
  if (action.actor !== action.subject) return 'actor-subject-mismatch';

  const request = action.request;
  if (!request || typeof request !== 'object' || Array.isArray(request)) return 'invalid-action-request';
  if (request.schemaVersion !== 1 || request.type !== ACTION_TYPE) return 'unsupported-action-request';
  for (const key of ['recordId', 'requestId', 'orderId', 'planId']) {
    if (typeof request[key] !== 'string' || !SAFE_ID.test(request[key])) return `invalid-request-${key}`;
  }
  if (typeof request.recordDigest !== 'string' || !HEX_64.test(request.recordDigest)) return 'invalid-record-digest';
  if (request.requestId !== action.correlationId) return 'correlation-id-mismatch';
  if (request.orderId !== action.idempotencyKey) return 'idempotency-key-mismatch';

  const payload = request.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'invalid-action-payload';
  if (payload.planId !== request.planId) return 'plan-id-mismatch';
  if (typeof payload.planDigest !== 'string' || !HEX_64.test(payload.planDigest)) return 'invalid-plan-digest';
  if (action.actionId !== `action_${payload.planDigest.slice(0, 24)}`) return 'action-id-mismatch';
  if (typeof payload.discordUserId !== 'string' || !/^\d{5,32}$/.test(payload.discordUserId)) return 'invalid-discord-user-id';
  if (action.subject !== `discord-user:${payload.discordUserId}`) return 'subject-mismatch';
  if (typeof payload.itemId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(payload.itemId)) return 'invalid-item-id';
  if (!Number.isSafeInteger(payload.quantity) || payload.quantity < 1 || payload.quantity > 25) return 'invalid-quantity';
  if (payload.currency !== 'NEXUS_POINTS') return 'invalid-currency';
  if (!Number.isSafeInteger(payload.totalPrice) || payload.totalPrice < 0) return 'invalid-total-price';
  if (!Number.isSafeInteger(payload.projectedBalance) || payload.projectedBalance < 0) return 'invalid-projected-balance';

  return null;
}

function freezeTicket(action) {
  const canonical = canonicalTicketPayload(action);
  const intakeDigest = digestCanonical(canonical);
  return Object.freeze({
    schemaVersion: 1,
    ticketId: `worker_${intakeDigest.slice(0, 24)}`,
    intakeDigest,
    actionId: action.actionId,
    capability: action.capability,
    idempotencyKey: action.idempotencyKey,
    correlationId: action.correlationId,
    subject: action.subject,
    recordId: action.request.recordId,
    requestId: action.request.requestId,
    orderId: action.request.orderId,
    planId: action.request.planId,
    payload: Object.freeze({ ...action.request.payload }),
    claimPermitted: false,
    executionPermitted: false
  });
}

function createNexusEconomyPurchaseWorkerIntake() {
  return Object.freeze({
    prepare(action) {
      const validationError = validatePersistedPurchaseAction(action);
      if (validationError) return reject(validationError, action);

      return Object.freeze({
        ok: true,
        intakeReady: true,
        claimPermitted: false,
        executionPermitted: false,
        reason: 'purchase-worker-intake-ready',
        actionId: action.actionId,
        ticket: freezeTicket(action)
      });
    }
  });
}

module.exports = {
  createNexusEconomyPurchaseWorkerIntake,
  validatePersistedPurchaseAction
};
