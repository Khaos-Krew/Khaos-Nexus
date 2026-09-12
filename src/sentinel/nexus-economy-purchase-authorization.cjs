'use strict';

const { envBool } = require('./economy-authority-policy.cjs');
const { inspectNexusEconomyRuntimeStatus } = require('./nexus-economy-runtime-status.cjs');
const { createNexusEconomyPurchaseConfirmation } = require('./nexus-economy-purchase-confirmation.cjs');

const ECONOMY_PURCHASES_ENABLED_ENV = 'NEXUS_ECONOMY_PURCHASES_ENABLED';

function reject(reason, {
  requestId = null,
  orderId = null,
  discordUserId = null,
  itemId = null,
  quantity = null,
  currency = 'Nexus Points',
  expectedTotalPrice = null,
  currentTotalPrice = null,
  balance = null,
  projectedBalance = null,
  mode = 'off'
} = {}) {
  return Object.freeze({
    ok: false,
    authorizationReady: false,
    executionPermitted: false,
    reason,
    mode,
    requestId,
    orderId,
    discordUserId,
    itemId,
    quantity,
    currency,
    expectedTotalPrice,
    currentTotalPrice,
    balance,
    projectedBalance
  });
}

function createNexusEconomyPurchaseAuthorization(options = {}) {
  const env = options.env || process.env;
  const confirmation = createNexusEconomyPurchaseConfirmation(options);

  return Object.freeze({
    async authorize(discordUserId, itemId, {
      quantity = 1,
      requestId,
      expectedTotalPrice
    } = {}) {
      let runtime;
      try {
        runtime = await inspectNexusEconomyRuntimeStatus({
          pool: options.pool,
          schema: options.schema,
          env
        });
      } catch (_error) {
        return reject('economy-runtime-unavailable');
      }

      if (runtime.mutationAllowed !== true) {
        return reject(runtime.reason || 'economy-mutations-disabled', {
          mode: runtime.mode
        });
      }

      // Purchase execution gets an additional kill switch beyond the global
      // economy activation gate. Both must be explicitly enabled before an
      // authorization can be produced.
      if (!envBool(env[ECONOMY_PURCHASES_ENABLED_ENV], false)) {
        return reject('shop-purchase-enable-flag-required', { mode: runtime.mode });
      }

      const confirmed = await confirmation.confirm(discordUserId, itemId, {
        quantity,
        requestId,
        expectedTotalPrice
      });

      if (!confirmed.ok || !confirmed.confirmationReady) {
        return reject(confirmed.reason, {
          requestId: confirmed.requestId,
          orderId: confirmed.orderId,
          discordUserId: confirmed.discordUserId,
          itemId: confirmed.itemId,
          quantity: confirmed.quantity,
          currency: confirmed.currency,
          expectedTotalPrice: confirmed.expectedTotalPrice,
          currentTotalPrice: confirmed.currentTotalPrice,
          balance: confirmed.balance,
          projectedBalance: confirmed.projectedBalance,
          mode: confirmed.mode
        });
      }

      return Object.freeze({
        ok: true,
        authorizationReady: true,
        executionPermitted: false,
        reason: 'purchase-authorization-ready',
        mode: confirmed.mode,
        requestId: confirmed.requestId,
        orderId: confirmed.orderId,
        discordUserId: confirmed.discordUserId,
        itemId: confirmed.itemId,
        displayName: confirmed.displayName,
        quantity: confirmed.quantity,
        currency: confirmed.currency,
        unitPrice: confirmed.unitPrice,
        expectedTotalPrice: confirmed.expectedTotalPrice,
        currentTotalPrice: confirmed.currentTotalPrice,
        balance: confirmed.balance,
        projectedBalance: confirmed.projectedBalance
      });
    }
  });
}

module.exports = {
  ECONOMY_PURCHASES_ENABLED_ENV,
  createNexusEconomyPurchaseAuthorization
};
