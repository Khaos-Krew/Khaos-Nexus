'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalLeaderboard,
  createSeasonScoreSeal,
  verifySeasonScoreSeal
} = require('../src/sentinel/nexus-protocol-score-seal.cjs');

const closedSeason = {
  id: 'season_01',
  name: 'Season 01',
  startsAt: 100,
  endsAt: 200,
  status: 'closed'
};

const leaderboard = [
  { rank: 1, accountId: 'acct_a', score: 500, runs: 4 },
  { rank: 2, accountId: 'acct_b', score: 420, runs: 5 }
];

test('closed season leaderboard can be sealed and verified deterministically', () => {
  const first = createSeasonScoreSeal(closedSeason, leaderboard, { storeRevision: 12, closedAt: 200 });
  const second = createSeasonScoreSeal(closedSeason, [...leaderboard].reverse(), { storeRevision: 12, closedAt: 200 });
  assert.equal(first.digest, second.digest);
  assert.equal(verifySeasonScoreSeal(first), true);
});

test('Protocol Score seal rejects post-close score tampering', () => {
  const seal = createSeasonScoreSeal(closedSeason, leaderboard, { storeRevision: 12, closedAt: 200 });
  const tampered = {
    ...seal,
    entries: seal.entries.map((entry) => entry.accountId === 'acct_b' ? { ...entry, score: 9999 } : entry)
  };
  assert.equal(verifySeasonScoreSeal(tampered), false);
});

test('Protocol Score seal rejects malformed digest without throwing', () => {
  const seal = createSeasonScoreSeal(closedSeason, leaderboard, { storeRevision: 12, closedAt: 200 });
  assert.equal(verifySeasonScoreSeal({ ...seal, digest: 'z'.repeat(64) }), false);
  assert.equal(verifySeasonScoreSeal({ ...seal, digest: 'abc' }), false);
});

test('only closed seasons may be sealed', () => {
  assert.throws(
    () => createSeasonScoreSeal({ ...closedSeason, status: 'active' }, leaderboard, { storeRevision: 12 }),
    /closed season/
  );
});

test('duplicate accounts or ranks fail closed before a season seal is created', () => {
  assert.throws(() => canonicalLeaderboard([
    { rank: 1, accountId: 'acct_a', score: 10, runs: 1 },
    { rank: 2, accountId: 'acct_a', score: 20, runs: 2 }
  ]), /Duplicate Protocol Score account/);
  assert.throws(() => canonicalLeaderboard([
    { rank: 1, accountId: 'acct_a', score: 10, runs: 1 },
    { rank: 1, accountId: 'acct_b', score: 20, runs: 2 }
  ]), /Duplicate Protocol Score rank/);
});
