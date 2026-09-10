'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ECONOMY_AUTHORITY,
  LEGACY_MAINTENANCE_ENV,
  normalizeAuthority,
  resolveEconomyAuthorityPolicy
} = require('../src/sentinel/economy-authority-policy.cjs');

test('defaults to Nexus economy authority and canonical Discord storefronts', () => {
  const policy = resolveEconomyAuthorityPolicy({});
  assert.equal(policy.authority, ECONOMY_AUTHORITY.NEXUS);
  assert.equal(policy.walletAuthority, 'nexus-economy-worker');
  assert.equal(policy.storefronts.clusterShop, 'cluster-shop');
  assert.equal(policy.storefronts.dinoCache, 'dino-box-shop');
});

test('game-side ArkShop and MySQL never become authoritative', () => {
  const nexus = resolveEconomyAuthorityPolicy({ NEXUS_ECONOMY_AUTHORITY: 'nexus' });
  const compatibility = resolveEconomyAuthorityPolicy({
    NEXUS_ECONOMY_AUTHORITY: 'compatibility',
    [LEGACY_MAINTENANCE_ENV]: 'true'
  });

  for (const policy of [nexus, compatibility]) {
    assert.equal(policy.legacyArkShop.role, 'compatibility-only');
    assert.equal(policy.legacyArkShop.mysqlAuthoritative, false);
    assert.equal(policy.legacyArkShop.gameSideStorefrontAuthoritative, false);
    assert.equal(policy.legacyArkShop.mutationsAllowed, false);
  }
});

test('legacy maintenance is opt-in through the canonical retirement gate and limited to compatibility mode', () => {
  assert.equal(LEGACY_MAINTENANCE_ENV, 'NEXUS_ARKSHOP_LEGACY_MAINTENANCE_ENABLED');
  assert.equal(resolveEconomyAuthorityPolicy({}).legacyArkShop.maintenanceEnabled, false);
  assert.equal(resolveEconomyAuthorityPolicy({ [LEGACY_MAINTENANCE_ENV]: 'true' }).legacyArkShop.maintenanceEnabled, false);
  assert.equal(resolveEconomyAuthorityPolicy({
    NEXUS_ECONOMY_AUTHORITY: 'compatibility',
    [LEGACY_MAINTENANCE_ENV]: 'true'
  }).legacyArkShop.maintenanceEnabled, true);
});

test('deprecated compatibility maintenance variable cannot silently re-enable legacy scans', () => {
  const policy = resolveEconomyAuthorityPolicy({
    NEXUS_ECONOMY_AUTHORITY: 'compatibility',
    NEXUS_ARKSHOP_COMPAT_MAINTENANCE: 'true'
  });
  assert.equal(policy.legacyArkShop.maintenanceEnabled, false);
});

test('unknown authority modes fail closed', () => {
  assert.throws(() => normalizeAuthority('mysql'), /Unsupported Nexus economy authority mode/);
  assert.throws(() => normalizeAuthority('arkshop'), /Unsupported Nexus economy authority mode/);
});
