'use strict';

const { createNexusEconomyPurchaseIntent } = require('./nexus-economy-purchase-intent.cjs');

function safeExpectedTotalPrice(value) {
  const total = Number(value);
  if (!Number.isSafeInteger(total) || total < 1) return null;
  return total;
}

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
    confirmationReady: false,
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

function createNexusEconomyPurchaseConfirmation(options = {}) {
  const intent = createNexusEconomyPurchaseIntent(options);

  return Object.freeze({
    async confirm(discordUserId, itemId, {
      quantity = 1,
      requestId,
      expectedTotalPrice
    } = {}) {
      const safeExpectedTotal = safeExpectedTotalPrice(expectedTotalPrice);
      if (safeExpectedTotal === null) {
        return reject('invalid-expected-total-price');
      }

      const prepared = await intent.prepare(discordUserId, itemId, { quantity, requestId });
      if (!prepared.ok || !prepared.intentReady) {
        return reject(prepared.reason, {
          requestId: prepared.requestId,
          orderId: prepared.orderId,
          discordUserId: prepared.discordUserId,
          itemId: prepared.itemId,
          quantity: prepared.quantity,
          currency: prepared.currency,
          expectedTotalPrice: safeExpectedTotal,
          currentTotalPrice: prepared.totalPrice,
          balance: prepared.balance,
          projectedBalance: prepared.projectedBalance,
          mode: prepared.mode
        });
      }

      if (prepared.totalPrice !== safeExpectedTotal) {
        return reject('purchase-quote-changed', {
          requestId: prepared.requestId,
          orderId: prepared.orderId,
          discordUserId: prepared.discordUserId,
          itemId: prepared.itemId,
          quantity: prepared.quantity,
          currency: prepared.currency,
          expectedTotalPrice: safeExpectedTotal,
          currentTotalPrice: prepared.totalPrice,
          balance: prepared.balance,
          projectedBalance: prepared.projectedBalance,
          mode: prepared.mode
        });
      }

      return Object.freeze({
        ok: true,
        confirmationReady: true,
        executionPermitted: false,
        reason: 'purchase-confirmation-ready',
        mode: prepared.mode,
        requestId: prepared.requestId,
        orderId: prepared.orderId,
        discordUserId: prepared.discordUserId,
        itemId: prepared.itemId,
        displayName: prepared.displayName,
        quantity: prepared.quantity,
        currency: prepared.currency,
        unitPrice: prepared.unitPrice,
        expectedTotalPrice: safeExpectedTotal,
        currentTotalPrice: prepared.totalPrice,
        balance: prepared.balance,
        projectedBalance: prepared.projectedBalance
      });
    }
  });
}

module.exports = {
  createNexusEconomyPurchaseConfirmation,
  safeExpectedTotalPrice
};
