'use strict';

const { createNexusEconomyPurchasePlanVerifier } = require('./nexus-economy-purchase-plan-verifier.cjs');

const PURCHASE_ACTION_SCHEMA_VERSION = 2;
const PURCHASE_ACTION_TYPE = 'nexus.economy.purchase';
const PURCHASE_ACTION_CAPABILITY = 'economy.purchase.execute';
const CLUSTER_SHOP_FULFILLMENT = 'rewards-ascended-item';

function reject(reason, plan = {}) {
  return Object.freeze({
    ok: false,
    actionReady: false,
    queueWritePermitted: false,
    executionPermitted: false,
    reason,
    actionId: null,
    orderId: plan && typeof plan.orderId === 'string' ? plan.orderId : null,
    requestId: plan && typeof plan.requestId === 'string' ? plan.requestId : null,
    planId: plan && typeof plan.planId === 'string' ? plan.planId : null
  });
}

function createNexusEconomyPurchaseActionEnvelope() {
  const verifier = createNexusEconomyPurchasePlanVerifier();

  return Object.freeze({
    prepare(plan) {
      const verified = verifier.verify(plan);
      if (!verified.ok || !verified.verificationReady) {
        return reject(verified.reason, plan);
      }
      if (verified.fulfillment !== CLUSTER_SHOP_FULFILLMENT) {
        return reject('purchase-action-fulfillment-invalid', plan);
      }

      const actionId = `action_${verified.planDigest.slice(0, 24)}`;
      const payload = Object.freeze({
        planId: verified.planId,
        planDigest: verified.planDigest,
        discordUserId: verified.discordUserId,
        itemId: verified.itemId,
        quantity: verified.quantity,
        currency: verified.currency,
        totalPrice: verified.totalPrice,
        projectedBalance: verified.projectedBalance,
        fulfillment: CLUSTER_SHOP_FULFILLMENT
      });

      return Object.freeze({
        ok: true,
        actionReady: true,
        queueWritePermitted: false,
        executionPermitted: false,
        reason: 'purchase-action-envelope-ready',
        schemaVersion: PURCHASE_ACTION_SCHEMA_VERSION,
        actionId,
        type: PURCHASE_ACTION_TYPE,
        capability: PURCHASE_ACTION_CAPABILITY,
        subject: `discord-user:${verified.discordUserId}`,
        correlationId: verified.requestId,
        idempotencyKey: verified.orderId,
        requestId: verified.requestId,
        orderId: verified.orderId,
        planId: verified.planId,
        payload
      });
    }
  });
}

module.exports = {
  PURCHASE_ACTION_SCHEMA_VERSION,
  PURCHASE_ACTION_TYPE,
  PURCHASE_ACTION_CAPABILITY,
  createNexusEconomyPurchaseActionEnvelope
};
