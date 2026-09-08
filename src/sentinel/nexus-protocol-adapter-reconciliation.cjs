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

function assertOutcomeShape(outcome) {
  if (!outcome || Number(outcome.version) !== 1
    || !['succeeded', 'failed', 'uncertain'].includes(outcome.receipt?.status)
    || outcome.requiresReceiptPersistence !== true
    || outcome.executesCommand !== false
    || outcome.persistsReceipt !== false
    || outcome.mutatesServerConfiguration !== false
    || !/^[a-f0-9]{64}$/.test(String(outcome.outcomeDigest || '').toLowerCase())) {
    throw new Error('Invalid Protocol adapter outcome for reconciliation');
  }
  return true;
}

function assertCommitShape(commit) {
  if (!commit || Number(commit.version) !== 1 || commit.durableAppendVerified !== true
    || commit.executesCommand !== false || commit.mutatesServerConfiguration !== false
    || commit.grantsRetryAuthority !== false || commit.readOnly !== true
    || !/^[a-f0-9]{64}$/.test(String(commit.persistenceCommitDigest || '').toLowerCase())) {
    throw new Error('Invalid Protocol durable receipt commit for reconciliation');
  }
  return true;
}

function buildAdapterReconciliationDecision(outcome, commit, input = {}, options = {}) {
  assertOutcomeShape(outcome);
  assertCommitShape(commit);
  if (commit.persistedReceiptDigest !== outcome.receiptDigest || commit.persistedStatus !== outcome.receipt.status
    || commit.protocolId !== outcome.protocolId || commit.serverId !== outcome.serverId || commit.actionId !== outcome.actionId
    || commit.adapter !== outcome.adapter) {
    throw new Error('Protocol adapter reconciliation inputs do not describe the same durable execution outcome');
  }

  const requestedDecision = clean(input.decision || 'hold', 'Protocol adapter reconciliation decision', 32).toLowerCase();
  const allowed = outcome.receipt.status === 'succeeded'
    ? ['accept_success']
    : outcome.receipt.status === 'failed'
      ? ['hold', 'prepare_new_attempt']
      : ['hold', 'investigate'];
  if (!allowed.includes(requestedDecision)) {
    throw new Error('Protocol adapter reconciliation decision is not allowed for this durable outcome');
  }

  const decidedAt = Number(input.decidedAt ?? options.now ?? Date.now());
  if (!Number.isFinite(decidedAt) || decidedAt < Number(outcome.receipt.completedAt)) {
    throw new Error('Invalid Protocol adapter reconciliation decision time');
  }
  const reviewer = clean(input.reviewer || 'sentinel', 'Protocol adapter reconciliation reviewer', 96);
  const rationale = input.rationale == null ? null : clean(input.rationale, 'Protocol adapter reconciliation rationale', 512);

  const nextAction = requestedDecision === 'accept_success' ? 'complete'
    : requestedDecision === 'prepare_new_attempt' ? 'require_fresh_preflight_and_permit'
      : requestedDecision === 'investigate' ? 'manual_reconciliation_required' : 'hold';
  const payload = {
    version: 1,
    kind: 'protocol-adapter-reconciliation-decision',
    outcomeDigest: String(outcome.outcomeDigest).toLowerCase(),
    persistenceCommitDigest: String(commit.persistenceCommitDigest).toLowerCase(),
    protocolId: outcome.protocolId,
    serverId: outcome.serverId,
    actionId: outcome.actionId,
    adapter: outcome.adapter,
    durableStatus: outcome.receipt.status,
    decision: requestedDecision,
    nextAction,
    reviewer,
    rationale,
    decidedAt,
    requiresFreshPreflight: requestedDecision === 'prepare_new_attempt',
    requiresFreshAdapterPermit: requestedDecision === 'prepare_new_attempt',
    reusesPriorPermit: false,
    grantsRetryAuthority: false,
    executesCommand: false,
    persistsReceipt: false,
    mutatesServerConfiguration: false,
    readOnly: true
  };
  return Object.freeze({ ...payload, reconciliationDigest: digest(payload) });
}

function assertAdapterReconciliationDecision(decision, outcome, commit) {
  if (!decision || Number(decision.version) !== 1 || decision.kind !== 'protocol-adapter-reconciliation-decision'
    || decision.reusesPriorPermit !== false || decision.grantsRetryAuthority !== false
    || decision.executesCommand !== false || decision.persistsReceipt !== false
    || decision.mutatesServerConfiguration !== false || decision.readOnly !== true
    || !/^[a-f0-9]{64}$/.test(String(decision.reconciliationDigest || '').toLowerCase())) {
    throw new Error('Invalid Protocol adapter reconciliation decision');
  }
  const expected = buildAdapterReconciliationDecision(outcome, commit, {
    decision: decision.decision,
    reviewer: decision.reviewer,
    rationale: decision.rationale,
    decidedAt: decision.decidedAt
  });
  if (JSON.stringify(canonical(decision)) !== JSON.stringify(canonical(expected))) {
    throw new Error('Protocol adapter reconciliation decision no longer matches durable execution state');
  }
  return true;
}

module.exports = { buildAdapterReconciliationDecision, assertAdapterReconciliationDecision };
