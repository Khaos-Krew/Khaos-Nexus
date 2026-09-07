'use strict';

const crypto = require('node:crypto');

function cleanToken(value, label, pattern = /^[A-Za-z0-9:_-]{1,128}$/) {
  const result = String(value ?? '').trim();
  if (!pattern.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}

function receiptDigest(receipt) {
  const canonical = [
    receipt.serverId,
    receipt.protocolId,
    receipt.actionId,
    receipt.idempotencyKey || '',
    receipt.status,
    String(receipt.completedAt)
  ].join('\u001f');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function normalizeExecutorReceipt(input = {}) {
  const status = String(input.status || '').trim().toLowerCase();
  if (!['succeeded', 'failed', 'uncertain'].includes(status)) throw new Error('Invalid Protocol executor receipt status');
  const completedAt = Number(input.completedAt);
  if (!Number.isFinite(completedAt) || completedAt < 0) throw new Error('Invalid Protocol executor receipt time');
  const normalized = {
    serverId: cleanToken(input.serverId, 'server id', /^[A-Za-z0-9:_-]{2,96}$/),
    protocolId: cleanToken(input.protocolId, 'protocol id'),
    actionId: cleanToken(input.actionId, 'action id', /^[a-f0-9]{24}$/),
    idempotencyKey: input.idempotencyKey == null ? null : cleanToken(input.idempotencyKey, 'idempotency key'),
    status,
    completedAt
  };
  return Object.freeze({ ...normalized, digest: receiptDigest(normalized) });
}

function assertReceiptMatchesAction(receipt, envelope, actionIndex) {
  if (!envelope || !Array.isArray(envelope.actions)) throw new Error('Protocol execution envelope is required');
  const index = Number(actionIndex);
  if (!Number.isInteger(index) || index < 0 || index >= envelope.actions.length) throw new Error('Invalid Protocol executor action index');
  const action = envelope.actions[index];
  if (receipt.serverId !== envelope.serverId
    || receipt.protocolId !== envelope.protocolId
    || receipt.actionId !== action.actionId
    || receipt.idempotencyKey !== action.idempotencyKey) {
    throw new Error('Protocol executor receipt does not match execution action');
  }
  return true;
}

function buildReceiptIndex(receipts = []) {
  if (!Array.isArray(receipts)) throw new Error('Protocol executor receipts must be an array');
  const byActionId = new Map();
  const byIdempotencyKey = new Map();
  for (const raw of receipts) {
    const receipt = normalizeExecutorReceipt(raw);
    const existingAction = byActionId.get(receipt.actionId);
    if (existingAction && existingAction.digest !== receipt.digest) {
      throw new Error('Conflicting Protocol executor receipt replay');
    }
    byActionId.set(receipt.actionId, receipt);
    if (receipt.idempotencyKey) {
      const existingKey = byIdempotencyKey.get(receipt.idempotencyKey);
      if (existingKey && existingKey.actionId !== receipt.actionId) {
        throw new Error('Protocol executor idempotency key reused by another action');
      }
      byIdempotencyKey.set(receipt.idempotencyKey, receipt);
    }
  }
  return Object.freeze({ byActionId, byIdempotencyKey });
}

function classifyExecutionAttempt(envelope, actionIndex, receipts = []) {
  if (!envelope || !Array.isArray(envelope.actions)) throw new Error('Protocol execution envelope is required');
  const index = Number(actionIndex);
  if (!Number.isInteger(index) || index < 0 || index >= envelope.actions.length) throw new Error('Invalid Protocol executor action index');
  const action = envelope.actions[index];
  const receiptIndex = buildReceiptIndex(receipts);
  const prior = receiptIndex.byActionId.get(action.actionId)
    || (action.idempotencyKey ? receiptIndex.byIdempotencyKey.get(action.idempotencyKey) : null);
  if (!prior) return Object.freeze({ allowed: true, reason: 'new_action', prior: null });
  assertReceiptMatchesAction(prior, envelope, index);
  if (prior.status === 'failed') return Object.freeze({ allowed: true, reason: 'retry_failed_action', prior });
  if (prior.status === 'uncertain') return Object.freeze({ allowed: false, reason: 'uncertain_requires_reconciliation', prior });
  return Object.freeze({ allowed: false, reason: 'already_succeeded', prior });
}

module.exports = {
  normalizeExecutorReceipt,
  assertReceiptMatchesAction,
  buildReceiptIndex,
  classifyExecutionAttempt
};
