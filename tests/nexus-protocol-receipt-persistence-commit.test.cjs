'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { normalizeExecutorReceipt } = require('../src/sentinel/nexus-protocol-executor-receipts.cjs');
const {
  buildReceiptPersistenceCommitRecord,
  assertReceiptPersistenceCommitRecord
} = require('../src/sentinel/nexus-protocol-receipt-persistence-commit.cjs');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function fixture(status = 'succeeded') {
  const receipt = normalizeExecutorReceipt({
    serverId: 'astraeos-1',
    protocolId: 'alpha_purge',
    actionId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    idempotencyKey: 'protocol:alpha:reload:1',
    status,
    completedAt: 1200
  });
  const before = { version: 1, revision: 4, updatedAt: 1000, receipts: [] };
  const payload = {
    version: 1,
    outcomeDigest: 'b'.repeat(64),
    protocolId: receipt.protocolId,
    serverId: receipt.serverId,
    actionId: receipt.actionId,
    adapter: 'eventcountdown',
    expectedStoreRevision: before.revision,
    priorReceiptSetDigest: digest([]),
    proposedReceiptDigest: receipt.digest,
    proposedReceipt: receipt,
    requiresAtomicCompareAndAppend: true,
    requiresReceiptPersistence: true,
    executesCommand: false,
    persistsReceipt: false,
    mutatesServerConfiguration: false
  };
  const proposal = { ...payload, persistenceProposalDigest: digest(payload) };
  const after = {
    version: 1,
    revision: 5,
    updatedAt: 1300,
    receipts: [receipt]
  };
  return { receipt, proposal, before, after };
}

test('verifies an exact atomic receipt append without granting execution or retry authority', () => {
  const { proposal, before, after } = fixture();
  const record = buildReceiptPersistenceCommitRecord(proposal, before, after);

  assert.equal(record.priorStoreRevision, 4);
  assert.equal(record.committedStoreRevision, 5);
  assert.equal(record.receiptCount, 1);
  assert.equal(record.persistedStatus, 'succeeded');
  assert.equal(record.durableAppendVerified, true);
  assert.equal(record.executesCommand, false);
  assert.equal(record.mutatesServerConfiguration, false);
  assert.equal(record.grantsRetryAuthority, false);
  assert.equal(record.readOnly, true);
  assert.equal(assertReceiptPersistenceCommitRecord(record, proposal, before, after), true);
});

test('preserves uncertain outcome state through durable append verification', () => {
  const { proposal, before, after } = fixture('uncertain');
  const record = buildReceiptPersistenceCommitRecord(proposal, before, after);
  assert.equal(record.persistedStatus, 'uncertain');
  assert.equal(record.grantsRetryAuthority, false);
});

test('rejects stale revisions, non-append transitions and modified prior receipts', () => {
  const { receipt, proposal, before, after } = fixture();

  assert.throws(
    () => buildReceiptPersistenceCommitRecord(proposal, { ...before, revision: 3 }, after),
    /wrong store revision/
  );
  assert.throws(
    () => buildReceiptPersistenceCommitRecord(proposal, before, { ...after, revision: 6 }),
    /advance exactly once/
  );
  assert.throws(
    () => buildReceiptPersistenceCommitRecord(proposal, before, { ...after, receipts: [receipt, receipt] }),
    /append exactly one receipt|replay/
  );
});

test('rejects proposal and commit-record tampering', () => {
  const { proposal, before, after } = fixture();
  const record = buildReceiptPersistenceCommitRecord(proposal, before, after);

  assert.throws(
    () => buildReceiptPersistenceCommitRecord({ ...proposal, adapter: 'rewardsascended' }, before, after),
    /proposal digest mismatch/
  );
  assert.throws(
    () => assertReceiptPersistenceCommitRecord({ ...record, grantsRetryAuthority: true }, proposal, before, after),
    /Invalid Protocol receipt persistence commit record/
  );
  assert.throws(
    () => assertReceiptPersistenceCommitRecord({ ...record, receiptCount: 2 }, proposal, before, after),
    /no longer matches/
  );
});
