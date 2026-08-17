'use strict';

function clean(value, max = 120) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => clean(value, 32)).filter(Boolean))];
}

function defaultDiscordEntitlementPolicy() {
  return {
    enabled: false,
    defaultRank: 'member',
    ranks: [
      { id: 'member', name: 'Member', priority: 0, skuIds: [] }
    ],
    featureRanks: {}
  };
}

function normalizeDiscordEntitlementPolicy(input = {}) {
  const base = defaultDiscordEntitlementPolicy();
  const source = input && typeof input === 'object' ? input : {};
  const ranks = (Array.isArray(source.ranks) ? source.ranks : base.ranks)
    .map((rank, index) => ({
      id: clean(rank?.id || `rank-${index + 1}`, 64).toLowerCase(),
      name: clean(rank?.name || rank?.id || `Rank ${index + 1}`, 80),
      priority: Number.isFinite(Number(rank?.priority)) ? Number(rank.priority) : index,
      skuIds: unique(rank?.skuIds)
    }))
    .filter((rank) => rank.id);

  if (!ranks.some((rank) => rank.id === 'member')) {
    ranks.unshift({ id: 'member', name: 'Member', priority: 0, skuIds: [] });
  }

  const featureRanks = {};
  if (source.featureRanks && typeof source.featureRanks === 'object' && !Array.isArray(source.featureRanks)) {
    for (const [feature, rankId] of Object.entries(source.featureRanks)) {
      const key = clean(feature, 120);
      const value = clean(rankId, 64).toLowerCase();
      if (key && value) featureRanks[key] = value;
    }
  }

  const requestedDefault = clean(source.defaultRank || base.defaultRank, 64).toLowerCase();
  const defaultRank = ranks.some((rank) => rank.id === requestedDefault) ? requestedDefault : 'member';

  return {
    enabled: source.enabled === true,
    defaultRank,
    ranks: ranks.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)),
    featureRanks
  };
}

function valuesFromEntitlements(entitlements) {
  if (!entitlements) return [];
  if (Array.isArray(entitlements)) return entitlements;
  if (typeof entitlements.values === 'function') return [...entitlements.values()];
  if (typeof entitlements === 'object') return Object.values(entitlements);
  return [];
}

function toDateMs(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function entitlementIsActive(entitlement, now = Date.now()) {
  if (!entitlement || typeof entitlement !== 'object') return false;
  if (entitlement.deleted === true) return false;
  if (entitlement.consumed === true) return false;
  const starts = toDateMs(entitlement.startsAt ?? entitlement.starts_at);
  const ends = toDateMs(entitlement.endsAt ?? entitlement.ends_at);
  if (starts !== null && starts > now) return false;
  if (ends !== null && ends <= now) return false;
  return true;
}

function activeSkuIdsFromInteraction(interaction, now = Date.now()) {
  const ids = new Set();
  for (const entitlement of valuesFromEntitlements(interaction?.entitlements)) {
    if (!entitlementIsActive(entitlement, now)) continue;
    const skuId = clean(entitlement.skuId ?? entitlement.sku_id, 32);
    if (skuId) ids.add(skuId);
  }
  return ids;
}

function rankById(policy, rankId) {
  return policy.ranks.find((rank) => rank.id === rankId) || null;
}

function resolveDiscordRank(input = {}) {
  const policy = normalizeDiscordEntitlementPolicy(input.policy);
  const skuIds = input.skuIds instanceof Set
    ? input.skuIds
    : activeSkuIdsFromInteraction(input.interaction, input.now);
  let selected = rankById(policy, policy.defaultRank) || policy.ranks[0];

  for (const rank of policy.ranks) {
    if (!rank.skuIds.some((skuId) => skuIds.has(skuId))) continue;
    if (!selected || rank.priority > selected.priority) selected = rank;
  }

  return {
    id: selected?.id || 'member',
    name: selected?.name || 'Member',
    priority: selected?.priority || 0,
    skuIds: [...skuIds]
  };
}

function featureAccess(input = {}) {
  const policy = normalizeDiscordEntitlementPolicy(input.policy);
  const userId = clean(input.interaction?.user?.id || input.userId, 32);
  const ownerUserId = clean(input.ownerUserId, 32);
  if (ownerUserId && userId === ownerUserId) {
    return { allowed: true, reason: 'owner-bypass', rank: { id: 'owner', name: 'Owner', priority: Number.MAX_SAFE_INTEGER, skuIds: [] }, requiredRank: '' };
  }
  if (!policy.enabled) {
    return { allowed: true, reason: 'monetization-disabled', rank: resolveDiscordRank({ policy, interaction: input.interaction, now: input.now }), requiredRank: '' };
  }

  const feature = clean(input.feature, 120);
  const requiredRankId = clean(policy.featureRanks[feature], 64).toLowerCase();
  const rank = resolveDiscordRank({ policy, interaction: input.interaction, now: input.now });
  if (!requiredRankId) return { allowed: true, reason: 'feature-not-gated', rank, requiredRank: '' };

  const required = rankById(policy, requiredRankId);
  if (!required) return { allowed: false, reason: 'unknown-required-rank', rank, requiredRank: requiredRankId };
  const allowed = rank.priority >= required.priority;
  return { allowed, reason: allowed ? 'rank-satisfied' : 'rank-required', rank, requiredRank: required.id, requiredRankName: required.name };
}

function assertFeatureAccess(input = {}) {
  const result = featureAccess(input);
  if (result.allowed) return result;
  const label = result.requiredRankName || result.requiredRank || 'premium';
  const error = new Error(`This D&D feature requires the **${label}** Discord Store rank or higher.`);
  error.code = 'DISCORD_ENTITLEMENT_REQUIRED';
  error.access = result;
  throw error;
}

module.exports = {
  defaultDiscordEntitlementPolicy,
  normalizeDiscordEntitlementPolicy,
  valuesFromEntitlements,
  entitlementIsActive,
  activeSkuIdsFromInteraction,
  resolveDiscordRank,
  featureAccess,
  assertFeatureAccess
};
