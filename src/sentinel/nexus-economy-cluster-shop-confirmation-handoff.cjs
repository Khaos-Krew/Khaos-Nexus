'use strict';

const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,122}$/;
const SAFE_DISCORD_USER_ID = /^\d{5,32}$/;
const SAFE_ITEM_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const CONFIRM_CUSTOM_ID = 'nexus:cluster-shop:confirm';

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

function assertReviewPrompt(prompt) {
  if (!prompt || prompt.ok !== true || prompt.interactionMode !== 'purchase-review-only') {
    fail('cluster-shop-review-prompt-not-ready');
  }
  if (prompt.channel !== '#cluster-shop' || prompt.ephemeral !== true) {
    fail('cluster-shop-review-prompt-surface-mismatch');
  }
  if (
    prompt.purchasePermitted !== false ||
    prompt.walletDebitPermitted !== false ||
    prompt.fulfillmentPermitted !== false ||
    prompt.executionPermitted !== false ||
    prompt.sellbackPermitted !== false ||
    prompt.dinoCacheFlowIncluded !== false
  ) {
    fail('cluster-shop-review-prompt-unsafe-flags');
  }

  const requestId = typeof prompt.requestId === 'string' ? prompt.requestId.trim() : '';
  if (!SAFE_REQUEST_ID.test(requestId)) fail('cluster-shop-review-request-id-invalid');
  if (prompt.orderId !== `shop_${requestId}`) fail('cluster-shop-review-order-id-mismatch');

  const discordUserId = typeof prompt.discordUserId === 'string' ? prompt.discordUserId.trim() : '';
  if (!SAFE_DISCORD_USER_ID.test(discordUserId)) fail('cluster-shop-review-user-id-invalid');

  const itemId = typeof prompt.itemId === 'string' ? prompt.itemId.trim() : '';
  if (!SAFE_ITEM_ID.test(itemId)) fail('cluster-shop-review-item-id-invalid');
  if (prompt.currency !== 'Nexus Points') fail('cluster-shop-review-currency-mismatch');

  const quantity = assertSafeInteger(prompt.quantity, 'cluster-shop-review-quantity-invalid', { min: 1 });
  const unitPrice = assertSafeInteger(prompt.unitPrice, 'cluster-shop-review-unit-price-invalid', { min: 1 });
  const totalPrice = assertSafeInteger(prompt.totalPrice, 'cluster-shop-review-total-price-invalid', { min: 1 });
  const balance = assertSafeInteger(prompt.balance, 'cluster-shop-review-balance-invalid');
  const projectedBalance = assertSafeInteger(prompt.projectedBalance, 'cluster-shop-review-projected-balance-invalid');

  if (!Number.isSafeInteger(unitPrice * quantity) || unitPrice * quantity !== totalPrice) {
    fail('cluster-shop-review-total-price-mismatch');
  }
  if (balance < totalPrice || balance - totalPrice !== projectedBalance) {
    fail('cluster-shop-review-projected-balance-mismatch');
  }

  const components = Array.isArray(prompt.components) ? prompt.components : [];
  const confirm = components.find((component) => component && component.customId === CONFIRM_CUSTOM_ID);
  if (!confirm || confirm.type !== 'button' || confirm.disabled !== true) {
    fail('cluster-shop-review-confirm-control-not-guarded');
  }

  return Object.freeze({
    requestId,
    orderId: prompt.orderId,
    discordUserId,
    itemId,
    quantity,
    unitPrice,
    totalPrice,
    balance,
    projectedBalance
  });
}

function createNexusClusterShopConfirmationHandoff({ confirmationService } = {}) {
  if (!confirmationService || typeof confirmationService.confirm !== 'function') {
    throw new TypeError('confirmationService.confirm is required');
  }

  return Object.freeze({
    async prepare(prompt, interaction = {}) {
      const safe = assertReviewPrompt(prompt);
      const customId = typeof interaction.customId === 'string' ? interaction.customId : '';
      if (customId !== CONFIRM_CUSTOM_ID) fail('cluster-shop-confirm-interaction-mismatch');

      const actorDiscordUserId = typeof interaction.discordUserId === 'string'
        ? interaction.discordUserId.trim()
        : '';
      if (!SAFE_DISCORD_USER_ID.test(actorDiscordUserId)) fail('cluster-shop-confirm-actor-invalid');
      if (actorDiscordUserId !== safe.discordUserId) fail('cluster-shop-confirm-actor-mismatch');

      const confirmed = await confirmationService.confirm(safe.discordUserId, safe.itemId, {
        quantity: safe.quantity,
        requestId: safe.requestId,
        expectedTotalPrice: safe.totalPrice
      });

      if (!confirmed || confirmed.ok !== true || confirmed.confirmationReady !== true) {
        return Object.freeze({
          ok: false,
          handoffReady: false,
          submitPermitted: false,
          walletDebitPermitted: false,
          fulfillmentPermitted: false,
          executionPermitted: false,
          reason: confirmed && confirmed.reason ? confirmed.reason : 'cluster-shop-confirmation-not-ready',
          requestId: safe.requestId,
          orderId: safe.orderId,
          discordUserId: safe.discordUserId,
          itemId: safe.itemId
        });
      }

      if (confirmed.executionPermitted !== false) fail('cluster-shop-confirmation-execution-must-remain-disabled');
      if (confirmed.requestId !== safe.requestId || confirmed.orderId !== safe.orderId) {
        fail('cluster-shop-confirmation-order-identity-mismatch');
      }
      if (confirmed.discordUserId !== safe.discordUserId || confirmed.itemId !== safe.itemId) {
        fail('cluster-shop-confirmation-subject-mismatch');
      }
      if (confirmed.quantity !== safe.quantity || confirmed.currency !== 'Nexus Points') {
        fail('cluster-shop-confirmation-quote-identity-mismatch');
      }
      if (confirmed.currentTotalPrice !== safe.totalPrice || confirmed.expectedTotalPrice !== safe.totalPrice) {
        fail('cluster-shop-confirmation-total-price-mismatch');
      }
      if (confirmed.balance !== safe.balance || confirmed.projectedBalance !== safe.projectedBalance) {
        fail('cluster-shop-confirmation-balance-mismatch');
      }

      return Object.freeze({
        ok: true,
        handoffReady: true,
        submitPermitted: false,
        walletDebitPermitted: false,
        fulfillmentPermitted: false,
        executionPermitted: false,
        sellbackPermitted: false,
        dinoCacheFlowIncluded: false,
        reason: 'cluster-shop-confirmation-handoff-ready',
        requestId: safe.requestId,
        orderId: safe.orderId,
        discordUserId: safe.discordUserId,
        itemId: safe.itemId,
        quantity: safe.quantity,
        currency: 'Nexus Points',
        totalPrice: safe.totalPrice,
        balance: safe.balance,
        projectedBalance: safe.projectedBalance
      });
    }
  });
}

module.exports = {
  CONFIRM_CUSTOM_ID,
  assertReviewPrompt,
  createNexusClusterShopConfirmationHandoff
};
