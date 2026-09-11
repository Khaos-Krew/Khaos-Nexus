'use strict';

const crypto = require('node:crypto');

const PURCHASE_OUTBOX_SCHEMA_VERSION = 1;
const ACTION_TYPE = 'nexus.economy.purchase';
const ACTION_CAPABILITY = 'economy.purchase.execute';
const HEX_64 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9:_-]{1,128}$/;

function reject(reason, envelope = {}) {
  return Object.freeze({
    ok: false,
    recordReady: false,
    persistPermitted: false,
    queueWritePermitted: false,
    executionPermitted: false,
    reason,
    recordId: null,
    actionId: envelope && typeof envelope.actionId === 'string' ? envelope.actionId : null,
    orderId: envelope && typeof envelope.orderId === 'string' ? envelope.orderId : null,
    requestId: envelope && typeof envelope.requestId === 'string' ? envelope.requestId : null
  });
}

function canonicalRecordPayload(envelope) {
  return {
    schemaVersion: PURCHASE_OUTBOX_SCHEMA_VERSION,
    actionId: envelope.actionId,
    type: envelope.type,
    capability: envelope.capability,
    subject: envelope.subject,
    correlationId: envelope.correlationId,
    idempotencyKey: envelope.idempotencyKey,
    requestId: envelope.requestId,
    orderId: envelope.orderId,
    planId: envelope.planId,
    payload: {
      planId: envelope.payload.planId,
      planDigest: envelope.payload.planDigest,
      discordUserId: envelope.payload.discordUserId,
      itemId: envelope.payload.itemId,
      quantity: envelope.payload.quantity,
      currency: envelope.payload.currency,
      totalPrice: envelope.payload.totalPrice,
      projectedBalance: envelope.payload.projectedBalance
    }
  };
}

function digestCanonical(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function validateEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return 'invalid-action-envelope';
  if (envelope.ok !== true || envelope.actionReady !== true) return 'action-envelope-not-ready';
  if (envelope.queueWritePermitted !== false || envelope.executionPermitted !== false) return 'unsafe-action-envelope-flags';
  if (envelope.schemaVersion !== 1) return 'unsupported-action-envelope-schema';
  if (envelope.type !== ACTION_TYPE || envelope.capability !== ACTION_CAPABILITY) return 'unexpected-action-envelope-capability';

  const ids = ['actionId', 'correlationId', 'idempotencyKey', 'requestId', 'orderId', 'planId'];
  for (const key of ids) {
    if (typeof envelope[key] !== 'string' || !SAFE_ID.test(envelope[key])) return `invalid-${key}`;
  }
  if (envelope.correlationId !== envelope.requestId) return 'correlation-id-mismatch';
  if (envelope.idempotencyKey !== envelope.orderId) return 'idempotency-key-mismatch';

  const payload = envelope.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'invalid-action-payload';
  if (payload.planId !== envelope.planId) return 'plan-id-mismatch';
  if (typeof payload.planDigest !== 'string' || !HEX_64.test(payload.planDigest)) return 'invalid-plan-digest';
  if (envelope.actionId !== `action_${payload.planDigest.slice(0, 24)}`) return 'action-id-mismatch';
  if (typeof payload.discordUserId !== 'string' || !/^\d{5,32}$/.test(payload.discordUserId)) return 'invalid-discord-user-id';
  if (envelope.subject !== `discord-user:${payload.discordUserId}`) return 'subject-mismatch';
  if (typeof payload.itemId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(payload.itemId)) return 'invalid-item-id';
  if (!Number.isSafeInteger(payload.quantity) || payload.quantity < 1 || payload.quantity > 25) return 'invalid-quantity';
  if (payload.currency !== 'NEXUS_POINTS') return 'invalid-currency';
  if (!Number.isSafeInteger(payload.totalPrice) || payload.totalPrice < 0) return 'invalid-total-price';
  if (!Number.isSafeInteger(payload.projectedBalance) || payload.projectedBalance < 0) return 'invalid-projected-balance';

  return null;
}

function createNexusEconomyPurchaseOutboxRecord() {
  return Object.freeze({
    prepare(envelope) {
      const validationError = validateEnvelope(envelope);
      if (validationError) return reject(validationError, envelope);

      const canonical = canonicalRecordPayload(envelope);
      const recordDigest = digestCanonical(canonical);
      const payload = Object.freeze({ ...canonical.payload });

      return Object.freeze({
        ok: true,
        recordReady: true,
        persistPermitted: false,
        queueWritePermitted: false,
        executionPermitted: false,
        reason: 'purchase-outbox-record-ready',
        schemaVersion: PURCHASE_OUTBOX_SCHEMA_VERSION,
        recordId: `outbox_${recordDigest.slice(0, 24)}`,
        recordDigest,
        actionId: canonical.actionId,
        type: canonical.type,
        capability: canonical.capability,
        subject: canonical.subject,
        correlationId: canonical.correlationId,
        idempotencyKey: canonical.idempotencyKey,
        requestId: canonical.requestId,
        orderId: canonical.orderId,
        planId: canonical.planId,
        payload
      });
    }
  });
}

module.exports = {
  PURCHASE_OUTBOX_SCHEMA_VERSION,
  createNexusEconomyPurchaseOutboxRecord
};
