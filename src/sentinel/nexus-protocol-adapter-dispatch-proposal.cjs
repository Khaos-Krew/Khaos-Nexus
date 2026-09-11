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

function buildAdapterDispatchProposal(admission, commandContract, options = {}) {
  if (!admission || Number(admission.version) !== 1 || admission.kind !== 'protocol-adapter-fresh-attempt-admission'
    || admission.requiresFreshCommandContract !== true || admission.requiresReceiptPersistence !== true
    || admission.reusesPriorPermit !== false || admission.reusesPriorPreflight !== false
    || admission.grantsRetryAuthority !== false || admission.executesCommand !== false
    || admission.persistsReceipt !== false || admission.mutatesServerConfiguration !== false || admission.readOnly !== true
    || !/^[a-f0-9]{64}$/.test(String(admission.admissionDigest || '').toLowerCase())) {
    throw new Error('Invalid Protocol fresh attempt admission for dispatch proposal');
  }
  if (!commandContract || Number(commandContract.version) !== 1 || commandContract.executesCommand !== false
    || commandContract.requiresFreshAdapterPermit !== true || commandContract.requiresReceiptPersistence !== true
    || commandContract.mutatesServerConfiguration !== false || commandContract.grantsRetryAuthority !== false
    || commandContract.readOnly !== true || !/^[a-f0-9]{64}$/.test(String(commandContract.permitDigest || '').toLowerCase())) {
    throw new Error('Invalid Protocol adapter command contract for dispatch proposal');
  }
  if (admission.protocolId !== commandContract.protocolId || admission.serverId !== commandContract.serverId
    || admission.actionId !== commandContract.actionId || admission.adapter !== commandContract.plugin
    || String(admission.permitDigest).toLowerCase() !== String(commandContract.permitDigest).toLowerCase()) {
    throw new Error('Protocol dispatch inputs do not describe the same admitted adapter action');
  }
  if (Number(commandContract.checkedAt) < Number(admission.admittedAt) || Number(commandContract.expiresAt) < Number(commandContract.checkedAt)) {
    throw new Error('Protocol dispatch command contract is stale or outside its permit window');
  }

  const preparedAt = Number(options.preparedAt ?? commandContract.checkedAt);
  if (!Number.isSafeInteger(preparedAt) || preparedAt < Number(commandContract.checkedAt) || preparedAt > Number(commandContract.expiresAt)) {
    throw new Error('Invalid Protocol dispatch proposal time');
  }

  const payload = {
    version: 1,
    kind: 'protocol-adapter-dispatch-proposal',
    protocolId: admission.protocolId,
    serverId: admission.serverId,
    actionId: admission.actionId,
    actionIndex: commandContract.actionIndex,
    adapter: admission.adapter,
    operation: commandContract.operation,
    attemptId: admission.attemptId,
    attemptReason: admission.attemptReason,
    admissionDigest: String(admission.admissionDigest).toLowerCase(),
    permitDigest: String(commandContract.permitDigest).toLowerCase(),
    commandDigest: String(commandContract.commandDigest).toLowerCase(),
    idempotencyKeyDigest: commandContract.idempotencyKeyDigest ?? null,
    mutating: commandContract.mutating === true,
    preparedAt,
    expiresAt: commandContract.expiresAt,
    requiresFreshExecutorAuthorization: true,
    requiresReceiptPersistence: true,
    requiresPostDispatchOutcomeCapture: true,
    executesCommand: false,
    persistsReceipt: false,
    grantsRetryAuthority: false,
    mutatesServerConfiguration: false,
    readOnly: true
  };
  return Object.freeze({ ...payload, proposalDigest: digest(payload) });
}

function assertAdapterDispatchProposal(proposal, admission, commandContract) {
  if (!proposal || Number(proposal.version) !== 1 || proposal.kind !== 'protocol-adapter-dispatch-proposal'
    || proposal.requiresFreshExecutorAuthorization !== true || proposal.requiresReceiptPersistence !== true
    || proposal.requiresPostDispatchOutcomeCapture !== true || proposal.executesCommand !== false
    || proposal.persistsReceipt !== false || proposal.grantsRetryAuthority !== false
    || proposal.mutatesServerConfiguration !== false || proposal.readOnly !== true
    || !/^[a-f0-9]{64}$/.test(String(proposal.proposalDigest || '').toLowerCase())) {
    throw new Error('Invalid Protocol adapter dispatch proposal');
  }
  const expected = buildAdapterDispatchProposal(admission, commandContract, { preparedAt: proposal.preparedAt });
  if (JSON.stringify(canonical(proposal)) !== JSON.stringify(canonical(expected))) {
    throw new Error('Protocol adapter dispatch proposal no longer matches admitted executor state');
  }
  return true;
}

module.exports = { buildAdapterDispatchProposal, assertAdapterDispatchProposal };
