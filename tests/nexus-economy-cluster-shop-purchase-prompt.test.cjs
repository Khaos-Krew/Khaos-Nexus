'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildNexusClusterShopPurchasePrompt
} = require('../src/sentinel/nexus-economy-cluster-shop-purchase-prompt.cjs');

function preparedIntent(overrides = {}) {
  return {
    ok: true,
    intentReady: true,
    executionPermitted: false,
    reason: 'purchase-intent-ready',
    mode: 'shadow',
    requestId: 'req_12345678',
    orderId: 'shop_req_12345678',
    discordUserId: '123456789012345678',
    itemId: 'metal-ingots',
    displayName: 'Metal Ingots',
    quantity: 2,
    currency: 'Nexus Points',
    unitPrice: 250,
    totalPrice: 500,
    balance: 900,
    projectedBalance: 400,
    shortfall: 0,
    ...overrides
  };
}

test('projects a prepared purchase intent into an ephemeral review with all mutations disabled', () => {
  const result = buildNexusClusterShopPurchasePrompt(preparedIntent());

  assert.equal(result.ok, true);
  assert.equal(result.channel, '#cluster-shop');
  assert.equal(result.ephemeral, true);
  assert.equal(result.interactionMode, 'purchase-review-only');
  assert.equal(result.purchasePermitted, false);
  assert.equal(result.walletDebitPermitted, false);
  assert.equal(result.fulfillmentPermitted, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.sellbackPermitted, false);
  assert.equal(result.dinoCacheFlowIncluded, false);
  assert.equal(result.totalPrice, 500);
  assert.equal(result.projectedBalance, 400);

  const [confirm, cancel] = result.components;
  assert.equal(confirm.customId, 'nexus:cluster-shop:confirm');
  assert.equal(confirm.disabled, true);
  assert.equal(cancel.customId, 'nexus:cluster-shop:cancel');
  assert.equal(cancel.disabled, false);
});

test('fails closed if an upstream intent arrives with execution already permitted', () => {
  assert.throws(() => buildNexusClusterShopPurchasePrompt(preparedIntent({
    executionPermitted: true
  })), /cluster-shop-purchase-intent-execution-must-remain-disabled/);
});

test('requires order id to remain derived from the immutable request id', () => {
  assert.throws(() => buildNexusClusterShopPurchasePrompt(preparedIntent({
    orderId: 'shop_different_request'
  })), /cluster-shop-purchase-order-id-mismatch/);
});

test('recomputes total and projected balance to detect tampering', () => {
  assert.throws(() => buildNexusClusterShopPurchasePrompt(preparedIntent({
    totalPrice: 499
  })), /cluster-shop-purchase-total-price-mismatch/);

  assert.throws(() => buildNexusClusterShopPurchasePrompt(preparedIntent({
    projectedBalance: 401
  })), /cluster-shop-purchase-projected-balance-mismatch/);
});

test('rejects invalid currency, identity, item and quantity', () => {
  assert.throws(() => buildNexusClusterShopPurchasePrompt(preparedIntent({
    currency: 'Dino Cache Tokens'
  })), /cluster-shop-purchase-intent-currency-mismatch/);

  assert.throws(() => buildNexusClusterShopPurchasePrompt(preparedIntent({
    discordUserId: 'bad user id'
  })), /cluster-shop-purchase-user-id-invalid/);

  assert.throws(() => buildNexusClusterShopPurchasePrompt(preparedIntent({
    itemId: 'PrimalItem/Unsafe'
  })), /cluster-shop-purchase-item-id-invalid/);

  assert.throws(() => buildNexusClusterShopPurchasePrompt(preparedIntent({
    quantity: 0
  })), /cluster-shop-purchase-quantity-invalid/);
});

test('does not expose RewardsAscended transport or fulfillment internals', () => {
  const serialized = JSON.stringify(buildNexusClusterShopPurchasePrompt(preparedIntent()));

  assert.equal(serialized.includes('blueprint'), false);
  assert.equal(serialized.includes('PrimalItem'), false);
  assert.equal(serialized.includes('RA.Reward'), false);
  assert.equal(serialized.includes('RCON'), false);
  assert.equal(serialized.includes('SFTP'), false);
});
