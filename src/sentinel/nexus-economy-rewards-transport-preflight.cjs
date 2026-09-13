'use strict';

const { CLUSTER_SHOP_FULFILLMENT } = require('./nexus-economy-purchase-action-request.cjs');

function reject(reason, envelope = null) {
  return Object.freeze({
    ok: false,
    transportReady: false,
    commandConstructionPermitted: false,
    fulfillmentPermitted: false,
    executionPermitted: false,
    reason,
    actionId: typeof envelope?.actionId === 'string' ? envelope.actionId : null,
    transportPlan: null
  });
}

function validateDeliveryEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return 'invalid-delivery-envelope';
  if (envelope.schemaVersion !== 1) return 'unsupported-delivery-envelope-schema';
  if (envelope.operation !== 'rewards-ascended-item-delivery') return 'delivery-operation-mismatch';
  if (envelope.fulfillment !== CLUSTER_SHOP_FULFILLMENT) return 'delivery-fulfillment-mismatch';
  if (envelope.transport !== 'rewards-ascended') return 'delivery-transport-mismatch';
  if (envelope.command !== null) return 'unsafe-preconstructed-delivery-command';
  if (envelope.fulfillmentPermitted !== false || envelope.executionPermitted !== false) return 'unsafe-delivery-envelope-flags';
  if (typeof envelope.actionId !== 'string' || !envelope.actionId) return 'invalid-delivery-action-id';
  if (typeof envelope.orderId !== 'string' || !envelope.orderId || envelope.idempotencyKey !== envelope.orderId) return 'delivery-idempotency-mismatch';
  if (typeof envelope.requestId !== 'string' || !envelope.requestId || envelope.correlationId !== envelope.requestId) return 'delivery-correlation-mismatch';
  if (typeof envelope.discordUserId !== 'string' || !envelope.discordUserId) return 'invalid-delivery-user';
  if (typeof envelope.eosProductUserId !== 'string' || !envelope.eosProductUserId) return 'invalid-delivery-eos-id';
  if (typeof envelope.serverId !== 'string' || !envelope.serverId) return 'invalid-delivery-server-id';
  if (typeof envelope.itemId !== 'string' || !envelope.itemId) return 'invalid-delivery-item-id';
  if (envelope.itemKind !== 'item') return 'unsupported-delivery-item-kind';
  if (typeof envelope.blueprint !== 'string' || !envelope.blueprint) return 'invalid-delivery-blueprint';
  if (!Number.isSafeInteger(envelope.totalItemQuantity) || envelope.totalItemQuantity < 1) return 'invalid-delivery-total-quantity';
  return null;
}

function validateTransportCapability(capability) {
  if (!capability || typeof capability !== 'object' || Array.isArray(capability)) return 'missing-rewards-transport-capability';
  if (capability.transport !== 'rewards-ascended') return 'rewards-transport-capability-mismatch';
  if (capability.verified !== true) return 'rewards-transport-not-verified';
  if (capability.itemDeliverySupported !== true) return 'rewards-item-delivery-not-supported';
  if (capability.identityMode !== 'eos-product-user-id') return 'rewards-identity-mode-mismatch';
  if (capability.commandSyntaxVerified !== true) return 'rewards-command-syntax-not-verified';
  if (capability.transportWriteVerified !== true) return 'rewards-transport-write-not-verified';
  if (typeof capability.verificationSource !== 'string' || capability.verificationSource.trim().length < 3) return 'missing-rewards-verification-source';
  return null;
}

function createNexusEconomyRewardsTransportPreflight() {
  return Object.freeze({
    prepare(deliveryEnvelope, capability) {
      const envelopeError = validateDeliveryEnvelope(deliveryEnvelope);
      if (envelopeError) return reject(envelopeError, deliveryEnvelope);

      const capabilityError = validateTransportCapability(capability);
      if (capabilityError) return reject(capabilityError, deliveryEnvelope);

      const transportPlan = Object.freeze({
        schemaVersion: 1,
        operation: 'rewards-ascended-item-transport-preflight',
        fulfillment: CLUSTER_SHOP_FULFILLMENT,
        actionId: deliveryEnvelope.actionId,
        orderId: deliveryEnvelope.orderId,
        idempotencyKey: deliveryEnvelope.idempotencyKey,
        correlationId: deliveryEnvelope.correlationId,
        requestId: deliveryEnvelope.requestId,
        discordUserId: deliveryEnvelope.discordUserId,
        eosProductUserId: deliveryEnvelope.eosProductUserId,
        serverId: deliveryEnvelope.serverId,
        itemId: deliveryEnvelope.itemId,
        blueprint: deliveryEnvelope.blueprint,
        totalItemQuantity: deliveryEnvelope.totalItemQuantity,
        debitTransactionId: deliveryEnvelope.debitTransactionId ?? null,
        transport: 'rewards-ascended',
        identityMode: 'eos-product-user-id',
        verificationSource: capability.verificationSource.trim(),
        command: null,
        commandConstructionPermitted: false,
        fulfillmentPermitted: false,
        executionPermitted: false
      });

      return Object.freeze({
        ok: true,
        transportReady: true,
        commandConstructionPermitted: false,
        fulfillmentPermitted: false,
        executionPermitted: false,
        reason: 'rewards-ascended-transport-contract-verified',
        actionId: deliveryEnvelope.actionId,
        transportPlan
      });
    }
  });
}

module.exports = {
  createNexusEconomyRewardsTransportPreflight,
  validateDeliveryEnvelope,
  validateTransportCapability
};
