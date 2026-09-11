'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSeasonScoreSeal } = require('../src/sentinel/nexus-protocol-score-seal.cjs');
const { buildSeasonRewardPlans, normalizeRewardTiers } = require('../src/sentinel/nexus-protocol-season-rewards.cjs');

const season = { id: 'season-1', status: 'closed', endsAt: 1000 };
const leaderboard = [
  { rank: 1, accountId: 'acct-a', score: 900, runs: 5 },
  { rank: 2, accountId: 'acct-b', score: 700, runs: 4 },
  { rank: 3, accountId: 'acct-c', score: 500, runs: 3 }
];

function seal() {
  return createSeasonScoreSeal(season, leaderboard, { storeRevision: 12, closedAt: 1000 });
}

test('season reward planner requires a valid closed-season seal', () => {
  const valid = seal();
  const tampered = { ...valid, entries: valid.entries.map((entry, index) => index === 0 ? { ...entry, score: 9999 } : entry) };
  assert.throws(() => buildSeasonRewardPlans(tampered, {}, {
    tiers: [{ maxRank: 1, rewardId: 'winner' }]
  }), /seal is invalid/i);
});

test('season reward planner produces dry-run RewardsAscended plans only', () => {
  const result = buildSeasonRewardPlans(seal(), {
    'acct-a': 'EOS_AAAA',
    'acct-b': 'EOS_BBBB',
    'acct-c': 'EOS_CCCC'
  }, {
    createdAt: 1200,
    tiers: [
      { maxRank: 1, rewardId: 'gold' },
      { maxRank: 3, rewardId: 'podium' }
    ]
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.plans.length, 3);
  assert.equal(result.plans[0].rewardId, 'gold');
  assert.equal(result.plans[1].rewardId, 'podium');
  assert.equal(result.plans[0].plan.dryRun, true);
  assert.equal(result.plans[0].plan.actions[0].plugin, 'RewardsAscended');
  assert.equal(result.plans[0].plan.actions[0].command, 'RA.Reward EOS_AAAA gold');
});

test('season reward planner fails closed per recipient without inventing an EOS target', () => {
  const result = buildSeasonRewardPlans(seal(), {
    'acct-a': 'EOS_AAAA',
    'acct-b': 'bad value'
  }, {
    tiers: [{ maxRank: 3, rewardId: 'season-reward' }]
  });
  assert.equal(result.plans.length, 1);
  assert.deepEqual(result.skipped.map((entry) => entry.accountId), ['acct-b', 'acct-c']);
  assert.ok(result.skipped.every((entry) => entry.reason === 'missing_or_invalid_eos'));
});

test('reward tiers must be strictly increasing and use safe reward ids', () => {
  assert.throws(() => normalizeRewardTiers([
    { maxRank: 3, rewardId: 'podium' },
    { maxRank: 3, rewardId: 'duplicate' }
  ]), /ranks must increase/i);
  assert.throws(() => normalizeRewardTiers([{ maxRank: 1, rewardId: 'bad reward' }]), /invalid reward id/i);
});
