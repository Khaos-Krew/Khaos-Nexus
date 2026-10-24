'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  protocolExecutionPlan,
  buildExecutionEnvelope
} = require('../src/sentinel/nexus-protocol-executors.cjs');
const {
  normalizeExecutorReceipt,
  assertReceiptMatchesAction,
  buildReceiptIndex,
  classifyExecutionAttempt
} = require('../src/sentinel/nexus-protocol-executor-receipts.cjs');

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

test('executor receipts bind to the exact server, protocol, action, and idempotency key', () => {
  const target = envelope();
  const receipt = receiptFor(target);
  assert.equal(assertReceiptMatchesAction(receipt, target, 0), true);
  assert.throws(() => assertReceiptMatchesAction({ ...receipt, serverId: 'astraeos-1' }, target, 0), /does not match/);
});

test('successful receipt blocks replay of the same destructive action', () => {
  const target = envelope();
  const result = classifyExecutionAttempt(target, 0, [receiptFor(target)]);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'already_succeeded');
});

test('failed receipts permit a controlled retry but uncertain receipts require reconciliation', () => {
  const target = envelope();
  const failed = classifyExecutionAttempt(target, 0, [receiptFor(target, { status: 'failed' })]);
  const uncertain = classifyExecutionAttempt(target, 0, [receiptFor(target, { status: 'uncertain' })]);
  assert.equal(failed.allowed, true);
  assert.equal(failed.reason, 'retry_failed_action');
  assert.equal(uncertain.allowed, false);
  assert.equal(uncertain.reason, 'uncertain_requires_reconciliation');
});

test('new actions are allowed when no receipt exists', () => {
  const target = envelope();
  const result = classifyExecutionAttempt(target, 0, []);
  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'new_action');
});

test('receipt index rejects conflicting replay payloads for one action', () => {
  const target = envelope();
  const first = receiptFor(target, { status: 'succeeded', completedAt: 1200 });
  const conflicting = receiptFor(target, { status: 'failed', completedAt: 1300 });
  assert.throws(() => buildReceiptIndex([first, conflicting]), /Conflicting Protocol executor receipt replay/);
});

test('receipt index rejects reuse of one idempotency key by another action', () => {
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
  assert.throws(() => buildReceiptIndex([first, second]), /idempotency key reused/);
});
