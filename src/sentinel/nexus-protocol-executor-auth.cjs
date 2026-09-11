'use strict';

const crypto = require('node:crypto');

function requireSecret(secret) {
  const value = String(secret || '');
  if (Buffer.byteLength(value, 'utf8') < 32) throw new Error('Protocol executor signing secret must be at least 32 bytes');
  return value;
}

function canonicalEnvelope(envelope = {}) {
  if (!envelope || envelope.version !== 1 || !Array.isArray(envelope.actions)) {
    throw new Error('Invalid Protocol execution envelope');
  }
  return JSON.stringify({
    version: envelope.version,
    protocolId: envelope.protocolId,
    serverId: envelope.serverId,
    createdAt: envelope.createdAt,
    idempotencyKey: envelope.idempotencyKey ?? null,
    actions: envelope.actions.map((action) => ({
      actionId: action.actionId,
      index: action.index,
      plugin: action.plugin,
      command: action.command,
      destructive: action.destructive === true,
      idempotencyKey: action.idempotencyKey ?? null
    }))
  });
}

function signExecutionEnvelope(envelope, secret) {
  const key = requireSecret(secret);
  const body = canonicalEnvelope(envelope);
  const signature = crypto.createHmac('sha256', key).update(body).digest('hex');
  return Object.freeze({
    envelope,
    signature,
    algorithm: 'hmac-sha256'
  });
}

function verifyExecutionEnvelopeSignature(signed, secret) {
  if (!signed || signed.algorithm !== 'hmac-sha256' || !/^[a-f0-9]{64}$/.test(String(signed.signature || ''))) {
    throw new Error('Invalid Protocol executor signature wrapper');
  }
  const key = requireSecret(secret);
  const expected = crypto.createHmac('sha256', key).update(canonicalEnvelope(signed.envelope)).digest();
  const actual = Buffer.from(signed.signature, 'hex');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new Error('Protocol executor signature mismatch');
  }
  return true;
}

module.exports = {
  canonicalEnvelope,
  signExecutionEnvelope,
  verifyExecutionEnvelopeSignature
};
