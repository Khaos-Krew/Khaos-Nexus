'use strict';

const { DEFAULT_RANK_GROUPS } = require('./ark-permission-rank-sync.cjs');

const TIMED_POINT_INTERVAL_MINUTES = 5;
const RANK_TIMED_POINT_AMOUNTS = Object.freeze({
  'shadow-recruit': 2,
  'cipher-runner': 4,
  'nexus-raider': 4,
  'khaos-warden': 4,
  'blackout-legend': 4,
  'origin-founder': 4
});

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function timedRewardGroups(currentGroups = {}, rankGroups = DEFAULT_RANK_GROUPS) {
  const groups = clone(currentGroups || {});
  groups.Default = { ...(groups.Default || {}), Amount: RANK_TIMED_POINT_AMOUNTS['shadow-recruit'] };
  // Retain the legacy group while the server moves to explicit Nexus rank groups.
  groups.Premiums = { ...(groups.Premiums || {}), Amount: RANK_TIMED_POINT_AMOUNTS['cipher-runner'] };
  for (const [rankId, groupName] of Object.entries(rankGroups)) {
    groups[groupName] = { ...(groups[groupName] || {}), Amount: RANK_TIMED_POINT_AMOUNTS[rankId] };
  }
  return groups;
}

function withRankTimedRewards(profileData = {}, rankGroups = DEFAULT_RANK_GROUPS) {
  const next = clone(profileData || {});
  next.General ||= {};
  const current = next.General.TimedPointsReward || {};
  next.General.TimedPointsReward = {
    ...current,
    Enabled: true,
    Interval: TIMED_POINT_INTERVAL_MINUTES,
    Groups: timedRewardGroups(current.Groups, rankGroups)
  };
  return next;
}

function hasRankTimedRewards(profileOrConfig = {}, rankGroups = DEFAULT_RANK_GROUPS) {
  const timed = profileOrConfig?.data?.General?.TimedPointsReward || profileOrConfig?.General?.TimedPointsReward;
  if (!timed || timed.Enabled !== true || Number(timed.Interval) !== TIMED_POINT_INTERVAL_MINUTES) return false;
  return Object.entries(rankGroups).every(([rankId, groupName]) =>
    Number(timed.Groups?.[groupName]?.Amount) === RANK_TIMED_POINT_AMOUNTS[rankId]
  ) && Number(timed.Groups?.Default?.Amount) === RANK_TIMED_POINT_AMOUNTS['shadow-recruit'];
}

function timedPointsPerHour(rankId) {
  const amount = Number(RANK_TIMED_POINT_AMOUNTS[rankId]);
  return Number.isFinite(amount) ? Math.floor(60 / TIMED_POINT_INTERVAL_MINUTES) * amount : 0;
}

module.exports = {
  TIMED_POINT_INTERVAL_MINUTES,
  RANK_TIMED_POINT_AMOUNTS,
  timedRewardGroups,
  withRankTimedRewards,
  hasRankTimedRewards,
  timedPointsPerHour
};
