'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createParticipantProgressSnapshot,
  verifyParticipantProgressSnapshot
} = require('../src/sentinel/nexus-protocol-participant-snapshot.cjs');

function participant(overrides = {}) {
  return {
    runId: 'run-1',
    accountId: 'acct-1',
    activeMinutes: 15,
    objectiveContribution: 4,
    killContribution: 2,
    deaths: 1,
    completed: true,
    eligible: true,
    score: 42,
    rawScore: 42,
    processedEvents: 2,
    updatedAt: 200,
    ...overrides
  };
}

function ledger(overrides = {}) {
  return {
    version: 1,
    revision: 7,
    updatedAt: 250,
    events: [
      { runId: 'run-1', accountId: 'acct-1', at: 100 },
      { runId: 'run-1', accountId: 'acct-1', at: 200 },
      { runId: 'run-other', accountId: 'acct-other', at: 220 }
    ],
    ...overrides
  };
}

test('creates a read-only integrity-bound participant progress snapshot', () => {
  const snapshot = createParticipantProgressSnapshot(participant(), ledger());
  assert.equal(snapshot.ledgerRevision, 7);
  assert.equal(snapshot.processedEvents, 2);
  assert.equal(snapshot.readOnly, true);
  assert.equal(snapshot.rewardAuthority, false);
  assert.equal(snapshot.mutatesPersistence, false);
  assert.equal(verifyParticipantProgressSnapshot(snapshot), true);
});

test('detects participant snapshot tampering', () => {
  const snapshot = createParticipantProgressSnapshot(participant(), ledger());
  assert.equal(verifyParticipantProgressSnapshot({ ...snapshot, score: snapshot.score + 1 }), false);
  assert.equal(verifyParticipantProgressSnapshot({ ...snapshot, ledgerRevision: 8 }), false);
});

test('fails closed when persisted event count or update time disagrees', () => {
  assert.throws(() => createParticipantProgressSnapshot(participant({ processedEvents: 1 }), ledger()), /event count mismatch/);
  assert.throws(() => createParticipantProgressSnapshot(participant({ updatedAt: 199 }), ledger()), /update time mismatch/);
});

test('does not allow awarded score on an ineligible participant snapshot', () => {
  assert.throws(() => createParticipantProgressSnapshot(participant({ eligible: false, score: 10 }), ledger()), /cannot carry awarded score/);
  const snapshot = createParticipantProgressSnapshot(participant({ eligible: false, score: 0, rawScore: 42 }), ledger());
  assert.equal(snapshot.score, 0);
  assert.equal(snapshot.rawScore, 42);
  assert.equal(verifyParticipantProgressSnapshot(snapshot), true);
});
