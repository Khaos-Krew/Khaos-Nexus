'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildMigrationBundle,
  validateMigrationBundle,
  buildShopItems,
  buildKits
} = require('../src/sentinel/wshop-migration.cjs');

test('WShop migration includes the complete planned catalog and all caches', () => {
  const bundle = buildMigrationBundle({ generatedAt: '2026-08-30T00:00:00.000Z' });
  const result = validateMigrationBundle(bundle);
  assert.equal(result.ok, true, result.errors.join(', '));
  assert.deepEqual(result.counts, { kits: 7, shopItems: 42, sellItems: 29, dinoCaches: 7, rewardCacheTypes: 4 });
});

test('Love Potion and engram unlock potion are never sold', () => {
  const shop = buildShopItems();
  assert.equal(shop.apoth_love, undefined);
  assert.equal(shop.apoth_engram_unlocker, undefined);
  assert.equal(shop.gaia_taming.Price, 300);
  assert.equal(shop.apoth_mutation.Price, 250);
});

test('builder kit uses direct item delivery and no purchaser-context admin commands', () => {
  const builder = buildKits().builder;
  assert.equal(builder.Commands, undefined);
  assert.ok(builder.Items.length >= 8);
  assert.ok(builder.Items.every((item) => String(item.Blueprint).startsWith("Blueprint'")));
});

test('cache storefront metadata cannot double-charge or self-deliver', () => {
  const caches = buildMigrationBundle({ generatedAt: '2026-08-30T00:00:00.000Z' }).sentinel.dinoCaches;
  for (const cache of Object.values(caches)) {
    assert.equal(cache.currencyOwner, 'WShop');
    assert.equal(cache.transactionOwner, 'Sentinel');
    assert.equal(cache.deliveryOwner, 'Sentinel');
    assert.equal(cache.failClosed, true);
  }
});

test('catalog checksum detects accidental migration drift', () => {
  const bundle = buildMigrationBundle({ generatedAt: '2026-08-30T00:00:00.000Z' });
  bundle.wshop.nativeCatalog.ShopItems.gaia_taming.Price = 1;
  const result = validateMigrationBundle(bundle);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('price mismatch:gaia_taming'));
  assert.ok(result.errors.includes('catalog checksum mismatch'));
});
