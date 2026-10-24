'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildProtocolProgressCheckpoint,
  assertProtocolProgressCheckpoint
} = require('../src/sentinel/nexus-protocol-progress-checkpoint.cjs');

function snapshot() {
  return {
    version: 1,
    revision: 7,
    updatedAt: 1_725_000_000_000,
    events: [
      {
        runId: 'alpha-01', accountId: 'acct-a', sourceId: 'join-a', type: 'presence', at: 10,
        activeMinutes: 15, objectiveContribution: 0, killContribution: 0, deathCount: 0,
        presentAtCompletion: false
      },
      {
        runId: 'alpha-01', accountId: 'acct-a', sourceId: 'objective-a', type: 'objective', at: 20,
        activeMinutes: 0, objectiveContribution: 3, killContribution: 0, deathCount: 0,
        presentAtCompletion: true, completed: true
      },
      {
        runId: 'alpha-01', accountId: 'acct-b', sourceId: 'kill-b', type: 'kill', at: 15,
        activeMinutes: 12, objectiveContribution: 0, killContribution: 2, deathCount: 1,
        presentAtCompletion: true, completed: true
      },
      {
        runId: 'other-run', accountId: 'acct-z', sourceId: 'other-z', type: 'presence', at: 5,
        activeMinutes: 99
      }
    ]
  };
}

test('binds participant scoring to an exact progress ledger revision and event history', () => {
  const checkpoint = buildProtocolProgressCheckpoint(snapshot(), 'alpha-01', {
    'acct-a': { minActiveMinutes: 10 },
    'acct-b': { minActiveMinutes: 10 }
  });
  assert.equal(checkpoint.ledgerRevision, 7);
  assert.equal(checkpoint.eventCount, 3);
  assert.deepEqual(checkpoint.participants.map((entry) => entry.accountId), ['acct-a', 'acct-b']);
  assert.equal(checkpoint.eventBindings.length, 3);
  assert.equal(assertProtocolProgressCheckpoint(checkpoint), true);
});

test('is deterministic regardless of unrelated run data placement', () => {
  const first = snapshot();
  const second = snapshot();
  second.events = [second.events[3], second.events[2], second.events[0], second.events[1]];
  const a = buildProtocolProgressCheckpoint(first, 'alpha-01');
  const b = buildProtocolProgressCheckpoint(second, 'alpha-01');
  assert.equal(a.checkpointDigest, b.checkpointDigest);
});

test('detects participant score or event-binding tampering', () => {
  const checkpoint = buildProtocolProgressCheckpoint(snapshot(), 'alpha-01');
  const scoreTamper = structuredClone(checkpoint);
  scoreTamper.participants[0].score += 50;
  assert.throws(() => assertProtocolProgressCheckpoint(scoreTamper), /integrity mismatch/i);

  const eventTamper = structuredClone(checkpoint);
  eventTamper.eventBindings[0].fingerprint = 'f'.repeat(64);
  assert.throws(() => assertProtocolProgressCheckpoint(eventTamper), /integrity mismatch/i);
});

test('fails closed when the requested run has no journal evidence', () => {
  assert.throws(() => buildProtocolProgressCheckpoint(snapshot(), 'missing-run'), /requires run events/i);
});

test('rejects duplicate event identities instead of silently collapsing checkpoint evidence', () => {
  const duplicate = snapshot();
  duplicate.events.push({ ...duplicate.events[0] });
  assert.throws(() => buildProtocolProgressCheckpoint(duplicate, 'alpha-01'), /duplicate protocol progress event/i);
});

test('rejects invalid ledger metadata before producing a checkpoint', () => {
  const invalid = snapshot();
  invalid.revision = -1;
  assert.throws(() => buildProtocolProgressCheckpoint(invalid, 'alpha-01'), /checkpoint metadata/i);
});
