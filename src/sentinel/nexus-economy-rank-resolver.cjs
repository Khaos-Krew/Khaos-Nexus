const RANK_PRIORITY = [
  'origin-founder',
  'blackout-legend',
  'khaos-warden',
  'nexus-raider',
  'cipher-runner',
  'shadow-recruit',
];

function normalizeRankId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function resolveHighestRank(memberRanks = []) {
  const held = new Set(
    (Array.isArray(memberRanks) ? memberRanks : [])
      .map(normalizeRankId)
      .filter(Boolean),
  );

  return RANK_PRIORITY.find((rankId) => held.has(rankId)) || 'shadow-recruit';
}

module.exports = {
  RANK_PRIORITY,
  normalizeRankId,
  resolveHighestRank,
};
