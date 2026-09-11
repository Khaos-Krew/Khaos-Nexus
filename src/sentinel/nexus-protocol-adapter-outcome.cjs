'use strict';

const crypto = require('node:crypto');
const { assertAdapterPermit } = require('./nexus-protocol-adapter-permit.cjs');
const { normalizeExecutorReceipt } = require('./nexus-protocol-executor-receipts.cjs');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function clean(value, max = 128) {
  return String(value ?? '').trim().slice(0, max);
}

function createAdapterOutcome(permit, handoff, snapshot, envelope, receipts = [], observation = {}, options = {}) {
  const now = Number(options.now ?? Date.now());
  assertAdapterPermit(permit, handoff, snapshot, envelope, receipts, { ...options, now });
  if (permit.allowed !== true) throw new Error('Protocol adapter permit does not authorize an execution attempt');

  const acknowledgement = clean(observation.acknowledgement, 32).toLowerCase();
  if (!['confirmed_success', 'confirmed_failure', 'unknown'].includes(acknowledgement)) {
    throw new Error('Invalid Protocol adapter acknowledgement');
  }
  const completedAt = Number(observation.completedAt ?? now);
  if (!Number.isFinite(completedAt) || completedAt < permit.issuedAt || completedAt > now) {
    throw new Error('Invalid Protocol adapter completion time');
  }
  const adapterReference = observation.adapterReference == null ? null : clean(observation.adapterReference, 128);
  if (observation.adapterReference != null && !/^[A-Za-z0-9:_./-]{1,128}$/.test(adapterReference)) {
    throw new Error('Invalid Protocol adapter reference');
  }

  const status = acknowledgement === 'confirmed_success'
    ? 'succeeded'
    : acknowledgement === 'confirmed_failure' ? 'failed' : 'uncertain';
  const action = envelope.actions[permit.actionIndex];
  const receipt = normalizeExecutorReceipt({
    serverId: envelope.serverId,
    protocolId: envelope.protocolId,
    actionId: action.actionId,
    idempotencyKey: action.idempotencyKey,
    status,
    completedAt
  });
  const payload = {
    version: 1,
    permitDigest: String(permit.permitDigest || '').toLowerCase(),
    protocolId: envelope.protocolId,
    serverId: envelope.serverId,
    actionId: action.actionId,
    actionIndex: permit.actionIndex,
    adapter: permit.adapter,
    acknowledgement,
    adapterReference,
    receiptDigest: receipt.digest,
    receipt,
    requiresReceiptPersistence: true,
    requiresReconciliation: status === 'uncertain',
    retryEligible: status === 'failed',
    executesCommand: false,
    persistsReceipt: false,
    mutatesServerConfiguration: false
  };
  return Object.freeze({ ...payload, outcomeDigest: digest(payload) });
}

function assertAdapterOutcome(outcome, permit, handoff, snapshot, envelope, receipts = [], options = {}) {
  if (!outcome || Number(outcome.version) !== 1
    || outcome.requiresReceiptPersistence !== true
    || outcome.executesCommand !== false
    || outcome.persistsReceipt !== false
    || outcome.mutatesServerConfiguration !== false
    || !/^[a-f0-9]{64}$/.test(String(outcome.outcomeDigest || '').toLowerCase())) {
    throw new Error('Invalid Protocol adapter outcome');
  }
  const expected = createAdapterOutcome(permit, handoff, snapshot, envelope, receipts, {
    acknowledgement: outcome.acknowledgement,
    adapterReference: outcome.adapterReference,
    completedAt: outcome.receipt && outcome.receipt.completedAt
  }, { ...options, now: Number(options.now ?? outcome.receipt?.completedAt) });
  if (JSON.stringify(canonical(outcome)) !== JSON.stringify(canonical(expected))) {
    throw new Error('Protocol adapter outcome no longer matches permitted executor state');
  }
  return true;
}

module.exports = {
  createAdapterOutcome,
  assertAdapterOutcome
};
