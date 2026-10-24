'use strict';

const crypto = require('node:crypto');
const { assertPreflightSnapshot } = require('./nexus-protocol-preflight-snapshot.cjs');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function createExecutorHandoff(snapshot, envelope, receipts = [], options = {}) {
  assertPreflightSnapshot(snapshot, envelope, receipts, options);
  const issuedAt = Number(options.issuedAt ?? options.now ?? Date.now());
  if (!Number.isFinite(issuedAt) || issuedAt < snapshot.issuedAt || issuedAt > snapshot.expiresAt) {
    throw new Error('Protocol executor handoff time is outside the preflight window');
  }

  const actions = envelope.actions.map((action) => Object.freeze({
    actionId: action.actionId,
    index: action.index,
    plugin: action.plugin,
    commandDigest: digest(action.command),
    destructive: action.destructive === true,
    idempotencyKeyDigest: action.idempotencyKey ? digest(action.idempotencyKey) : null
  }));
  const payload = {
    version: 1,
    protocolId: envelope.protocolId,
    serverId: envelope.serverId,
    snapshotDigest: snapshot.snapshotDigest,
    envelopeDigest: snapshot.envelopeDigest,
    receiptSetDigest: snapshot.receiptSetDigest,
    issuedAt,
    expiresAt: snapshot.expiresAt,
    actions: Object.freeze(actions),
    requiresAdapterRevalidation: true,
    executesCommands: false,
    mutatesServerConfiguration: false
  };
  return Object.freeze({ ...payload, handoffDigest: digest(payload) });
}

function assertExecutorHandoff(handoff, snapshot, envelope, receipts = [], options = {}) {
  if (!handoff || Number(handoff.version) !== 1
    || handoff.requiresAdapterRevalidation !== true
    || handoff.executesCommands !== false
    || handoff.mutatesServerConfiguration !== false
    || !/^[a-f0-9]{64}$/.test(String(handoff.handoffDigest || '').toLowerCase())) {
    throw new Error('Invalid Protocol executor handoff');
  }
  const now = Number(options.now ?? Date.now());
  if (!Number.isFinite(now) || now < handoff.issuedAt || now > handoff.expiresAt) {
    throw new Error('Protocol executor handoff is expired or not yet valid');
  }
  const expected = createExecutorHandoff(snapshot, envelope, receipts, {
    ...options,
    issuedAt: handoff.issuedAt,
    now
  });
  if (handoff.handoffDigest !== expected.handoffDigest
    || JSON.stringify(canonical(handoff)) !== JSON.stringify(canonical(expected))) {
    throw new Error('Protocol executor handoff no longer matches preflight state');
  }
  return true;
}

module.exports = {
  createExecutorHandoff,
  assertExecutorHandoff
};
