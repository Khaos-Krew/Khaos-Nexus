'use strict';

const { CLUSTER_SHOP_FULFILLMENT } = require('./nexus-economy-purchase-action-request.cjs');

const DISCORD_ID = /^\d{5,32}$/;
const SAFE_ID = /^[A-Za-z0-9:_-]{1,128}$/;

function reject(reason, action = {}) {
  return Object.freeze({
    ok: false,
    debitIntentReady: false,
    debitPermitted: false,
    executionPermitted: false,
    reason,
    actionId: typeof action?.actionId === 'string' ? action.actionId : null,
    debitIntent: null
  });
}

function validateClaimedPurchase(action, claimResult) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return 'invalid-action';
  if (!claimResult || typeof claimResult !== 'object' || Array.isArray(claimResult)) return 'invalid-claim-result';
  if (claimResult.ok !== true || claimResult.claimed !== true || claimResult.persisted !== true) return 'purchase-not-durably-claimed';
  if (claimResult.executionPermitted !== false) return 'unsafe-claim-execution-flag';
  if (!claimResult.claim || typeof claimResult.claim !== 'object') return 'missing-claim-proof';
  if (claimResult.claim.executionPermitted !== false) return 'unsafe-claim-proof-execution-flag';

  if (action.status !== 'running') return 'action-not-running';
  if (action.persisted !== true) return 'action-not-durable';
  if (claimResult.actionId !== action.actionId || claimResult.claim.actionId !== action.actionId) return 'action-id-mismatch';
  if (claimResult.claim.attempt !== 1 || claimResult.claim.status !== 'running') return 'claim-state-mismatch';
  if (claimResult.claim.idempotencyKey !== action.idempotencyKey || claimResult.claim.orderId !== action.idempotencyKey) return 'claim-idempotency-mismatch';
  if (claimResult.claim.correlationId !== action.correlationId || claimResult.claim.requestId !== action.correlationId) return 'claim-correlation-mismatch';
  if (claimResult.claim.fulfillment !== CLUSTER_SHOP_FULFILLMENT) return 'claim-fulfillment-mismatch';

  if (typeof action.actionId !== 'string' || !SAFE_ID.test(action.actionId)) return 'invalid-action-id';
  if (typeof action.idempotencyKey !== 'string' || !SAFE_ID.test(action.idempotencyKey)) return 'invalid-order-id';
  if (typeof action.correlationId !== 'string' || !SAFE_ID.test(action.correlationId)) return 'invalid-request-id';
  if (!action.request || typeof action.request !== 'object' || Array.isArray(action.request)) return 'invalid-action-request';
  if (action.request.orderId !== action.idempotencyKey) return 'request-order-id-mismatch';
  if (action.request.requestId !== action.correlationId) return 'request-correlation-id-mismatch';

  const payload = action.request.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'invalid-purchase-payload';
  if (payload.fulfillment !== CLUSTER_SHOP_FULFILLMENT) return 'invalid-cluster-shop-fulfillment';
  if (typeof payload.discordUserId !== 'string' || !DISCORD_ID.test(payload.discordUserId)) return 'invalid-discord-user-id';
  if (action.subject !== `discord-user:${payload.discordUserId}`) return 'purchase-subject-mismatch';
  if (payload.currency !== 'Nexus Points') return 'invalid-wallet-currency';
  if (!Number.isSafeInteger(payload.totalPrice) || payload.totalPrice < 1) return 'invalid-total-price';
  if (!Number.isSafeInteger(payload.projectedBalance) || payload.projectedBalance < 0) return 'invalid-projected-balance';
  return null;
}

function createNexusEconomyPurchaseWorkerDebitIntent() {
  return Object.freeze({
    prepare(action, claimResult) {
      const validationError = validateClaimedPurchase(action, claimResult);
      if (validationError) return reject(validationError, action);

      const payload = action.request.payload;
      const debitIntent = Object.freeze({
        operation: 'wallet-spend',
        discordUserId: payload.discordUserId,
        amount: payload.totalPrice,
        currency: payload.currency,
        orderId: action.idempotencyKey,
        idempotencyKey: action.idempotencyKey,
        correlationId: action.correlationId,
        requestId: action.correlationId,
        actionId: action.actionId,
        expectedProjectedBalance: payload.projectedBalance,
        debitPermitted: false,
        executionPermitted: false
      });

      return Object.freeze({
        ok: true,
        debitIntentReady: true,
        debitPermitted: false,
        executionPermitted: false,
        reason: 'purchase-wallet-debit-intent-ready',
        actionId: action.actionId,
        debitIntent
      });
    }
  });
}

module.exports = { createNexusEconomyPurchaseWorkerDebitIntent, validateClaimedPurchase };
