'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createParticipantProgressSnapshot } = require('../src/sentinel/nexus-protocol-participant-snapshot.cjs');
const { createProtocolParticipantDiscordToken } = require('../src/sentinel/nexus-protocol-participant-discord-token.cjs');
const { buildProtocolParticipantProgressView } = require('../src/sentinel/nexus-protocol-participant-progress-view.cjs');

const secret = '0123456789abcdef0123456789abcdef';

function snapshot(overrides = {}) {
  const participant = {
    runId: 'run-1',
    accountId: 'acct-1',
    activeMinutes: 20,
    objectiveContribution: 5,
    killContribution: 2,
    deaths: 1,
    completed: true,
    eligible: true,
    score: 50,
    rawScore: 50,
    processedEvents: 2,
    updatedAt: 200,
    ...overrides
  };
  const ledger = {
    revision: 9,
    events: [
      { runId: 'run-1', accountId: 'acct-1', at: 100 },
      { runId: 'run-1', accountId: 'acct-1', at: 200 }
    ]
  };
  return createParticipantProgressSnapshot(participant, ledger);
}

function tokenFor(value, now = 1_800_000_000_000) {
  return createProtocolParticipantDiscordToken(value, {
    viewerAccountId: value.accountId,
    secret,
    now
  });
}

test('builds an ephemeral account-bound participant progress view', () => {
  const snap = snapshot();
  const token = tokenFor(snap);
  const view = buildProtocolParticipantProgressView(snap, token, {
    viewerAccountId: 'acct-1', secret, now: 1_800_000_000_500
  });
  assert.equal(view.visibility, 'ephemeral');
  assert.equal(view.accountId, 'acct-1');
  assert.equal(view.ledgerRevision, 9);
  assert.equal(view.progress.activeMinutes, 20);
  assert.equal(view.scoring.score, 50);
  assert.equal(view.staleCheckRequired, true);
  assert.equal(view.authorizesMutation, false);
  assert.equal(view.rewardAuthority, false);
  assert.equal(view.mutatesPersistence, false);
  assert.equal(view.executesServerCommand, false);
});

test('ineligible progress exposes raw score only as withheld audit context', () => {
  const snap = snapshot({ eligible: false, score: 0, rawScore: 50 });
  const token = tokenFor(snap);
  const view = buildProtocolParticipantProgressView(snap, token, {
    viewerAccountId: 'acct-1', secret, now: 1_800_000_000_500
  });
  assert.equal(view.scoring.eligible, false);
  assert.equal(view.scoring.score, 0);
  assert.equal(view.scoring.rawScore, 50);
  assert.equal(view.scoring.withheldScore, 50);
});

test('cross-account and stale participant views fail closed', () => {
  const snap = snapshot();
  const token = tokenFor(snap);
  assert.throws(() => buildProtocolParticipantProgressView(snap, token, {
    viewerAccountId: 'acct-2', secret, now: 1_800_000_000_500
  }), /another account/);
  assert.throws(() => buildProtocolParticipantProgressView({ ...snap, ledgerRevision: 10 }, token, {
    viewerAccountId: 'acct-1', secret, now: 1_800_000_000_500
  }), /Invalid Protocol participant progress snapshot/);
});

test('expired participant interaction cannot build a view', () => {
  const snap = snapshot();
  const token = tokenFor(snap);
  assert.throws(() => buildProtocolParticipantProgressView(snap, token, {
    viewerAccountId: 'acct-1', secret, now: 1_800_000_301_000
  }), /expired/);
});
