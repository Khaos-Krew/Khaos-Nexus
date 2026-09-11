'use strict';

const crypto = require('node:crypto');

const PURCHASE_OUTBOX_SCHEMA_VERSION = 1;
const ACTION_TYPE = 'nexus.economy.purchase';
const ACTION_CAPABILITY = 'economy.purchase.execute';
const ACTION_SOURCE = 'sentinel-v2.economy.purchase';
const HEX_64 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9:_-]{1,128}$/;

function reject(reason, record = {}) {
  return Object.freeze({
    ok: false,
    requestReady: false,
    submitPermitted: false,
    executionPermitted: false,
    reason,
    actionId: record && typeof record.actionId === 'string' ? record.actionId : null,
    recordId: record && typeof record.recordId === 'string' ? record.recordId : null,
    actionRequest: null
  });
}

function canonicalRecordPayload(record) {
  return {
    schemaVersion: PURCHASE_OUTBOX_SCHEMA_VERSION,
    actionId: record.actionId,
    type: record.type,
    capability: record.capability,
    subject: record.subject,
    correlationId: record.correlationId,
    idempotencyKey: record.idempotencyKey,
    requestId: record.requestId,
    orderId: record.orderId,
    planId: record.planId,
    payload: {
      planId: record.payload.planId,
      planDigest: record.payload.planDigest,
      discordUserId: record.payload.discordUserId,
      itemId: record.payload.itemId,
      quantity: record.payload.quantity,
      currency: record.payload.currency,
      totalPrice: record.payload.totalPrice,
      projectedBalance: record.payload.projectedBalance
    }
  };
}

function digestCanonical(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function validateOutboxRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return 'invalid-outbox-record';
  if (record.ok !== true || record.recordReady !== true) return 'outbox-record-not-ready';
  if (record.persistPermitted !== false || record.queueWritePermitted !== false || record.executionPermitted !== false) {
    return 'unsafe-outbox-record-flags';
  }
  if (record.schemaVersion !== PURCHASE_OUTBOX_SCHEMA_VERSION) return 'unsupported-outbox-schema';
  if (record.type !== ACTION_TYPE || record.capability !== ACTION_CAPABILITY) return 'unexpected-outbox-capability';

  const ids = ['recordId', 'actionId', 'correlationId', 'idempotencyKey', 'requestId', 'orderId', 'planId'];
  for (const key of ids) {
    if (typeof record[key] !== 'string' || !SAFE_ID.test(record[key])) return `invalid-${key}`;
  }
  if (typeof record.recordDigest !== 'string' || !HEX_64.test(record.recordDigest)) return 'invalid-record-digest';
  if (record.correlationId !== record.requestId) return 'correlation-id-mismatch';
  if (record.idempotencyKey !== record.orderId) return 'idempotency-key-mismatch';

  const payload = record.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'invalid-outbox-payload';
  if (payload.planId !== record.planId) return 'plan-id-mismatch';
  if (typeof payload.planDigest !== 'string' || !HEX_64.test(payload.planDigest)) return 'invalid-plan-digest';
  if (record.actionId !== `action_${payload.planDigest.slice(0, 24)}`) return 'action-id-mismatch';
  if (typeof payload.discordUserId !== 'string' || !/^\d{5,32}$/.test(payload.discordUserId)) return 'invalid-discord-user-id';
  if (record.subject !== `discord-user:${payload.discordUserId}`) return 'subject-mismatch';
  if (typeof payload.itemId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(payload.itemId)) return 'invalid-item-id';
  if (!Number.isSafeInteger(payload.quantity) || payload.quantity < 1 || payload.quantity > 25) return 'invalid-quantity';
  if (payload.currency !== 'NEXUS_POINTS') return 'invalid-currency';
  if (!Number.isSafeInteger(payload.totalPrice) || payload.totalPrice < 0) return 'invalid-total-price';
  if (!Number.isSafeInteger(payload.projectedBalance) || payload.projectedBalance < 0) return 'invalid-projected-balance';

  const canonical = canonicalRecordPayload(record);
  const expectedDigest = digestCanonical(canonical);
  if (record.recordDigest !== expectedDigest) return 'record-digest-mismatch';
  if (record.recordId !== `outbox_${expectedDigest.slice(0, 24)}`) return 'record-id-mismatch';

  return null;
}

function freezeActionRequest(record) {
  const payload = Object.freeze({ ...record.payload });
  const request = Object.freeze({
    schemaVersion: record.schemaVersion,
    type: record.type,
    recordId: record.recordId,
    recordDigest: record.recordDigest,
    requestId: record.requestId,
    orderId: record.orderId,
    planId: record.planId,
    payload
  });

  return Object.freeze({
    actionId: record.actionId,
    capability: record.capability,
    source: ACTION_SOURCE,
    actor: record.subject,
    subject: record.subject,
    destructive: false,
    idempotencyKey: record.idempotencyKey,
    correlationId: record.correlationId,
    request
  });
}

function createNexusEconomyPurchaseActionRequest() {
  return Object.freeze({
    prepare(record) {
      const validationError = validateOutboxRecord(record);
      if (validationError) return reject(validationError, record);

      return Object.freeze({
        ok: true,
        requestReady: true,
        submitPermitted: false,
        executionPermitted: false,
        reason: 'purchase-action-request-ready',
        actionId: record.actionId,
        recordId: record.recordId,
        actionRequest: freezeActionRequest(record)
      });
    }
  });
}

module.exports = {
  ACTION_SOURCE,
  createNexusEconomyPurchaseActionRequest
};
