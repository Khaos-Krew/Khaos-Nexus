'use strict';

const crypto = require('node:crypto');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function clean(value, label, max = 128) {
  const result = String(value ?? '').trim();
  if (!result || result.length > max || /[\r\n\0]/.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}

function assertReconciliationShape(decision) {
  if (!decision || Number(decision.version) !== 1 || decision.kind !== 'protocol-adapter-reconciliation-decision'
    || decision.decision !== 'prepare_new_attempt' || decision.nextAction !== 'require_fresh_preflight_and_permit'
    || decision.durableStatus !== 'failed' || decision.requiresFreshPreflight !== true
    || decision.requiresFreshAdapterPermit !== true || decision.reusesPriorPermit !== false
    || decision.grantsRetryAuthority !== false || decision.executesCommand !== false
    || decision.persistsReceipt !== false || decision.mutatesServerConfiguration !== false
    || decision.readOnly !== true || !/^[a-f0-9]{64}$/.test(String(decision.reconciliationDigest || '').toLowerCase())) {
    throw new Error('Invalid Protocol reconciliation decision for fresh attempt preparation');
  }
  return true;
}

function buildAdapterFreshAttemptPreparation(decision, input = {}, options = {}) {
  assertReconciliationShape(decision);
  const attemptId = clean(input.attemptId, 'Protocol fresh attempt id', 128);
  const preparedBy = clean(input.preparedBy || 'sentinel', 'Protocol fresh attempt preparer', 96);
  const preparedAt = Number(input.preparedAt ?? options.now ?? Date.now());
  if (!Number.isFinite(preparedAt) || preparedAt < Number(decision.decidedAt)) {
    throw new Error('Invalid Protocol fresh attempt preparation time');
  }

  const payload = {
    version: 1,
    kind: 'protocol-adapter-fresh-attempt-preparation',
    reconciliationDigest: String(decision.reconciliationDigest).toLowerCase(),
    priorOutcomeDigest: String(decision.outcomeDigest).toLowerCase(),
    protocolId: decision.protocolId,
    serverId: decision.serverId,
    actionId: decision.actionId,
    adapter: decision.adapter,
    attemptId,
    preparedBy,
    preparedAt,
    requiresFreshPreflight: true,
    requiresFreshAdapterPermit: true,
    requiresNewIdempotencyEvaluation: true,
    reusesPriorPermit: false,
    reusesPriorPreflight: false,
    grantsRetryAuthority: false,
    executesCommand: false,
    persistsReceipt: false,
    mutatesServerConfiguration: false,
    readOnly: true
  };
  return Object.freeze({ ...payload, preparationDigest: digest(payload) });
}

function assertAdapterFreshAttemptPreparation(preparation, decision) {
  if (!preparation || Number(preparation.version) !== 1 || preparation.kind !== 'protocol-adapter-fresh-attempt-preparation'
    || preparation.requiresFreshPreflight !== true || preparation.requiresFreshAdapterPermit !== true
    || preparation.requiresNewIdempotencyEvaluation !== true || preparation.reusesPriorPermit !== false
    || preparation.reusesPriorPreflight !== false || preparation.grantsRetryAuthority !== false
    || preparation.executesCommand !== false || preparation.persistsReceipt !== false
    || preparation.mutatesServerConfiguration !== false || preparation.readOnly !== true
    || !/^[a-f0-9]{64}$/.test(String(preparation.preparationDigest || '').toLowerCase())) {
    throw new Error('Invalid Protocol fresh attempt preparation');
  }
  const expected = buildAdapterFreshAttemptPreparation(decision, {
    attemptId: preparation.attemptId,
    preparedBy: preparation.preparedBy,
    preparedAt: preparation.preparedAt
  });
  if (JSON.stringify(canonical(preparation)) !== JSON.stringify(canonical(expected))) {
    throw new Error('Protocol fresh attempt preparation no longer matches reconciliation decision');
  }
  return true;
}

module.exports = { buildAdapterFreshAttemptPreparation, assertAdapterFreshAttemptPreparation };
