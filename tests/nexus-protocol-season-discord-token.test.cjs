'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createProtocolSeasonDiscordToken,
  verifyProtocolSeasonDiscordToken,
  snapshotDigest
} = require('../src/sentinel/nexus-protocol-season-discord-token.cjs');

const secret = 'nexus-protocol-season-discord-secret-1234567890';

function model(overrides = {}) {
  return {
    version: 1,
    seasonId: 'season-1',
    seasonName: 'Season One',
    status: 'active',
    storeRevision: 12,
    checkpointCount: 2,
    eventCount: 13,
    participantCount: 5,
    scoreFinalized: false,
    leaderboard: [],
    rewardPlanningEligible: false,
    executesRewards: false,
    mutatesPersistence: false,
    readOnly: true,
    ...overrides
  };
}

test('Discord season token binds the exact read-only snapshot', () => {
  const current = model();
  const token = createProtocolSeasonDiscordToken(current, { secret, now: 1_800_000_000_000 });
  const claims = verifyProtocolSeasonDiscordToken(token, current, { secret, now: 1_800_000_000_500 });
  assert.equal(claims.seasonId, 'season-1');
  assert.equal(claims.storeRevision, 12);
  assert.equal(claims.snapshotDigest, snapshotDigest(current));
  assert.equal(claims.readOnly, true);
  assert.equal(claims.authorizesMutation, false);
  assert.equal(claims.executesRewards, false);
});

test('token fails closed when persisted season revision advances', () => {
  const current = model();
  const token = createProtocolSeasonDiscordToken(current, { secret, now: 1_800_000_000_000 });
  assert.throws(() => verifyProtocolSeasonDiscordToken(token, model({ storeRevision: 13 }), {
    secret, now: 1_800_000_000_500
  }), /stale for current season snapshot/);
});

test('token fails closed when Protocol Score leaderboard changes at same revision', () => {
  const closed = model({
    status: 'closed', scoreFinalized: true,
    leaderboard: [{ rank: 1, accountId: 'acct1', score: 120, runs: 2 }]
  });
  const token = createProtocolSeasonDiscordToken(closed, { secret, now: 1_800_000_000_000 });
  const changed = model({
    status: 'closed', scoreFinalized: true,
    leaderboard: [{ rank: 1, accountId: 'acct1', score: 121, runs: 2 }]
  });
  assert.throws(() => verifyProtocolSeasonDiscordToken(token, changed, {
    secret, now: 1_800_000_000_500
  }), /stale for current season snapshot/);
});

test('expired and forged tokens fail closed', () => {
  const current = model();
  const token = createProtocolSeasonDiscordToken(current, { secret, now: 1_800_000_000_000, ttlMs: 1000 });
  assert.throws(() => verifyProtocolSeasonDiscordToken(token, current, {
    secret, now: 1_800_000_002_000
  }), /expired/);
  const forged = `${token.slice(0, -1)}x`;
  assert.throws(() => verifyProtocolSeasonDiscordToken(forged, current, {
    secret, now: 1_800_000_000_500
  }), /signature mismatch/);
});

test('unsafe models and weak secrets are rejected', () => {
  assert.throws(() => createProtocolSeasonDiscordToken(model({ readOnly: false }), {
    secret, now: 1_800_000_000_000
  }), /Invalid Protocol season read model/);
  assert.throws(() => createProtocolSeasonDiscordToken(model(), {
    secret: 'short', now: 1_800_000_000_000
  }), /at least 32 bytes/);
});
