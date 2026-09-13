'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PRODUCTION_CATALOG_MARKER,
  PRODUCTION_CLUSTER_SHOP_CATALOG
} = require('../src/sentinel/cluster-shop-production-catalog.cjs');
const {
  createConfiguredClusterShop,
  productionCatalogMap
} = require('../src/sentinel/cluster-shop-production-service.cjs');
const { blueprintRef, itemRewardEntry } = require('../src/sentinel/cluster-shop-rewards-delivery.cjs');

test('ArkShop-derived production catalog contains the verified 48 buy-only entries', () => {
  assert.equal(PRODUCTION_CLUSTER_SHOP_CATALOG.length, 48);
  const counts = Object.fromEntries(['Resources', 'Dino Supplies', 'Kits', 'Apothecary'].map((category) => [
    category,
    PRODUCTION_CLUSTER_SHOP_CATALOG.filter((item) => item.category === category).length
  ]));
  assert.deepEqual(counts, { Resources: 20, 'Dino Supplies': 3, Kits: 6, Apothecary: 19 });
  assert.equal(PRODUCTION_CLUSTER_SHOP_CATALOG.every((item) => item.buyable === true && item.sellable === false), true);
});

test('production catalog preserves representative ArkShop prices and quantities', () => {
  const catalog = productionCatalogMap();
  assert.equal(catalog.get('fiber10k').baseQuantity, 1000);
  assert.equal(catalog.get('fiber10k').buyPrice, 10);
  assert.equal(catalog.get('dinoballs25').baseQuantity, 25);
  assert.equal(catalog.get('dinoballs25').buyPrice, 75);
  assert.equal(catalog.get('kit-bossprep').buyPrice, 1000);
  assert.equal(catalog.get('apoth_mutation').buyPrice, 250);
  assert.equal(catalog.get('gaia_taming').buyPrice, 300);
});

test('production selector activates the ArkShop catalog without changing normal JSON mode', () => {
  const production = createConfiguredClusterShop({ economy: {}, env: { NEXUS_CLUSTER_SHOP_CATALOG_JSON: PRODUCTION_CATALOG_MARKER } });
  assert.equal(production.listCatalog().length, 48);
});

test('multi-item ArkShop kits become one RewardsAscended reward and scale by bundles', () => {
  const item = productionCatalogMap().get('kit-builder');
  const reward = itemRewardEntry({
    orderId: 'NXARK-KIT-1',
    quote: { bundles: 2, totalQuantity: 2, metadata: item.metadata }
  });
  assert.equal(reward.Items.length, 8);
  const wood = reward.Items.find((entry) => entry.Blueprint.includes('PrimalItemResource_Wood_Child'));
  assert.ok(wood);
  assert.equal(wood.Amount, 10000);
});

test('RewardsAscended delivery accepts all mod roots used by the former ArkShop', () => {
  assert.match(blueprintRef('/TG_Stack_10000_90/Resources/PrimalItemResource_Wood_Child.PrimalItemResource_Wood_Child'), /^Blueprint'/);
  assert.match(blueprintRef('/DinoDepot/Assets/Items/Dinoball/ItemDinoball.ItemDinoball'), /^Blueprint'/);
  assert.match(blueprintRef('/CrazysPotions/Potions/InstantBaby/PrimalItemConsumable_CPInstantbaby.PrimalItemConsumable_CPInstantbaby'), /^Blueprint'/);
  assert.match(blueprintRef('/PotionsHelpers/Items/Taming/PrimalItemConsumable_Gaia_TamingElixir.PrimalItemConsumable_Gaia_TamingElixir'), /^Blueprint'/);
});
