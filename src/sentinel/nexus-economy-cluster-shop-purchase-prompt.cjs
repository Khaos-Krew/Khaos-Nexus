'use strict';

const SAFE_ITEM_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,122}$/;
const SAFE_DISCORD_USER_ID = /^[A-Za-z0-9_-]{1,128}$/;

function fail(reason) {
  const error = new Error(reason);
  error.code = reason;
  throw error;
}

function assertSafeInteger(value, reason, { min = 0 } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min) fail(reason);
  return number;
}

function assertPreparedClusterShopIntent(intent) {
  if (!intent || intent.ok !== true || intent.intentReady !== true) {
    fail('cluster-shop-purchase-intent-not-ready');
  }
  if (intent.executionPermitted !== false) {
    fail('cluster-shop-purchase-intent-execution-must-remain-disabled');
  }
  if (intent.currency !== 'Nexus Points') {
    fail('cluster-shop-purchase-intent-currency-mismatch');
  }

  const requestId = typeof intent.requestId === 'string' ? intent.requestId.trim() : '';
  if (!SAFE_REQUEST_ID.test(requestId)) fail('cluster-shop-purchase-request-id-invalid');
  if (intent.orderId !== `shop_${requestId}`) fail('cluster-shop-purchase-order-id-mismatch');

  const discordUserId = typeof intent.discordUserId === 'string' ? intent.discordUserId.trim() : '';
  if (!SAFE_DISCORD_USER_ID.test(discordUserId)) fail('cluster-shop-purchase-user-id-invalid');

  const itemId = typeof intent.itemId === 'string' ? intent.itemId.trim() : '';
  if (!SAFE_ITEM_ID.test(itemId)) fail('cluster-shop-purchase-item-id-invalid');

  const quantity = assertSafeInteger(intent.quantity, 'cluster-shop-purchase-quantity-invalid', { min: 1 });
  const unitPrice = assertSafeInteger(intent.unitPrice, 'cluster-shop-purchase-unit-price-invalid', { min: 1 });
  const totalPrice = assertSafeInteger(intent.totalPrice, 'cluster-shop-purchase-total-price-invalid', { min: 1 });
  const balance = assertSafeInteger(intent.balance, 'cluster-shop-purchase-balance-invalid');
  const projectedBalance = assertSafeInteger(intent.projectedBalance, 'cluster-shop-purchase-projected-balance-invalid');

  if (!Number.isSafeInteger(unitPrice * quantity) || unitPrice * quantity !== totalPrice) {
    fail('cluster-shop-purchase-total-price-mismatch');
  }
  if (balance < totalPrice || balance - totalPrice !== projectedBalance) {
    fail('cluster-shop-purchase-projected-balance-mismatch');
  }

  return Object.freeze({
    requestId,
    orderId: intent.orderId,
    discordUserId,
    itemId,
    displayName: String(intent.displayName || itemId).trim().slice(0, 100),
    quantity,
    unitPrice,
    totalPrice,
    balance,
    projectedBalance
  });
}

function buildNexusClusterShopPurchasePrompt(intent) {
  const safe = assertPreparedClusterShopIntent(intent);

  return Object.freeze({
    ok: true,
    channel: '#cluster-shop',
    ephemeral: true,
    interactionMode: 'purchase-review-only',
    reason: 'cluster-shop-purchase-review-ready',
    requestId: safe.requestId,
    orderId: safe.orderId,
    discordUserId: safe.discordUserId,
    itemId: safe.itemId,
    currency: 'Nexus Points',
    quantity: safe.quantity,
    unitPrice: safe.unitPrice,
    totalPrice: safe.totalPrice,
    balance: safe.balance,
    projectedBalance: safe.projectedBalance,
    purchasePermitted: false,
    walletDebitPermitted: false,
    fulfillmentPermitted: false,
    executionPermitted: false,
    sellbackPermitted: false,
    dinoCacheFlowIncluded: false,
    content: Object.freeze({
      title: 'Review Cluster Shop purchase',
      description: `${safe.quantity} × ${safe.displayName}`,
      priceText: `${safe.totalPrice.toLocaleString('en-US')} Nexus Points`,
      balanceAfterText: `${safe.projectedBalance.toLocaleString('en-US')} Nexus Points after purchase`,
      notice: 'Confirmation remains disabled until the guarded purchase submission path is explicitly connected.'
    }),
    components: Object.freeze([
      Object.freeze({
        type: 'button',
        style: 'success',
        customId: 'nexus:cluster-shop:confirm',
        label: 'Confirm Purchase',
        disabled: true
      }),
      Object.freeze({
        type: 'button',
        style: 'secondary',
        customId: 'nexus:cluster-shop:cancel',
        label: 'Cancel',
        disabled: false
      })
    ])
  });
}

module.exports = {
  assertPreparedClusterShopIntent,
  buildNexusClusterShopPurchasePrompt
};
