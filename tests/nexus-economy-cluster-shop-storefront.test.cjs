'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createNexusEconomyStorefrontReadService } = require('../src/sentinel/nexus-economy-storefront-read-service.cjs');

const READY_RELATIONS = [
  { relname: 'nexus_economy_accounts', relkind: 'r' },
  { relname: 'nexus_economy_ledger', relkind: 'r' },
  { relname: 'nexus_economy_audit', relkind: 'r' }
];

function readOnlyPool(balance = '500') {
  return {
    query: async (sql) => {
      if (String(sql).includes('pg_catalog')) return { rows: READY_RELATIONS };
      if (String(sql).includes('nexus_economy_accounts')) return { rows: [{ balance }] };
      throw new Error(`unexpected query: ${sql}`);
    },
    connect: async () => { throw new Error('read-only storefront must not open a transaction'); }
  };
}

function envWithCatalog(items) {
  return {
    NEXUS_ECONOMY_RUNTIME_MODE: 'shadow',
    NEXUS_ECONOMY_AUTHORITY: 'nexus',
    NEXUS_CLUSTER_SHOP_CATALOG_JSON: JSON.stringify(items)
  };
}

test('default cluster-shop storefront uses dedicated RewardsAscended catalog and redacts blueprint', async () => {
  const service = createNexusEconomyStorefrontReadService({
    pool: readOnlyPool('500'),
    env: envWithCatalog([{
      id: 'metal-ingots',
      name: 'Metal Ingots',
      description: 'A resource bundle.',
      category: 'Resources',
      kind: 'item',
      blueprint: '/Game/PrimalEarth/CoreBlueprints/Resources/PrimalItemResource_MetalIngot.PrimalItemResource_MetalIngot',
      baseQuantity: 100,
      buyPrice: 250,
      minBundles: 1,
      maxBundles: 10
    }])
  });

  const result = await service.getStorefront('123456789');

  assert.equal(result.ok, true);
  assert.equal(result.available, true);
  assert.equal(result.purchasingEnabled, false);
  assert.deepEqual(result.items, [{
    id: 'metal-ingots',
    displayName: 'Metal Ingots',
    description: 'A resource bundle.',
    category: 'Resources',
    kind: 'item',
    baseQuantity: 100,
    price: 250,
    minBundles: 1,
    maxBundles: 10,
    fulfillment: 'rewards-ascended-item',
    affordable: true,
    shortfall: 0,
    canPurchase: false,
    sellbackEnabled: false
  }]);
  assert.equal(JSON.stringify(result).includes('blueprint'), false);
  assert.equal(JSON.stringify(result).includes('PrimalItemResource_MetalIngot'), false);
});

test('default cluster-shop storefront fails closed for Dino Cache/creature catalog entries', async () => {
  const service = createNexusEconomyStorefrontReadService({
    pool: readOnlyPool(),
    env: envWithCatalog([{
      id: 'apex-cache',
      name: 'Apex Cache',
      kind: 'dino-cache',
      blueprint: '/Game/PrimalEarth/Dinos/Rex/Rex_Character_BP.Rex_Character_BP',
      baseQuantity: 1,
      buyPrice: 500
    }])
  });

  const result = await service.getStorefront('123456789');

  assert.equal(result.ok, false);
  assert.equal(result.available, false);
  assert.equal(result.reason, 'shop-catalog-unavailable');
  assert.equal(result.purchasingEnabled, false);
  assert.deepEqual(result.items, []);
});
