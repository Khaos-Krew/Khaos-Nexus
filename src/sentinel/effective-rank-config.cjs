'use strict';

function adminRankSettings(source = null) {
  if (!source) return { rankRoles: {}, rankSkus: {} };
  const raw = typeof source.getAdminSettings === 'function' ? source.getAdminSettings() : source;
  return {
    rankRoles: raw?.rankRoles && typeof raw.rankRoles === 'object' ? { ...raw.rankRoles } : {},
    rankSkus: raw?.rankSkus && typeof raw.rankSkus === 'object'
      ? Object.fromEntries(Object.entries(raw.rankSkus).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]))
      : {}
  };
}

function effectiveRankConfig(config = {}, source = null) {
  const admin = adminRankSettings(source);
  return {
    ...config,
    discord: {
      ...(config.discord || {}),
      rankRoles: {
        ...(config.discord?.rankRoles || {}),
        ...admin.rankRoles
      },
      rankSkus: {
        ...(config.discord?.rankSkus || {}),
        ...admin.rankSkus
      }
    }
  };
}

module.exports = { adminRankSettings, effectiveRankConfig };
