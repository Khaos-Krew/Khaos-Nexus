'use strict';

const { createNexusEconomyStorefrontReadService } = require('./nexus-economy-storefront-read-service.cjs');

const SAFE_ITEM_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_PURCHASE_QUANTITY = 25;

function safeQuantity(value = 1) {
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_PURCHASE_QUANTITY) return null;
  return quantity;
}

function reject(reason, { mode = 'off', balance = null, itemId = null, quantity = null } = {}) {
  return Object.freeze({
    ok: false,
    available: false,
    mode,
    reason,
    currency: 'Nexus Points',
    balance,
    itemId,
    quantity,
    unitPrice: null,
    totalPrice: null,
    affordable: false,
    shortfall: null,
    purchasePermitted: false
  });
}

function createNexusEconomyPurchasePreflight({
  pool,
  schema = 'public',
  env = process.env,
  now,
  catalogPath,
  readFile
} = {}) {
  const storefront = createNexusEconomyStorefrontReadService({ pool, schema, env, now, catalogPath, readFile });

  return Object.freeze({
    async quote(discordUserId, itemId, { quantity = 1 } = {}) {
      const normalizedItemId = typeof itemId === 'string' ? itemId.trim() : '';
      if (!SAFE_ITEM_ID.test(normalizedItemId)) {
        return reject('invalid-shop-item', { itemId: null, quantity: safeQuantity(quantity) });
      }

      const safePurchaseQuantity = safeQuantity(quantity);
      if (safePurchaseQuantity === null) {
        return reject('invalid-purchase-quantity', { itemId: normalizedItemId });
      }

      const view = await storefront.getStorefront(discordUserId);
      if (!view.available) {
        return reject(view.reason, {
          mode: view.mode,
          balance: view.balance,
          itemId: normalizedItemId,
          quantity: safePurchaseQuantity
        });
      }

      const item = view.items.find((candidate) => candidate.id === normalizedItemId);
      if (!item) {
        return reject('shop-item-not-found', {
          mode: view.mode,
          balance: view.balance,
          itemId: normalizedItemId,
          quantity: safePurchaseQuantity
        });
      }

      const totalPrice = item.price * safePurchaseQuantity;
      if (!Number.isSafeInteger(totalPrice)) {
        return reject('shop-price-overflow', {
          mode: view.mode,
          balance: view.balance,
          itemId: normalizedItemId,
          quantity: safePurchaseQuantity
        });
      }

      const affordable = view.balance >= totalPrice;
      return Object.freeze({
        ok: true,
        available: true,
        mode: view.mode,
        reason: affordable ? 'quote-ready' : 'insufficient-balance',
        currency: view.currency,
        balance: view.balance,
        itemId: item.id,
        displayName: item.displayName,
        quantity: safePurchaseQuantity,
        unitPrice: item.price,
        totalPrice,
        affordable,
        shortfall: affordable ? 0 : totalPrice - view.balance,
        purchasePermitted: false
      });
    }
  });
}

module.exports = {
  MAX_PURCHASE_QUANTITY,
  createNexusEconomyPurchasePreflight,
  safeQuantity
};
