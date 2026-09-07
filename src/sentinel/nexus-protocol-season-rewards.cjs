'use strict';

const { verifySeasonScoreSeal } = require('./nexus-protocol-score-seal.cjs');
const { protocolExecutionPlan } = require('./nexus-protocol-executors.cjs');

function cleanToken(value, label, pattern = /^[A-Za-z0-9:_-]{1,96}$/) {
  const result = String(value ?? '').trim();
  if (!pattern.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}

function normalizeRewardTiers(tiers = []) {
  if (!Array.isArray(tiers) || tiers.length === 0) throw new Error('Protocol season reward tiers are required');
  const normalized = tiers.map((tier) => ({
    maxRank: Math.max(1, Math.floor(Number(tier.maxRank))),
    rewardId: cleanToken(tier.rewardId, 'reward id')
  })).sort((a, b) => a.maxRank - b.maxRank);
  let previous = 0;
  for (const tier of normalized) {
    if (!Number.isFinite(tier.maxRank) || tier.maxRank <= previous) throw new Error('Protocol season reward ranks must increase');
    previous = tier.maxRank;
  }
  return Object.freeze(normalized.map(Object.freeze));
}

function rewardForRank(rank, tiers) {
  return tiers.find((tier) => rank <= tier.maxRank) || null;
}

function buildSeasonRewardPlans(seal, recipients = {}, options = {}) {
  if (!verifySeasonScoreSeal(seal)) throw new Error('Protocol season score seal is invalid');
  if (!recipients || typeof recipients !== 'object' || Array.isArray(recipients)) throw new Error('Protocol reward recipients are invalid');
  const tiers = normalizeRewardTiers(options.tiers);
  const protocolId = cleanToken(options.protocolId || `season:${seal.seasonId}`, 'protocol id');
  const createdAt = Number(options.createdAt ?? Date.now());
  if (!Number.isFinite(createdAt) || createdAt < 0) throw new Error('Invalid Protocol reward plan time');

  const plans = [];
  const skipped = [];
  for (const entry of seal.entries) {
    const tier = rewardForRank(entry.rank, tiers);
    if (!tier) continue;
    const eosId = String(recipients[entry.accountId] || '').trim();
    if (!/^[A-Za-z0-9_-]{4,96}$/.test(eosId)) {
      skipped.push(Object.freeze({ accountId: entry.accountId, rank: entry.rank, reason: 'missing_or_invalid_eos' }));
      continue;
    }
    const plan = protocolExecutionPlan({
      protocolId,
      createdAt,
      dryRun: true,
      reward: { eosId, rewardId: tier.rewardId }
    });
    plans.push(Object.freeze({
      accountId: entry.accountId,
      rank: entry.rank,
      score: entry.score,
      rewardId: tier.rewardId,
      plan
    }));
  }

  return Object.freeze({
    seasonId: seal.seasonId,
    sealDigest: seal.digest,
    dryRun: true,
    plans: Object.freeze(plans),
    skipped: Object.freeze(skipped)
  });
}

module.exports = {
  normalizeRewardTiers,
  buildSeasonRewardPlans
};
