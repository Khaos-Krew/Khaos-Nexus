'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_CATALOG_BYTES,
  buildNexusEconomyShopCatalog,
  loadNexusEconomyShopCatalog
} = require('../src/sentinel/nexus-economy-shop-catalog.cjs');

const CONFIG = {
  version: 1,
  groups: {
    apex: [{ name: 'Rex', blueprint: '/Game/Secret/Rex_BP' }]
  },
  caches: {
    apex: {
      displayName: 'Apex Cache',
      emoji: '👑',
      tagline: 'Endgame apex pool.',
      price: 550,
      cooldownMinutes: 5,
      groups: ['apex'],
      itemAliases: ['nexus_cache_apex'],
      maps: ['*'],
      delivery: { command: 'SpawnDinoInBall' }
    }
  }
};

test('projects cache config into a player-safe read-only storefront model', () => {
  const catalog = buildNexusEconomyShopCatalog(CONFIG);

  assert.deepEqual(catalog, {
    version: 1,
    currency: 'Nexus Points',
    purchasingEnabled: false,
    items: [{
      id: 'apex',
      displayName: 'Apex Cache',
      emoji: '👑',
      tagline: 'Endgame apex pool.',
      price: 550,
      cooldownMinutes: 5
    }]
  });
  const serialized = JSON.stringify(catalog);
  assert.equal(serialized.includes('blueprint'), false);
  assert.equal(serialized.includes('itemAliases'), false);
  assert.equal(serialized.includes('SpawnDinoInBall'), false);
  assert.equal(serialized.includes('/Game/Secret'), false);
  assert.equal(catalog.purchasingEnabled, false);
  assert.equal(Object.isFrozen(catalog), true);
  assert.equal(Object.isFrozen(catalog.items), true);
  assert.equal(Object.isFrozen(catalog.items[0]), true);
});

test('loads catalog with a read-only injected file reader', async () => {
  const calls = [];
  const catalog = await loadNexusEconomyShopCatalog({
    catalogPath: '/safe/dino-caches.json',
    readFile: async (file, encoding) => {
      calls.push({ file, encoding });
      return JSON.stringify(CONFIG);
    }
  });

  assert.deepEqual(calls, [{ file: '/safe/dino-caches.json', encoding: 'utf8' }]);
  assert.equal(catalog.items[0].price, 550);
  assert.equal(catalog.purchasingEnabled, false);
});

test('fails closed on invalid JSON and unsafe or malformed item data', async () => {
  await assert.rejects(
    () => loadNexusEconomyShopCatalog({ readFile: async () => '{not json' }),
    /invalid JSON/
  );
  assert.throws(
    () => buildNexusEconomyShopCatalog({ version: 1, caches: { 'BAD ITEM': { displayName: 'Bad', price: 1 } } }),
    /Unsafe shop item id/
  );
  assert.throws(
    () => buildNexusEconomyShopCatalog({ version: 1, caches: { bad: { displayName: 'Bad', price: -1 } } }),
    /bad.price/
  );
});

test('rejects oversized catalog input before parsing or projecting it', async () => {
  const oversized = ' '.repeat(MAX_CATALOG_BYTES + 1);
  await assert.rejects(
    () => loadNexusEconomyShopCatalog({ readFile: async () => oversized }),
    /safe size limit/
  );
});
