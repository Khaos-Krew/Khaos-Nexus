'use strict';

const ECONOMY_AUTHORITY = Object.freeze({
  NEXUS: 'nexus',
  COMPATIBILITY: 'compatibility'
});

function envBool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function normalizeAuthority(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return ECONOMY_AUTHORITY.NEXUS;
  if (normalized === ECONOMY_AUTHORITY.NEXUS || normalized === ECONOMY_AUTHORITY.COMPATIBILITY) return normalized;
  throw new Error(`Unsupported Nexus economy authority mode: ${normalized}`);
}

function resolveEconomyAuthorityPolicy(env = process.env) {
  const authority = normalizeAuthority(env.NEXUS_ECONOMY_AUTHORITY);
  const explicitLegacyMaintenance = envBool(env.NEXUS_ARKSHOP_COMPAT_MAINTENANCE, false);

  return Object.freeze({
    authority,
    walletAuthority: 'nexus-economy-worker',
    storefronts: Object.freeze({
      clusterShop: 'cluster-shop',
      dinoCache: 'dino-cache'
    }),
    legacyArkShop: Object.freeze({
      role: 'compatibility-only',
      mysqlAuthoritative: false,
      gameSideStorefrontAuthoritative: false,
      maintenanceEnabled: authority === ECONOMY_AUTHORITY.COMPATIBILITY && explicitLegacyMaintenance,
      mutationsAllowed: false
    })
  });
}

module.exports = {
  ECONOMY_AUTHORITY,
  envBool,
  normalizeAuthority,
  resolveEconomyAuthorityPolicy
};
