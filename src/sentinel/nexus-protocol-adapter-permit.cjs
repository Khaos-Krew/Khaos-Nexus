'use strict';

const crypto = require('node:crypto');
const { assertExecutorHandoff } = require('./nexus-protocol-executor-handoff.cjs');
const { classifyExecutionAttempt } = require('./nexus-protocol-executor-receipts.cjs');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function createAdapterPermit(handoff, snapshot, envelope, receipts = [], actionIndex, options = {}) {
  const now = Number(options.now ?? Date.now());
  assertExecutorHandoff(handoff, snapshot, envelope, receipts, { ...options, now });
  const index = Number(actionIndex);
  if (!Number.isInteger(index) || index < 0 || index >= envelope.actions.length) {
    throw new Error('Invalid Protocol adapter action index');
  }
  const action = envelope.actions[index];
  const handoffAction = handoff.actions[index];
  if (!handoffAction || handoffAction.actionId !== action.actionId || handoffAction.index !== index) {
    throw new Error('Protocol adapter action is not bound to executor handoff');
  }
  const adapter = String(options.adapter || '').trim();
  if (!adapter || adapter !== action.plugin) throw new Error('Protocol adapter does not match action plugin');

  const attempt = classifyExecutionAttempt(envelope, index, receipts);
  const payload = {
    version: 1,
    protocolId: envelope.protocolId,
    serverId: envelope.serverId,
    actionId: action.actionId,
    actionIndex: index,
    adapter,
    commandDigest: handoffAction.commandDigest,
    idempotencyKeyDigest: handoffAction.idempotencyKeyDigest,
    attemptReason: attempt.reason,
    allowed: attempt.allowed === true,
    issuedAt: now,
    expiresAt: handoff.expiresAt,
    requiresCommandRevalidation: true,
    requiresReceiptPersistence: true,
    executesCommand: false,
    mutatesServerConfiguration: false
  };
  return Object.freeze({ ...payload, permitDigest: digest(payload) });
}

function assertAdapterPermit(permit, handoff, snapshot, envelope, receipts = [], options = {}) {
  if (!permit || Number(permit.version) !== 1
    || permit.requiresCommandRevalidation !== true
    || permit.requiresReceiptPersistence !== true
    || permit.executesCommand !== false
    || permit.mutatesServerConfiguration !== false
    || !/^[a-f0-9]{64}$/.test(String(permit.permitDigest || '').toLowerCase())) {
    throw new Error('Invalid Protocol adapter permit');
  }
  const now = Number(options.now ?? Date.now());
  if (!Number.isFinite(now) || now < permit.issuedAt || now > permit.expiresAt) {
    throw new Error('Protocol adapter permit is expired or not yet valid');
  }
  const expected = createAdapterPermit(
    handoff,
    snapshot,
    envelope,
    receipts,
    permit.actionIndex,
    { ...options, adapter: permit.adapter, now: permit.issuedAt }
  );
  if (JSON.stringify(canonical(permit)) !== JSON.stringify(canonical(expected))) {
    throw new Error('Protocol adapter permit no longer matches executor state');
  }
  return true;
}

module.exports = {
  createAdapterPermit,
  assertAdapterPermit
};
