'use strict';

const crypto = require('node:crypto');
const { preflightExecutionEnvelope, assertPreflightReady } = require('./nexus-protocol-executor-preflight.cjs');
const { normalizeExecutorReceipt } = require('./nexus-protocol-executor-receipts.cjs');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function timingSafeDigestEqual(left, right) {
  const a = String(left || '').toLowerCase();
  const b = String(right || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

function receiptSetDigest(receipts = []) {
  if (!Array.isArray(receipts)) throw new Error('Protocol executor receipts must be an array');
  const normalized = receipts.map(normalizeExecutorReceipt).map((receipt) => receipt.digest).sort();
  return digest(normalized);
}

function createPreflightSnapshot(envelope, receipts = [], options = {}) {
  const preflight = preflightExecutionEnvelope(envelope, receipts, options);
  assertPreflightReady(preflight);

  const issuedAt = Number(options.issuedAt ?? options.now ?? Date.now());
  if (!Number.isFinite(issuedAt) || issuedAt < 0) throw new Error('Invalid Protocol preflight snapshot time');
  const ttlMs = Math.max(1000, Math.min(60000, Number(options.ttlMs || 15000)));

  const payload = {
    version: 1,
    protocolId: envelope.protocolId,
    serverId: envelope.serverId,
    envelopeDigest: digest(envelope),
    receiptSetDigest: receiptSetDigest(receipts),
    preflightDigest: digest(preflight),
    actionIds: Object.freeze(envelope.actions.map((action) => action.actionId)),
    issuedAt,
    expiresAt: issuedAt + ttlMs,
    ready: true,
    executesCommands: false,
    dispatchAuthorized: false
  };
  return Object.freeze({ ...payload, snapshotDigest: digest(payload) });
}

function assertPreflightSnapshot(snapshot, envelope, receipts = [], options = {}) {
  if (!snapshot || Number(snapshot.version) !== 1
    || snapshot.ready !== true
    || snapshot.executesCommands !== false
    || snapshot.dispatchAuthorized !== false
    || !Array.isArray(snapshot.actionIds)
    || !/^[a-f0-9]{64}$/.test(String(snapshot.snapshotDigest || '').toLowerCase())) {
    throw new Error('Invalid Protocol preflight snapshot');
  }

  const now = Number(options.now ?? Date.now());
  if (!Number.isFinite(now) || now < snapshot.issuedAt || now > snapshot.expiresAt) {
    throw new Error('Protocol preflight snapshot is expired or not yet valid');
  }

  const expected = createPreflightSnapshot(envelope, receipts, {
    ...options,
    issuedAt: snapshot.issuedAt,
    ttlMs: snapshot.expiresAt - snapshot.issuedAt
  });
  if (!timingSafeDigestEqual(snapshot.snapshotDigest, expected.snapshotDigest)) {
    throw new Error('Protocol preflight snapshot integrity mismatch');
  }

  const { snapshotDigest: _actualDigest, ...actualPayload } = snapshot;
  const { snapshotDigest: _expectedDigest, ...expectedPayload } = expected;
  if (JSON.stringify(canonical(actualPayload)) !== JSON.stringify(canonical(expectedPayload))) {
    throw new Error('Protocol preflight snapshot no longer matches execution state');
  }
  return true;
}

module.exports = {
  receiptSetDigest,
  createPreflightSnapshot,
  assertPreflightSnapshot
};
