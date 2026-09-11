'use strict';

const {
  PURCHASE_EXECUTION_PLAN_VERSION,
  canonicalPlanPayload,
  digestPayload
} = require('./nexus-economy-purchase-execution-plan.cjs');

function reject(reason, plan = {}) {
  return Object.freeze({
    ok: false,
    verificationReady: false,
    executionPermitted: false,
    reason,
    planId: plan && typeof plan.planId === 'string' ? plan.planId : null,
    orderId: plan && typeof plan.orderId === 'string' ? plan.orderId : null,
    requestId: plan && typeof plan.requestId === 'string' ? plan.requestId : null
  });
}

function validString(value, maxLength = 128) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function validNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validatePlanShape(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return 'purchase-plan-invalid';
  if (plan.planVersion !== PURCHASE_EXECUTION_PLAN_VERSION) return 'purchase-plan-version-unsupported';
  if (!validString(plan.orderId) || !validString(plan.requestId) || !validString(plan.discordUserId)) return 'purchase-plan-identity-invalid';
  if (!validString(plan.itemId, 64) || !validString(plan.currency, 64)) return 'purchase-plan-item-invalid';
  if (!validPositiveInteger(plan.quantity) || !validNonNegativeInteger(plan.unitPrice) || !validNonNegativeInteger(plan.totalPrice)) return 'purchase-plan-price-invalid';
  if (!validNonNegativeInteger(plan.balance) || !validNonNegativeInteger(plan.projectedBalance)) return 'purchase-plan-balance-invalid';
  if (plan.unitPrice * plan.quantity !== plan.totalPrice) return 'purchase-plan-total-mismatch';
  if (plan.balance - plan.totalPrice !== plan.projectedBalance) return 'purchase-plan-balance-mismatch';
  if (!validString(plan.planDigest, 64) || !/^[a-f0-9]{64}$/.test(plan.planDigest)) return 'purchase-plan-digest-invalid';
  if (!validString(plan.planId, 33) || !/^purchase_[a-f0-9]{24}$/.test(plan.planId)) return 'purchase-plan-id-invalid';
  if (!Array.isArray(plan.operations) || plan.operations.length !== 2) return 'purchase-plan-operations-invalid';
  return null;
}

function expectedOperations(plan) {
  return [
    {
      type: 'wallet-debit',
      amount: plan.totalPrice,
      idempotencyKey: plan.orderId
    },
    {
      type: 'dino-cache-fulfillment',
      itemId: plan.itemId,
      quantity: plan.quantity,
      idempotencyKey: plan.orderId
    }
  ];
}

function createNexusEconomyPurchasePlanVerifier() {
  return Object.freeze({
    verify(plan) {
      const shapeError = validatePlanShape(plan);
      if (shapeError) return reject(shapeError, plan);

      const payload = canonicalPlanPayload({
        orderId: plan.orderId,
        requestId: plan.requestId,
        discordUserId: plan.discordUserId,
        itemId: plan.itemId,
        quantity: plan.quantity,
        currency: plan.currency,
        unitPrice: plan.unitPrice,
        currentTotalPrice: plan.totalPrice,
        projectedBalance: plan.projectedBalance
      });
      const expectedDigest = digestPayload(payload);
      const expectedPlanId = `purchase_${expectedDigest.slice(0, 24)}`;

      if (plan.planDigest !== expectedDigest || plan.planId !== expectedPlanId) {
        return reject('purchase-plan-tampered', plan);
      }

      const expected = expectedOperations(plan);
      if (JSON.stringify(plan.operations) !== JSON.stringify(expected)) {
        return reject('purchase-plan-operations-tampered', plan);
      }

      return Object.freeze({
        ok: true,
        verificationReady: true,
        executionPermitted: false,
        reason: 'purchase-plan-verified',
        planId: plan.planId,
        planDigest: plan.planDigest,
        orderId: plan.orderId,
        requestId: plan.requestId,
        discordUserId: plan.discordUserId,
        itemId: plan.itemId,
        quantity: plan.quantity,
        currency: plan.currency,
        totalPrice: plan.totalPrice,
        projectedBalance: plan.projectedBalance
      });
    }
  });
}

module.exports = {
  validatePlanShape,
  expectedOperations,
  createNexusEconomyPurchasePlanVerifier
};
