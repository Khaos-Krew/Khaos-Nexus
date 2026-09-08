'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createParticipantProgressSnapshot } = require('../src/sentinel/nexus-protocol-participant-snapshot.cjs');
const {
  createProtocolParticipantDiscordToken,
  verifyProtocolParticipantDiscordToken
} = require('../src/sentinel/nexus-protocol-participant-discord-token.cjs');

const secret = 'nexus-protocol-participant-token-secret-32-bytes-minimum';

function snapshot(overrides = {}) {
  const participant = {
    runId: 'run-1', accountId: 'acct-1', activeMinutes: 15, objectiveContribution: 4,
    killContribution: 2, deaths: 1, completed: true, eligible: true, score: 42, rawScore: 42,
    processedEvents: 2, updatedAt: 200, ...(overrides.participant || {})
  };
  const ledger = {
    version: 1, revision: overrides.revision ?? 7, updatedAt: 250,
    events: [
      { runId: 'run-1', accountId: 'acct-1', at: 100 },
      { runId: 'run-1', accountId: 'acct-1', at: 200 }
    ]
  };
  return createParticipantProgressSnapshot(participant, ledger);
}

test('binds a participant progress view to its exact account and ledger snapshot', () => {
  const progress = snapshot();
  const token = createProtocolParticipantDiscordToken(progress, {
    secret, viewerAccountId: 'acct-1', now: 1_800_000_000_000, ttlMs: 60_000
  });
  const claims = verifyProtocolParticipantDiscordToken(token, progress, {
    secret, viewerAccountId: 'acct-1', now: 1_800_000_030_000
  });
  assert.equal(claims.purpose, 'participant_progress_view');
  assert.equal(claims.accountId, 'acct-1');
  assert.equal(claims.runId, 'run-1');
  assert.equal(claims.ledgerRevision, 7);
  assert.equal(claims.readOnly, true);
  assert.equal(claims.authorizesMutation, false);
  assert.equal(claims.rewardAuthority, false);
  assert.equal(claims.mutatesPersistence, false);
});

test('refuses to issue or verify a participant token for another account', () => {
  const progress = snapshot();
  assert.throws(() => createProtocolParticipantDiscordToken(progress, {
    secret, viewerAccountId: 'acct-2', now: 1_800_000_000_000
  }), /owning account/);
  const token = createProtocolParticipantDiscordToken(progress, {
    secret, viewerAccountId: 'acct-1', now: 1_800_000_000_000
  });
  assert.throws(() => verifyProtocolParticipantDiscordToken(token, progress, {
    secret, viewerAccountId: 'acct-2', now: 1_800_000_001_000
  }), /another account/);
});

test('stale participant progress invalidates an otherwise valid Discord token', () => {
  const progress = snapshot();
  const token = createProtocolParticipantDiscordToken(progress, {
    secret, viewerAccountId: 'acct-1', now: 1_800_000_000_000
  });
  const changed = snapshot({ revision: 8 });
  assert.throws(() => verifyProtocolParticipantDiscordToken(token, changed, {
    secret, viewerAccountId: 'acct-1', now: 1_800_000_001_000
  }), /stale for current progress snapshot/);
});

test('forged and expired participant progress tokens fail closed', () => {
  const progress = snapshot();
  const token = createProtocolParticipantDiscordToken(progress, {
    secret, viewerAccountId: 'acct-1', now: 1_800_000_000_000, ttlMs: 1_000
  });
  const [body] = token.split('.');
  assert.throws(() => verifyProtocolParticipantDiscordToken(`${body}.forged`, progress, {
    secret, viewerAccountId: 'acct-1', now: 1_800_000_000_500
  }), /signature mismatch/);
  assert.throws(() => verifyProtocolParticipantDiscordToken(token, progress, {
    secret, viewerAccountId: 'acct-1', now: 1_800_000_002_000
  }), /expired/);
});

test('weak secrets and tampered participant snapshots are rejected', () => {
  const progress = snapshot();
  assert.throws(() => createProtocolParticipantDiscordToken(progress, {
    secret: 'short', viewerAccountId: 'acct-1', now: 1_800_000_000_000
  }), /at least 32 bytes/);
  assert.throws(() => createProtocolParticipantDiscordToken({ ...progress, score: 99 }, {
    secret, viewerAccountId: 'acct-1', now: 1_800_000_000_000
  }), /Invalid Protocol participant progress snapshot/);
});
