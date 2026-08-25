'use strict';

const NEXUS_RANKS = Object.freeze([
  Object.freeze({ id: 'shadow-recruit', name: 'Shadow Recruit', level: 0 }),
  Object.freeze({ id: 'cipher-runner', name: 'Cipher Runner', level: 1 }),
  Object.freeze({ id: 'nexus-raider', name: 'Nexus Raider', level: 2 }),
  Object.freeze({ id: 'khaos-warden', name: 'Khaos Warden', level: 3 }),
  Object.freeze({ id: 'blackout-legend', name: 'Blackout Legend', level: 4 }),
  Object.freeze({ id: 'origin-founder', name: 'Origin Founder', level: 5 })
]);

const RANK_BY_ID = new Map(NEXUS_RANKS.map((rank) => [rank.id, rank]));
const LEGACY_RANK_IDS = Object.freeze(new Set(['origin-founder']));

function normalizeId(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function rankById(value) {
  return RANK_BY_ID.get(normalizeId(value)) || null;
}

function isLegacyRank(rank) {
  const id = typeof rank === 'string' ? normalizeId(rank) : normalizeId(rank?.id);
  return LEGACY_RANK_IDS.has(id);
}

function isPurchasableRank(rank) {
  return Boolean(rank && Number(rank.level || 0) > 0 && !isLegacyRank(rank));
}

function purchasableRanks() {
  return NEXUS_RANKS.filter(isPurchasableRank);
}

function skuToRankMap(config = {}) {
  const result = new Map();
  for (const rank of purchasableRanks()) {
    for (const skuId of config?.discord?.rankSkus?.[rank.id] || []) {
      const id = String(skuId || '').trim();
      if (id) result.set(id, rank);
    }
  }
  return result;
}

function rankAuthority(config = {}) {
  const hasPaidSkuMappings = purchasableRanks()
    .some((rank) => (config?.discord?.rankSkus?.[rank.id] || []).some((skuId) => String(skuId || '').trim()));
  return hasPaidSkuMappings ? 'premium-app' : 'server-shop-roles';
}

function rankRoleIds(config = {}) {
  const authority = rankAuthority(config);
  const ranks = authority === 'server-shop-roles'
    ? NEXUS_RANKS.filter((rank) => rank.level === 0)
    : NEXUS_RANKS.filter((rank) => rank.level === 0 || isPurchasableRank(rank));
  return ranks
    .map((rank) => String(config?.discord?.rankRoles?.[rank.id] || '').trim())
    .filter(Boolean);
}

function highestRankForEntitlements(entitlements = [], config = {}) {
  const skuMap = skuToRankMap(config);
  let selected = null;
  for (const entitlement of entitlements || []) {
    if (!entitlement || entitlement.deleted === true) continue;
    const endsAt = entitlement.ends_at || entitlement.endsAt || null;
    if (endsAt && Date.parse(endsAt) <= Date.now()) continue;
    const rank = skuMap.get(String(entitlement.sku_id || entitlement.skuId || ''));
    if (rank && (!selected || rank.level > selected.level)) selected = rank;
  }
  return selected;
}

module.exports = {
  LEGACY_RANK_IDS,
  NEXUS_RANKS,
  highestRankForEntitlements,
  isLegacyRank,
  isPurchasableRank,
  normalizeId,
  purchasableRanks,
  rankAuthority,
  rankById,
  rankRoleIds,
  skuToRankMap
};
