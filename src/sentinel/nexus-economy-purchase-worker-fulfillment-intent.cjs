'use strict';

const { CLUSTER_SHOP_FULFILLMENT } = require('./nexus-economy-purchase-action-request.cjs');
const { validateClaimedPurchase } = require('./nexus-economy-purchase-worker-debit-intent.cjs');

const SAFE_ID = /^[A-Za-z0-9:_-]{1,128}$/;
const SAFE_ITEM_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SAFE_EOS_ID = /^[A-Za-z0-9_-]{16,128}$/;

function reject(reason, action = {}) {
  return Object.freeze({
    ok: false,
    fulfillmentIntentReady: false,
    fulfillmentPermitted: false,
    executionPermitted: false,
    reason,
    actionId: typeof action?.actionId === 'string' ? action.actionId : null,
    fulfillmentIntent: null
  });
}

function validateDebitProof(action, debitResult) {
  if (!debitResult || typeof debitResult !== 'object' || Array.isArray(debitResult)) return 'invalid-wallet-debit-proof';
  if (debitResult.ok !== true || debitResult.debited !== true || debitResult.persisted !== true) return 'wallet-debit-not-persisted';
  if (debitResult.executionPermitted !== false) return 'unsafe-wallet-debit-execution-flag';
  if (debitResult.actionId !== action.actionId) return 'wallet-debit-action-id-mismatch';
  if (!debitResult.debit || typeof debitResult.debit !== 'object' || Array.isArray(debitResult.debit)) return 'missing-wallet-debit-proof';

  const debit = debitResult.debit;
  const payload = action.request.payload;
  if (debit.executionPermitted !== false) return 'unsafe-wallet-debit-proof-execution-flag';
  if (debit.persisted !== true) return 'wallet-debit-proof-not-durable';
  if (debit.operation !== 'wallet-spend') return 'wallet-debit-operation-mismatch';
  if (debit.discordUserId !== payload.discordUserId) return 'wallet-debit-user-mismatch';
  if (debit.amount !== payload.totalPrice || debit.currency !== payload.currency) return 'wallet-debit-amount-mismatch';
  if (debit.orderId !== action.idempotencyKey || debit.idempotencyKey !== action.idempotencyKey) return 'wallet-debit-idempotency-mismatch';
  if (debit.correlationId !== action.correlationId || debit.requestId !== action.correlationId) return 'wallet-debit-correlation-mismatch';
  if (debit.balance !== payload.projectedBalance) return 'wallet-debit-balance-mismatch';
  if (debit.fulfillment !== CLUSTER_SHOP_FULFILLMENT) return 'wallet-debit-fulfillment-mismatch';
  return null;
}

function validatePresence(action, presence, nowMs, maxPresenceAgeMs) {
  if (!presence || typeof presence !== 'object' || Array.isArray(presence)) return 'invalid-player-presence';
  if (presence.ok !== true || presence.verified !== true || presence.online !== true) return 'player-not-verified-online';
  if (presence.discordUserId !== action.request.payload.discordUserId) return 'player-presence-user-mismatch';
  if (typeof presence.serverId !== 'string' || !SAFE_ID.test(presence.serverId)) return 'invalid-player-server-id';
  if (typeof presence.eosProductUserId !== 'string' || !SAFE_EOS_ID.test(presence.eosProductUserId)) return 'invalid-eos-product-user-id';
  if (typeof presence.observedAt !== 'string') return 'invalid-player-presence-time';
  const observedMs = Date.parse(presence.observedAt);
  if (!Number.isFinite(observedMs)) return 'invalid-player-presence-time';
  const ageMs = nowMs - observedMs;
  if (ageMs < -30000 || ageMs > maxPresenceAgeMs) return 'stale-player-presence';
  return null;
}

function createNexusEconomyPurchaseWorkerFulfillmentIntent({ now = () => Date.now(), maxPresenceAgeMs = 120000 } = {}) {
  return Object.freeze({
    prepare(action, claimResult, debitResult, presence) {
      const claimError = validateClaimedPurchase(action, claimResult);
      if (claimError) return reject(claimError, action);

      const debitError = validateDebitProof(action, debitResult);
      if (debitError) return reject(debitError, action);

      const nowMs = Number(now());
      if (!Number.isFinite(nowMs)) return reject('invalid-clock', action);
      const presenceError = validatePresence(action, presence, nowMs, maxPresenceAgeMs);
      if (presenceError) return reject(presenceError, action);

      const payload = action.request.payload;
      const fulfillmentIntent = Object.freeze({
        operation: 'rewards-ascended-item-fulfillment',
        fulfillment: CLUSTER_SHOP_FULFILLMENT,
        actionId: action.actionId,
        orderId: action.idempotencyKey,
        idempotencyKey: action.idempotencyKey,
        correlationId: action.correlationId,
        requestId: action.correlationId,
        discordUserId: payload.discordUserId,
        eosProductUserId: presence.eosProductUserId,
        serverId: presence.serverId,
        itemId: payload.itemId,
        quantity: payload.quantity,
        debitTransactionId: debitResult.debit.transactionId ?? null,
        debitBalance: debitResult.debit.balance,
        presenceObservedAt: presence.observedAt,
        fulfillmentPermitted: false,
        executionPermitted: false
      });

      return Object.freeze({
        ok: true,
        fulfillmentIntentReady: true,
        fulfillmentPermitted: false,
        executionPermitted: false,
        reason: 'purchase-rewards-ascended-fulfillment-intent-ready',
        actionId: action.actionId,
        fulfillmentIntent
      });
    }
  });
}

module.exports = {
  createNexusEconomyPurchaseWorkerFulfillmentIntent,
  validateDebitProof,
  validatePresence
};
