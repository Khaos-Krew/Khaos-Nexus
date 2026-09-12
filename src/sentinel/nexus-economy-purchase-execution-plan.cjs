'use strict';

const { createHash } = require('node:crypto');
const { createNexusEconomyPurchaseAuthorization } = require('./nexus-economy-purchase-authorization.cjs');

const PURCHASE_EXECUTION_PLAN_VERSION = 2;
const CLUSTER_SHOP_FULFILLMENT = 'rewards-ascended-item';

function canonicalPlanPayload(authorization) {
  return Object.freeze({
    version: PURCHASE_EXECUTION_PLAN_VERSION,
    orderId: authorization.orderId,
    requestId: authorization.requestId,
    discordUserId: authorization.discordUserId,
    itemId: authorization.itemId,
    quantity: authorization.quantity,
    currency: authorization.currency,
    unitPrice: authorization.unitPrice,
    totalPrice: authorization.currentTotalPrice,
    projectedBalance: authorization.projectedBalance,
    fulfillment: CLUSTER_SHOP_FULFILLMENT
  });
}

function digestPayload(payload) {
  const canonical = JSON.stringify([
    payload.version,
    payload.orderId,
    payload.requestId,
    payload.discordUserId,
    payload.itemId,
    payload.quantity,
    payload.currency,
    payload.unitPrice,
    payload.totalPrice,
    payload.projectedBalance,
    payload.fulfillment
  ]);

  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function reject(reason, authorization = {}) {
  return Object.freeze({
    ok: false,
    planReady: false,
    executionPermitted: false,
    reason,
    mode: authorization.mode || 'off',
    requestId: authorization.requestId || null,
    orderId: authorization.orderId || null,
    discordUserId: authorization.discordUserId || null,
    itemId: authorization.itemId || null,
    quantity: authorization.quantity ?? null,
    currency: authorization.currency || 'Nexus Points',
    totalPrice: authorization.currentTotalPrice ?? null,
    balance: authorization.balance ?? null,
    projectedBalance: authorization.projectedBalance ?? null,
    planId: null,
    planDigest: null
  });
}

function createNexusEconomyPurchaseExecutionPlan(options = {}) {
  const authorization = createNexusEconomyPurchaseAuthorization(options);

  return Object.freeze({
    async prepare(discordUserId, itemId, {
      quantity = 1,
      requestId,
      expectedTotalPrice
    } = {}) {
      const authorized = await authorization.authorize(discordUserId, itemId, {
        quantity,
        requestId,
        expectedTotalPrice
      });

      if (!authorized.ok || !authorized.authorizationReady) {
        return reject(authorized.reason, authorized);
      }

      const payload = canonicalPlanPayload(authorized);
      const planDigest = digestPayload(payload);

      return Object.freeze({
        ok: true,
        planReady: true,
        executionPermitted: false,
        reason: 'purchase-execution-plan-ready',
        mode: authorized.mode,
        requestId: authorized.requestId,
        orderId: authorized.orderId,
        discordUserId: authorized.discordUserId,
        itemId: authorized.itemId,
        displayName: authorized.displayName,
        quantity: authorized.quantity,
        currency: authorized.currency,
        unitPrice: authorized.unitPrice,
        totalPrice: authorized.currentTotalPrice,
        balance: authorized.balance,
        projectedBalance: authorized.projectedBalance,
        fulfillment: CLUSTER_SHOP_FULFILLMENT,
        planVersion: PURCHASE_EXECUTION_PLAN_VERSION,
        planId: `purchase_${planDigest.slice(0, 24)}`,
        planDigest,
        operations: Object.freeze([
          Object.freeze({
            type: 'wallet-debit',
            amount: authorized.currentTotalPrice,
            idempotencyKey: authorized.orderId
          }),
          Object.freeze({
            type: 'rewards-ascended-item-fulfillment',
            fulfillment: CLUSTER_SHOP_FULFILLMENT,
            itemId: authorized.itemId,
            quantity: authorized.quantity,
            idempotencyKey: authorized.orderId
          })
        ])
      });
    }
  });
}

module.exports = {
  PURCHASE_EXECUTION_PLAN_VERSION,
  CLUSTER_SHOP_FULFILLMENT,
  canonicalPlanPayload,
  digestPayload,
  createNexusEconomyPurchaseExecutionPlan
};
