'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  protocolExecutionPlan,
  buildExecutionEnvelope,
  validateExecutionEnvelope
} = require('../src/sentinel/nexus-protocol-executors.cjs');
const {
  signExecutionEnvelope,
  verifyExecutionEnvelopeSignature
} = require('../src/sentinel/nexus-protocol-executor-auth.cjs');

const SECRET = 'nexus-protocol-test-signing-secret-0001';

function envelope() {
  const plan = protocolExecutionPlan({
    protocolId: 'dark_zone',
    createdAt: 1_000_000,
    dryRun: false,
    ratePreset: 'dark_zone',
    reward: { eosId: 'EOS_PLAYER_1234', rewardId: 'dz_reward' }
  });
  return buildExecutionEnvelope(plan, {
    serverId: 'gen1',
    idempotencyKey: 'protocol:run:001'
  });
}

test('signed execution envelope verifies after normal executor validation', () => {
  const value = envelope();
  assert.equal(validateExecutionEnvelope(value, { serverId: 'gen1', now: 1_000_100 }), true);
  const signed = signExecutionEnvelope(value, SECRET);
  assert.equal(verifyExecutionEnvelopeSignature(signed, SECRET), true);
});

test('command tampering invalidates the executor signature', () => {
  const value = envelope();
  const signed = signExecutionEnvelope(value, SECRET);
  const tampered = {
    ...signed,
    envelope: {
      ...signed.envelope,
      actions: signed.envelope.actions.map((action, index) => index === 0
        ? { ...action, command: 'changerates surprise' }
        : action)
    }
  };
  assert.throws(() => verifyExecutionEnvelopeSignature(tampered, SECRET), /signature mismatch/);
});

test('signature cannot be replayed against a different target server', () => {
  const signed = signExecutionEnvelope(envelope(), SECRET);
  const tampered = { ...signed, envelope: { ...signed.envelope, serverId: 'astraeos' } };
  assert.throws(() => verifyExecutionEnvelopeSignature(tampered, SECRET), /signature mismatch/);
});

test('weak signing secrets fail closed', () => {
  assert.throws(() => signExecutionEnvelope(envelope(), 'short'), /at least 32 bytes/);
});
