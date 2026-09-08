'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  protocolExecutionPlan,
  buildExecutionEnvelope
} = require('../src/sentinel/nexus-protocol-executors.cjs');
const {
  normalizeExecutorReceipt
} = require('../src/sentinel/nexus-protocol-executor-receipts.cjs');
const {
  NexusProtocolExecutorReceiptStore,
  normalizeReceiptState
} = require('../src/sentinel/nexus-protocol-executor-receipt-store.cjs');

function envelope() {
  const plan = protocolExecutionPlan({
    protocolId: 'alpha_purge',
    reward: { eosId: 'EOS_ABC123', rewardId: 'alpha_reward' },
    createdAt: 1000,
    dryRun: false
  });
  return buildExecutionEnvelope(plan, {
    serverId: 'gen1-1',
    idempotencyKey: 'alpha_purge:run_123'
  });
}

function receiptFor(target, overrides = {}) {
  const action = target.actions[0];
  return normalizeExecutorReceipt({
    serverId: target.serverId,
    protocolId: target.protocolId,
    actionId: action.actionId,
    idempotencyKey: action.idempotencyKey,
    status: 'succeeded',
    completedAt: 1200,
    ...overrides
  });
}

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-protocol-receipts-'));
  return { dir, file: path.join(dir, 'receipts.json') };
}

test('executor receipt store survives restart and continues blocking successful replay', () => {
  const target = envelope();
  const { dir, file } = tempStore();
  try {
    const first = new NexusProtocolExecutorReceiptStore(file);
    first.append(receiptFor(target));
    first.save(1300);

    const second = new NexusProtocolExecutorReceiptStore(file);
    const loaded = second.load();
    assert.equal(loaded.receipts.length, 1);
    assert.equal(loaded.revision, 1);
    const replay = second.classify(target, 0);
    assert.equal(replay.allowed, false);
    assert.equal(replay.reason, 'already_succeeded');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('uncertain receipt remains quarantined after restart while failed receipt remains retryable', () => {
  const target = envelope();
  const uncertainPath = tempStore();
  const failedPath = tempStore();
  try {
    const uncertain = new NexusProtocolExecutorReceiptStore(uncertainPath.file);
    uncertain.append(receiptFor(target, { status: 'uncertain' }));
    uncertain.save(1300);
    const uncertainReloaded = new NexusProtocolExecutorReceiptStore(uncertainPath.file);
    uncertainReloaded.load();
    assert.equal(uncertainReloaded.classify(target, 0).reason, 'uncertain_requires_reconciliation');

    const failed = new NexusProtocolExecutorReceiptStore(failedPath.file);
    failed.append(receiptFor(target, { status: 'failed' }));
    failed.save(1300);
    const failedReloaded = new NexusProtocolExecutorReceiptStore(failedPath.file);
    failedReloaded.load();
    const retry = failedReloaded.classify(target, 0);
    assert.equal(retry.allowed, true);
    assert.equal(retry.reason, 'retry_failed_action');
  } finally {
    fs.rmSync(uncertainPath.dir, { recursive: true, force: true });
    fs.rmSync(failedPath.dir, { recursive: true, force: true });
  }
});

test('receipt store rejects conflicting replay both during append and persisted load', () => {
  const target = envelope();
  const { dir, file } = tempStore();
  try {
    const store = new NexusProtocolExecutorReceiptStore(file);
    store.append(receiptFor(target));
    assert.throws(() => store.append(receiptFor(target, { status: 'failed', completedAt: 1400 })), /Conflicting/);

    const first = receiptFor(target);
    const conflicting = receiptFor(target, { status: 'failed', completedAt: 1400 });
    fs.writeFileSync(file, JSON.stringify({
      version: 1,
      revision: 3,
      updatedAt: 1500,
      receipts: [first, conflicting]
    }));
    assert.throws(() => new NexusProtocolExecutorReceiptStore(file).load(), /Conflicting/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('receipt store writes restrictive atomic state and deduplicates exact replay', () => {
  const target = envelope();
  const { dir, file } = tempStore();
  try {
    const store = new NexusProtocolExecutorReceiptStore(file);
    const first = store.append(receiptFor(target));
    const duplicate = store.append(receiptFor(target));
    assert.deepEqual(duplicate, first);
    store.save(1300);
    assert.equal(store.snapshot().receipts.length, 1);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('compare-and-append persists only when the expected receipt-store revision still matches', () => {
  const target = envelope();
  const { dir, file } = tempStore();
  try {
    const store = new NexusProtocolExecutorReceiptStore(file);
    const committed = store.compareAndAppend(0, receiptFor(target), 1300);
    assert.equal(committed.appended, true);
    assert.equal(committed.duplicate, false);
    assert.equal(committed.state.revision, 1);
    assert.equal(committed.state.receipts.length, 1);

    const reloaded = new NexusProtocolExecutorReceiptStore(file);
    assert.equal(reloaded.load().revision, 1);
    assert.equal(reloaded.snapshot().receipts.length, 1);

    assert.throws(
      () => store.compareAndAppend(0, receiptFor(target, { status: 'failed', completedAt: 1400 }), 1500),
      /revision changed/
    );
    assert.equal(store.snapshot().revision, 1);
    assert.equal(store.snapshot().receipts[0].status, 'succeeded');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('compare-and-append treats exact replay as idempotent without advancing the store revision', () => {
  const target = envelope();
  const { dir, file } = tempStore();
  try {
    const store = new NexusProtocolExecutorReceiptStore(file);
    store.compareAndAppend(0, receiptFor(target), 1300);
    const replay = store.compareAndAppend(1, receiptFor(target), 1400);
    assert.equal(replay.appended, false);
    assert.equal(replay.duplicate, true);
    assert.equal(replay.state.revision, 1);
    assert.equal(replay.state.updatedAt, 1300);
    assert.equal(replay.state.receipts.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('compare-and-append validates the full receipt before writing durable state', () => {
  const target = envelope();
  const { dir, file } = tempStore();
  try {
    const store = new NexusProtocolExecutorReceiptStore(file);
    assert.throws(() => store.compareAndAppend(-1, receiptFor(target), 1300), /expected revision/);
    assert.equal(fs.existsSync(file), false);
    assert.equal(store.snapshot().revision, 0);
    assert.equal(store.snapshot().receipts.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('receipt normalization rejects unsupported store versions and cross-action idempotency reuse', () => {
  assert.throws(() => normalizeReceiptState({ version: 2, receipts: [] }), /Unsupported/);
  const target = envelope();
  const first = receiptFor(target);
  const second = normalizeExecutorReceipt({
    serverId: target.serverId,
    protocolId: target.protocolId,
    actionId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    idempotencyKey: first.idempotencyKey,
    status: 'succeeded',
    completedAt: 1250
  });
  assert.throws(() => normalizeReceiptState({ version: 1, receipts: [first, second] }), /idempotency key reused/);
});
