'use strict';

const { createNexusEconomyPurchaseWorkerDebitIntent } = require('./nexus-economy-purchase-worker-debit-intent.cjs');
const { CLUSTER_SHOP_FULFILLMENT } = require('./nexus-economy-purchase-action-request.cjs');

function enabled(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function reject(reason, action = {}) {
  return Object.freeze({
    ok: false,
    debited: false,
    duplicate: false,
    persisted: false,
    executionPermitted: false,
    reason,
    actionId: typeof action?.actionId === 'string' ? action.actionId : null,
    debit: null
  });
}

function debitGate(env = {}) {
  if (String(env.NEXUS_ECONOMY_RUNTIME_MODE || '').trim().toLowerCase() !== 'active') return 'economy-runtime-not-active';
  if (!enabled(env.NEXUS_ECONOMY_RUNTIME_ENABLED)) return 'economy-runtime-disabled';
  if (String(env.NEXUS_ECONOMY_AUTHORITY || '').trim().toLowerCase() !== 'nexus') return 'economy-authority-not-nexus';
  if (!enabled(env.NEXUS_ECONOMY_PURCHASES_ENABLED)) return 'economy-purchases-disabled';
  if (!enabled(env.NEXUS_ECONOMY_WORKER_CLAIM_ENABLED)) return 'purchase-worker-claim-disabled';
  if (!enabled(env.NEXUS_ECONOMY_WORKER_DEBIT_ENABLED)) return 'purchase-worker-debit-disabled';
  return null;
}

function validateDebitResult(result, debitIntent) {
  if (!result || typeof result !== 'object' || result.ok !== true) return result?.reason || 'wallet-spend-failed';
  if (result.duplicate !== true && result.duplicate !== false) return 'wallet-spend-duplicate-state-invalid';
  if (!Number.isSafeInteger(Number(result.balance)) || Number(result.balance) < 0) return 'wallet-spend-balance-invalid';
  if (Number(result.balance) !== debitIntent.expectedProjectedBalance) return 'wallet-spend-balance-mismatch';
  if (result.transactionId === undefined) return 'wallet-spend-transaction-id-missing';
  return null;
}

function createNexusEconomyPurchaseWorkerDebitExecutor({ mutationService, env = process.env } = {}) {
  const intentBuilder = createNexusEconomyPurchaseWorkerDebitIntent();

  return Object.freeze({
    async execute(action, claimResult) {
      const prepared = intentBuilder.prepare(action, claimResult);
      if (!prepared.ok || !prepared.debitIntentReady || !prepared.debitIntent) return reject(prepared.reason || 'wallet-debit-intent-not-ready', action);

      const gateError = debitGate(env);
      if (gateError) return reject(gateError, action);
      if (!mutationService || typeof mutationService.spend !== 'function') return reject('economy-mutation-service-unavailable', action);

      const debitIntent = prepared.debitIntent;
      let result;
      try {
        result = await mutationService.spend({
          discordUserId: debitIntent.discordUserId,
          amount: debitIntent.amount,
          orderId: debitIntent.orderId,
          source: 'cluster-shop',
          metadata: {
            actionId: debitIntent.actionId,
            requestId: debitIntent.requestId,
            correlationId: debitIntent.correlationId,
            fulfillment: CLUSTER_SHOP_FULFILLMENT
          }
        }, {
          actor: 'sentinel-v2:cluster-shop-purchase-worker',
          metadata: {
            actionId: debitIntent.actionId,
            requestId: debitIntent.requestId,
            orderId: debitIntent.orderId,
            fulfillment: CLUSTER_SHOP_FULFILLMENT
          }
        });
      } catch (error) {
        return Object.freeze({
          ...reject('wallet-spend-threw', action),
          errorCode: error?.code ? String(error.code) : null
        });
      }

      const validationError = validateDebitResult(result, debitIntent);
      if (validationError) return reject(validationError, action);

      return Object.freeze({
        ok: true,
        debited: true,
        duplicate: result.duplicate === true,
        persisted: true,
        executionPermitted: false,
        reason: result.duplicate === true ? 'purchase-wallet-debit-already-applied' : 'purchase-wallet-debit-persisted',
        actionId: action.actionId,
        debit: Object.freeze({
          operation: 'wallet-spend',
          discordUserId: debitIntent.discordUserId,
          amount: debitIntent.amount,
          currency: debitIntent.currency,
          orderId: debitIntent.orderId,
          idempotencyKey: debitIntent.idempotencyKey,
          correlationId: debitIntent.correlationId,
          requestId: debitIntent.requestId,
          transactionId: result.transactionId ?? null,
          balance: Number(result.balance),
          duplicate: result.duplicate === true,
          persisted: true,
          fulfillment: CLUSTER_SHOP_FULFILLMENT,
          executionPermitted: false
        })
      });
    }
  });
}

module.exports = {
  createNexusEconomyPurchaseWorkerDebitExecutor,
  debitGate,
  validateDebitResult
};
