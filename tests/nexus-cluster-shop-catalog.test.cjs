'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildNexusClusterShopCatalog,
  loadNexusClusterShopCatalog
} = require('../src/sentinel/nexus-cluster-shop-catalog.cjs');

const METAL_BLUEPRINT = '/Game/PrimalEarth/CoreBlueprints/Resources/PrimalItemResource_Metal.PrimalItemResource_Metal';

function metal(overrides = {}) {
  return {
    id: 'metal',
    name: 'Metal',
    category: 'Resources',
    kind: 'resource',
    blueprint: METAL_BLUEPRINT,
    baseQuantity: 100,
    buyPrice: 50,
    minBundles: 1,
    maxBundles: 50,
    ...overrides
  };
}

test('projects inventory items into a RewardsAscended-only cluster storefront contract', () => {
  const catalog = buildNexusClusterShopCatalog([metal()]);
  assert.equal(catalog.storefront, 'cluster-shop');
  assert.equal(catalog.fulfillment, 'rewards-ascended-item');
  assert.equal(catalog.purchasingEnabled, false);
  assert.equal(catalog.sellbackEnabled, false);
  assert.equal(catalog.items.length, 1);
  assert.equal(catalog.items[0].baseQuantity, 100);
  assert.equal(catalog.items[0].buyPrice, 50);
  assert.equal(catalog.items[0].fulfillment, 'rewards-ascended-item');
  assert.equal(catalog.items[0].sellbackEnabled, false);
  assert.equal(Object.isFrozen(catalog), true);
  assert.equal(Object.isFrozen(catalog.items), true);
  assert.equal(Object.isFrozen(catalog.items[0]), true);
});

test('hard-rejects Dino Cache and creature entries from #cluster-shop', () => {
  for (const kind of ['dino-cache', 'dino', 'creature']) {
    assert.throws(
      () => buildNexusClusterShopCatalog([metal({ id: `bad-${kind}`, kind })]),
      /#dino-box-shop/
    );
  }
});

test('requires a RewardsAscended-compatible blueprint for every cluster shop item', () => {
  assert.throws(
    () => buildNexusClusterShopCatalog([metal({ blueprint: 'PrimalItemResource_Metal' })]),
    /invalid RewardsAscended blueprint path/
  );
});

test('preserves quantity boundaries without enabling sellback', () => {
  const item = buildNexusClusterShopCatalog([metal({ baseQuantity: 250, minBundles: 2, maxBundles: 20 })]).items[0];
  assert.equal(item.baseQuantity, 250);
  assert.equal(item.minBundles, 2);
  assert.equal(item.maxBundles, 20);
  assert.equal(item.sellbackEnabled, false);
});

test('loads only explicit cluster shop JSON and rejects duplicate item ids', () => {
  const raw = JSON.stringify([metal(), metal({ name: 'Metal Duplicate' })]);
  assert.throws(() => loadNexusClusterShopCatalog({ raw }), /Duplicate Cluster Shop item id/);
});

test('empty or invalid configuration fails closed', () => {
  assert.throws(() => loadNexusClusterShopCatalog({ raw: '[]' }), /at least one item/);
  assert.throws(() => loadNexusClusterShopCatalog({ raw: '{bad json' }), /must be valid JSON/);
});
