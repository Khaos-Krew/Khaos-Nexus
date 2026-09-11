'use strict';

const crypto = require('node:crypto');

function cleanId(value, label) {
  const result = String(value ?? '').trim();
  if (!/^[A-Za-z0-9:_-]{1,96}$/.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}

function finiteNonNegative(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid ${label}`);
  return number;
}

function canonicalLeaderboard(entries = []) {
  if (!Array.isArray(entries)) throw new Error('Protocol leaderboard must be an array');
  const normalized = entries.map((entry, index) => ({
    rank: Math.max(1, Math.floor(finiteNonNegative(entry.rank ?? index + 1, 'leaderboard rank'))),
    accountId: cleanId(entry.accountId, 'account id'),
    score: Math.floor(finiteNonNegative(entry.score, 'protocol score')),
    runs: Math.floor(finiteNonNegative(entry.runs, 'protocol run count'))
  })).sort((a, b) => a.rank - b.rank || a.accountId.localeCompare(b.accountId));

  const accounts = new Set();
  const ranks = new Set();
  for (const entry of normalized) {
    if (accounts.has(entry.accountId)) throw new Error('Duplicate Protocol Score account');
    if (ranks.has(entry.rank)) throw new Error('Duplicate Protocol Score rank');
    accounts.add(entry.accountId);
    ranks.add(entry.rank);
  }
  return normalized;
}

function scoreSealDigest(input) {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function createSeasonScoreSeal(season, leaderboard, options = {}) {
  if (!season || season.status !== 'closed') throw new Error('Protocol Score can only be sealed for a closed season');
  const seasonId = cleanId(season.id, 'season id');
  const closedAt = finiteNonNegative(options.closedAt ?? season.endsAt, 'season close time');
  const revision = Math.floor(finiteNonNegative(options.storeRevision, 'store revision'));
  const entries = canonicalLeaderboard(leaderboard);
  const payload = {
    version: 1,
    seasonId,
    closedAt,
    storeRevision: revision,
    entries
  };
  return Object.freeze({
    ...payload,
    digest: scoreSealDigest(payload)
  });
}

function verifySeasonScoreSeal(seal) {
  if (!seal || Number(seal.version) !== 1 || !/^[a-f0-9]{64}$/i.test(String(seal.digest || ''))) return false;
  let normalized;
  try {
    normalized = {
      version: 1,
      seasonId: cleanId(seal.seasonId, 'season id'),
      closedAt: finiteNonNegative(seal.closedAt, 'season close time'),
      storeRevision: Math.floor(finiteNonNegative(seal.storeRevision, 'store revision')),
      entries: canonicalLeaderboard(seal.entries)
    };
  } catch {
    return false;
  }
  return crypto.timingSafeEqual(
    Buffer.from(seal.digest, 'hex'),
    Buffer.from(scoreSealDigest(normalized), 'hex')
  );
}

module.exports = {
  canonicalLeaderboard,
  createSeasonScoreSeal,
  verifySeasonScoreSeal
};
