'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  economyMutationDecision,
  assertEconomyMutationAllowed
} = require('../src/sentinel/economy-mutation-guard.cjs');

test('cluster shop delivery is fail-closed until explicitly enabled', () => {
  const blocked = economyMutationDecision('cluster-shop-delivery', {});
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, 'cluster-shop-delivery-not-enabled');

  const allowed = economyMutationDecision('cluster-shop-delivery', {
    NEXUS_ECONOMY_AUTHORITY: 'nexus',
    NEXUS_CLUSTER_SHOP_DELIVERY_ENABLED: 'true'
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.walletAuthority, 'nexus-economy-worker');
});

test('compatibility authority cannot authorize Nexus economy mutations', () => {
  const decision = economyMutationDecision('cluster-shop-delivery', {
    NEXUS_ECONOMY_AUTHORITY: 'compatibility',
    NEXUS_CLUSTER_SHOP_DELIVERY_ENABLED: 'true',
    NEXUS_ARKSHOP_LEGACY_MAINTENANCE_ENABLED: 'true'
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'nexus-authority-required');
});

test('legacy ArkShop and MySQL economy mutations are always forbidden', () => {
  for (const operation of ['arkshop-mutation', 'mysql-economy-mutation']) {
    const decision = economyMutationDecision(operation, { NEXUS_ECONOMY_AUTHORITY: 'nexus' });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, 'legacy-economy-mutation-forbidden');
  }
});

test('dino cache delivery requires its own explicit enable gate', () => {
  const clusterOnly = economyMutationDecision('dino-cache-delivery', {
    NEXUS_ECONOMY_AUTHORITY: 'nexus',
    NEXUS_CLUSTER_SHOP_DELIVERY_ENABLED: 'true'
  });
  assert.equal(clusterOnly.allowed, false);
  assert.equal(clusterOnly.reason, 'dino-cache-delivery-not-enabled');

  const enabled = economyMutationDecision('dino-cache-delivery', {
    NEXUS_ECONOMY_AUTHORITY: 'nexus',
    NEXUS_DINO_CACHE_DELIVERY_ENABLED: 'true'
  });
  assert.equal(enabled.allowed, true);
});

test('unknown operations fail closed and assertion exposes a stable error code', () => {
  const decision = economyMutationDecision('surprise-write', { NEXUS_ECONOMY_AUTHORITY: 'nexus' });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'unsupported-economy-mutation');

  assert.throws(
    () => assertEconomyMutationAllowed('surprise-write', { NEXUS_ECONOMY_AUTHORITY: 'nexus' }),
    (error) => error?.code === 'NEXUS_ECONOMY_MUTATION_DENIED' && error?.reason === 'unsupported-economy-mutation'
  );
});
