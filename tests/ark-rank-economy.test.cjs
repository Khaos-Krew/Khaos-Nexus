'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_RANK_GROUPS } = require('../src/sentinel/ark-permission-rank-sync.cjs');
const {
  RANK_TIMED_POINT_AMOUNTS,
  withRankTimedRewards,
  hasRankTimedRewards,
  timedPointsPerHour
} = require('../src/sentinel/ark-rank-economy.cjs');

test('ArkShop timed payouts directly recognize every Nexus Permissions rank group', () => {
  const data = withRankTimedRewards({ General: { TimedPointsReward: { StackRewards: true, Groups: { Existing: { Amount: 9 } } } } });
  assert.equal(data.General.TimedPointsReward.Enabled, true);
  assert.equal(data.General.TimedPointsReward.Interval, 5);
  assert.equal(data.General.TimedPointsReward.StackRewards, true);
  assert.equal(data.General.TimedPointsReward.Groups.Existing.Amount, 9);
  for (const [rankId, group] of Object.entries(DEFAULT_RANK_GROUPS)) {
    assert.equal(data.General.TimedPointsReward.Groups[group].Amount, RANK_TIMED_POINT_AMOUNTS[rankId]);
  }
  assert.equal(hasRankTimedRewards(data), true);
});

test('Shadow Recruit earns 24 NP/hour and paid/Founder ranks earn 48 NP/hour', () => {
  assert.equal(timedPointsPerHour('shadow-recruit'), 24);
  for (const rankId of ['cipher-runner', 'nexus-raider', 'khaos-warden', 'blackout-legend', 'origin-founder']) {
    assert.equal(timedPointsPerHour(rankId), 48);
  }
});
