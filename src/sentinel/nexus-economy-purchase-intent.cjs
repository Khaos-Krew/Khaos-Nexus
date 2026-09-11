'use strict';

const { createNexusEconomyPurchasePreflight } = require('./nexus-economy-purchase-preflight.cjs');

const SAFE_PURCHASE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;
const SAFE_DISCORD_USER_ID = /^[A-Za-z0-9_-]{1,128}$/;

function normalizeRequestId(value) {
  const requestId = typeof value === 'string' ? value.trim() : '';
  return SAFE_PURCHASE_REQUEST_ID.test(requestId) ? requestId : null;
}

function normalizeDiscordUserId(value) {
  const discordUserId = typeof value === 'string' ? value.trim() : String(value || '').trim();
  return SAFE_DISCORD_USER_ID.test(discordUserId) ? discordUserId : null;
}

function reject(reason, {
  requestId = null,
  discordUserId = null,
  itemId = null,
  quantity = null,
  totalPrice = null,
  balance = null,
  shortfall = null,
  mode = 'off'
} = {}) {
  return Object.freeze({
    ok: false,
    intentReady: false,
    executionPermitted: false,
    reason,
    mode,
    requestId,
    orderId: null,
    discordUserId,
    itemId,
    quantity,
    currency: 'Nexus Points',
    totalPrice,
    balance,
    shortfall
  });
}

function createNexusEconomyPurchaseIntent(options = {}) {
  const preflight = createNexusEconomyPurchasePreflight(options);

  return Object.freeze({
    async prepare(discordUserId, itemId, { quantity = 1, requestId } = {}) {
      const safeRequestId = normalizeRequestId(requestId);
      if (!safeRequestId) return reject('invalid-purchase-request-id');

      const safeDiscordUserId = normalizeDiscordUserId(discordUserId);
      if (!safeDiscordUserId) {
        return reject('invalid-discord-user-id', { requestId: safeRequestId });
      }

      const quote = await preflight.quote(safeDiscordUserId, itemId, { quantity });
      if (!quote.ok || !quote.available) {
        return reject(quote.reason, {
          requestId: safeRequestId,
          discordUserId: safeDiscordUserId,
          itemId: quote.itemId,
          quantity: quote.quantity,
          totalPrice: quote.totalPrice,
          balance: quote.balance,
          shortfall: quote.shortfall,
          mode: quote.mode
        });
      }

      if (!quote.affordable) {
        return reject('insufficient-balance', {
          requestId: safeRequestId,
          discordUserId: safeDiscordUserId,
          itemId: quote.itemId,
          quantity: quote.quantity,
          totalPrice: quote.totalPrice,
          balance: quote.balance,
          shortfall: quote.shortfall,
          mode: quote.mode
        });
      }

      const orderId = `shop_${safeRequestId}`;
      return Object.freeze({
        ok: true,
        intentReady: true,
        executionPermitted: false,
        reason: 'purchase-intent-ready',
        mode: quote.mode,
        requestId: safeRequestId,
        orderId,
        discordUserId: safeDiscordUserId,
        itemId: quote.itemId,
        displayName: quote.displayName,
        quantity: quote.quantity,
        currency: quote.currency,
        unitPrice: quote.unitPrice,
        totalPrice: quote.totalPrice,
        balance: quote.balance,
        projectedBalance: quote.balance - quote.totalPrice,
        shortfall: 0
      });
    }
  });
}

module.exports = {
  SAFE_PURCHASE_REQUEST_ID,
  createNexusEconomyPurchaseIntent,
  normalizeRequestId,
  normalizeDiscordUserId
};
