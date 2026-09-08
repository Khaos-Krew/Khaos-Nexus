'use strict';

const crypto = require('node:crypto');
const { normalizeReceiptState } = require('./nexus-protocol-executor-receipt-store.cjs');
const { normalizeExecutorReceipt } = require('./nexus-protocol-executor-receipts.cjs');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function assertProposalIntegrity(proposal) {
  if (!proposal || Number(proposal.version) !== 1
    || proposal.requiresAtomicCompareAndAppend !== true
    || proposal.requiresReceiptPersistence !== true
    || proposal.executesCommand !== false
    || proposal.persistsReceipt !== false
    || proposal.mutatesServerConfiguration !== false
    || !Number.isSafeInteger(Number(proposal.expectedStoreRevision))
    || !/^[a-f0-9]{64}$/.test(String(proposal.persistenceProposalDigest || '').toLowerCase())) {
    throw new Error('Invalid Protocol receipt persistence proposal for commit verification');
  }
  const { persistenceProposalDigest, ...payload } = proposal;
  if (digest(payload) !== String(persistenceProposalDigest).toLowerCase()) {
    throw new Error('Protocol receipt persistence proposal digest mismatch');
  }
  return true;
}

function buildReceiptPersistenceCommitRecord(proposal, beforeState, afterState) {
  assertProposalIntegrity(proposal);
  const before = normalizeReceiptState(beforeState);
  const after = normalizeReceiptState(afterState);
  const proposedReceipt = normalizeExecutorReceipt(proposal.proposedReceipt);

  if (before.revision !== Number(proposal.expectedStoreRevision)) {
    throw new Error('Protocol receipt persistence commit started from the wrong store revision');
  }
  if (digest(before.receipts.map((receipt) => receipt.digest)) !== proposal.priorReceiptSetDigest) {
    throw new Error('Protocol receipt persistence commit prior receipt set changed');
  }
  if (proposedReceipt.digest !== proposal.proposedReceiptDigest) {
    throw new Error('Protocol receipt persistence commit proposed receipt digest mismatch');
  }
  if (after.revision !== before.revision + 1) {
    throw new Error('Protocol receipt persistence commit revision did not advance exactly once');
  }
  if (after.receipts.length !== before.receipts.length + 1) {
    throw new Error('Protocol receipt persistence commit must append exactly one receipt');
  }
  if (after.updatedAt < before.updatedAt) {
    throw new Error('Protocol receipt persistence commit time moved backwards');
  }

  for (let index = 0; index < before.receipts.length; index += 1) {
    if (before.receipts[index].digest !== after.receipts[index].digest) {
      throw new Error('Protocol receipt persistence commit modified prior durable receipts');
    }
  }
  const persistedReceipt = after.receipts[after.receipts.length - 1];
  if (persistedReceipt.digest !== proposedReceipt.digest) {
    throw new Error('Protocol receipt persistence commit appended a different receipt');
  }

  const payload = {
    version: 1,
    persistenceProposalDigest: String(proposal.persistenceProposalDigest).toLowerCase(),
    protocolId: proposal.protocolId,
    serverId: proposal.serverId,
    actionId: proposal.actionId,
    adapter: proposal.adapter,
    priorStoreRevision: before.revision,
    committedStoreRevision: after.revision,
    persistedReceiptDigest: persistedReceipt.digest,
    persistedStatus: persistedReceipt.status,
    receiptCount: after.receipts.length,
    durableAppendVerified: true,
    executesCommand: false,
    mutatesServerConfiguration: false,
    grantsRetryAuthority: false,
    readOnly: true
  };
  return Object.freeze({ ...payload, persistenceCommitDigest: digest(payload) });
}

function assertReceiptPersistenceCommitRecord(record, proposal, beforeState, afterState) {
  if (!record || Number(record.version) !== 1
    || record.durableAppendVerified !== true
    || record.executesCommand !== false
    || record.mutatesServerConfiguration !== false
    || record.grantsRetryAuthority !== false
    || record.readOnly !== true
    || !/^[a-f0-9]{64}$/.test(String(record.persistenceCommitDigest || '').toLowerCase())) {
    throw new Error('Invalid Protocol receipt persistence commit record');
  }
  const expected = buildReceiptPersistenceCommitRecord(proposal, beforeState, afterState);
  if (JSON.stringify(canonical(record)) !== JSON.stringify(canonical(expected))) {
    throw new Error('Protocol receipt persistence commit record no longer matches durable store transition');
  }
  return true;
}

module.exports = {
  buildReceiptPersistenceCommitRecord,
  assertReceiptPersistenceCommitRecord
};
