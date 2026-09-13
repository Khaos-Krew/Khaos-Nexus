'use strict';

const { projectClusterItem } = require('./nexus-cluster-shop-catalog.cjs');
const { CLUSTER_SHOP_FULFILLMENT } = require('./nexus-economy-purchase-action-request.cjs');

function reject(reason, intent = null) {
  return Object.freeze({
    ok: false,
    fulfillmentEnvelopeReady: false,
    fulfillmentPermitted: false,
    executionPermitted: false,
    reason,
    actionId: typeof intent?.actionId === 'string' ? intent.actionId : null,
    envelope: null
  });
}

function validateFulfillmentIntent(intent) {
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) return 'invalid-fulfillment-intent';
  if (intent.operation !== 'rewards-ascended-item-fulfillment') return 'fulfillment-operation-mismatch';
  if (intent.fulfillment !== CLUSTER_SHOP_FULFILLMENT) return 'fulfillment-type-mismatch';
  if (intent.fulfillmentPermitted !== false || intent.executionPermitted !== false) return 'unsafe-fulfillment-intent-flags';
  if (typeof intent.actionId !== 'string' || !intent.actionId) return 'invalid-fulfillment-action-id';
  if (typeof intent.orderId !== 'string' || !intent.orderId || intent.idempotencyKey !== intent.orderId) return 'fulfillment-idempotency-mismatch';
  if (typeof intent.requestId !== 'string' || !intent.requestId || intent.correlationId !== intent.requestId) return 'fulfillment-correlation-mismatch';
  if (typeof intent.discordUserId !== 'string' || !intent.discordUserId) return 'invalid-fulfillment-user';
  if (typeof intent.eosProductUserId !== 'string' || !intent.eosProductUserId) return 'invalid-fulfillment-eos-id';
  if (typeof intent.serverId !== 'string' || !intent.serverId) return 'invalid-fulfillment-server-id';
  if (typeof intent.itemId !== 'string' || !intent.itemId) return 'invalid-fulfillment-item-id';
  if (!Number.isSafeInteger(intent.quantity) || intent.quantity < 1) return 'invalid-fulfillment-quantity';
  if (!Number.isSafeInteger(intent.debitBalance) || intent.debitBalance < 0) return 'invalid-fulfillment-debit-balance';
  return null;
}

function resolveCatalogItem(catalog, itemId) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) throw new Error('invalid-cluster-shop-catalog');
  if (catalog.fulfillment !== CLUSTER_SHOP_FULFILLMENT) throw new Error('catalog-fulfillment-mismatch');
  if (!Array.isArray(catalog.items)) throw new Error('invalid-cluster-shop-catalog-items');
  const raw = catalog.items.find((entry) => entry?.id === itemId);
  if (!raw) throw new Error('cluster-shop-item-not-found');
  const item = projectClusterItem(raw);
  if (item.fulfillment !== CLUSTER_SHOP_FULFILLMENT) throw new Error('catalog-item-fulfillment-mismatch');
  if (item.buyable !== true) throw new Error('cluster-shop-item-not-buyable');
  return item;
}

function createNexusEconomyPurchaseWorkerFulfillmentEnvelope() {
  return Object.freeze({
    prepare(fulfillmentIntent, catalog) {
      const intentError = validateFulfillmentIntent(fulfillmentIntent);
      if (intentError) return reject(intentError, fulfillmentIntent);

      let item;
      try {
        item = resolveCatalogItem(catalog, fulfillmentIntent.itemId);
      } catch (error) {
        return reject(error?.message || 'cluster-shop-catalog-resolution-failed', fulfillmentIntent);
      }

      if (fulfillmentIntent.quantity < item.minBundles || fulfillmentIntent.quantity > item.maxBundles) {
        return reject('fulfillment-quantity-out-of-catalog-bounds', fulfillmentIntent);
      }

      const totalItemQuantity = item.baseQuantity * fulfillmentIntent.quantity;
      if (!Number.isSafeInteger(totalItemQuantity) || totalItemQuantity < 1 || totalItemQuantity > 1_000_000_000) {
        return reject('unsafe-fulfillment-total-item-quantity', fulfillmentIntent);
      }

      const envelope = Object.freeze({
        schemaVersion: 1,
        operation: 'rewards-ascended-item-delivery',
        fulfillment: CLUSTER_SHOP_FULFILLMENT,
        actionId: fulfillmentIntent.actionId,
        orderId: fulfillmentIntent.orderId,
        idempotencyKey: fulfillmentIntent.idempotencyKey,
        correlationId: fulfillmentIntent.correlationId,
        requestId: fulfillmentIntent.requestId,
        discordUserId: fulfillmentIntent.discordUserId,
        eosProductUserId: fulfillmentIntent.eosProductUserId,
        serverId: fulfillmentIntent.serverId,
        itemId: item.id,
        itemKind: item.kind,
        blueprint: item.blueprint,
        bundleQuantity: fulfillmentIntent.quantity,
        baseQuantity: item.baseQuantity,
        totalItemQuantity,
        debitTransactionId: fulfillmentIntent.debitTransactionId ?? null,
        debitBalance: fulfillmentIntent.debitBalance,
        presenceObservedAt: fulfillmentIntent.presenceObservedAt,
        transport: 'rewards-ascended',
        command: null,
        fulfillmentPermitted: false,
        executionPermitted: false
      });

      return Object.freeze({
        ok: true,
        fulfillmentEnvelopeReady: true,
        fulfillmentPermitted: false,
        executionPermitted: false,
        reason: 'purchase-rewards-ascended-fulfillment-envelope-ready',
        actionId: fulfillmentIntent.actionId,
        envelope
      });
    }
  });
}

module.exports = {
  createNexusEconomyPurchaseWorkerFulfillmentEnvelope,
  resolveCatalogItem,
  validateFulfillmentIntent
};
