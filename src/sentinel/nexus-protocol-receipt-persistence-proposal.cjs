'use strict';

const crypto = require('node:crypto');
const { assertAdapterOutcome } = require('./nexus-protocol-adapter-outcome.cjs');
const { normalizeReceiptState } = require('./nexus-protocol-executor-receipt-store.cjs');
const { buildReceiptIndex } = require('./nexus-protocol-executor-receipts.cjs');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function createReceiptPersistenceProposal(outcome, permit, handoff, snapshot, envelope, receiptState, options = {}) {
  const state = normalizeReceiptState(receiptState);
  assertAdapterOutcome(outcome, permit, handoff, snapshot, envelope, state.receipts, options);

  const index = buildReceiptIndex(state.receipts);
  const receipt = outcome.receipt;
  const existingAction = index.byActionId.get(receipt.actionId);
  if (existingAction) {
    if (existingAction.digest !== receipt.digest) {
      throw new Error('Protocol receipt persistence proposal conflicts with an existing action receipt');
    }
    throw new Error('Protocol receipt persistence proposal is already durably recorded');
  }
  if (receipt.idempotencyKey) {
    const existingKey = index.byIdempotencyKey.get(receipt.idempotencyKey);
    if (existingKey && existingKey.actionId !== receipt.actionId) {
      throw new Error('Protocol receipt persistence proposal reuses an idempotency key');
    }
  }

  const payload = {
    version: 1,
    outcomeDigest: String(outcome.outcomeDigest || '').toLowerCase(),
    protocolId: outcome.protocolId,
    serverId: outcome.serverId,
    actionId: outcome.actionId,
    adapter: outcome.adapter,
    expectedStoreRevision: state.revision,
    priorReceiptSetDigest: digest(state.receipts.map((item) => item.digest)),
    proposedReceiptDigest: receipt.digest,
    proposedReceipt: receipt,
    requiresAtomicCompareAndAppend: true,
    requiresReceiptPersistence: true,
    executesCommand: false,
    persistsReceipt: false,
    mutatesServerConfiguration: false
  };
  return Object.freeze({ ...payload, persistenceProposalDigest: digest(payload) });
}

function assertReceiptPersistenceProposal(proposal, outcome, permit, handoff, snapshot, envelope, receiptState, options = {}) {
  if (!proposal || Number(proposal.version) !== 1
    || proposal.requiresAtomicCompareAndAppend !== true
    || proposal.requiresReceiptPersistence !== true
    || proposal.executesCommand !== false
    || proposal.persistsReceipt !== false
    || proposal.mutatesServerConfiguration !== false
    || !Number.isSafeInteger(Number(proposal.expectedStoreRevision))
    || !/^[a-f0-9]{64}$/.test(String(proposal.persistenceProposalDigest || '').toLowerCase())) {
    throw new Error('Invalid Protocol receipt persistence proposal');
  }
  const expected = createReceiptPersistenceProposal(outcome, permit, handoff, snapshot, envelope, receiptState, options);
  if (JSON.stringify(canonical(proposal)) !== JSON.stringify(canonical(expected))) {
    throw new Error('Protocol receipt persistence proposal no longer matches durable executor state');
  }
  return true;
}

module.exports = {
  createReceiptPersistenceProposal,
  assertReceiptPersistenceProposal
};
