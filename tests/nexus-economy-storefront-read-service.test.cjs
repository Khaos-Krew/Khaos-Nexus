'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createNexusEconomyStorefrontReadService } = require('../src/sentinel/nexus-economy-storefront-read-service.cjs');

const READY_RELATIONS = [
  { relation_name: 'nexus_economy_accounts' },
  { relation_name: 'nexus_economy_ledger' },
  { relation_name: 'nexus_economy_audit' }
];

const CATALOG = {
  version: 1,
  groups: {
    apex: [{ name: 'Rex', blueprint: '/Game/Secret/Rex_BP' }]
  },
  caches: {
    coastal: {
      displayName: 'Coastal Cache',
      emoji: '🌊',
      tagline: 'Coastal starter pool.',
      price: 150,
      cooldownMinutes: 5,
      groups: ['coastal'],
      delivery: { command: 'SpawnDinoInBall' }
    },
    apex: {
      displayName: 'Apex Cache',
      emoji: '👑',
      tagline: 'Endgame apex pool.',
      price: 550,
      cooldownMinutes: 5,
      groups: ['apex'],
      itemAliases: ['nexus_cache_apex']
    }
  }
};

test('off mode storefront is inert: no Postgres query and no catalog read', async () => {
  let queries = 0;
  let reads = 0;
  const service = createNexusEconomyStorefrontReadService({
    pool: { query: async () => { queries += 1; throw new Error('must not query'); } },
    env: { NEXUS_ECONOMY_RUNTIME_MODE: 'off' },
    readFile: async () => { reads += 1; throw new Error('must not read'); }
  });

  const result = await service.getStorefront('123456789');

  assert.equal(queries, 0);
  assert.equal(reads, 0);
  assert.deepEqual(result, {
    ok: false,
    available: false,
    mode: 'off',
    reason: 'runtime-mode-off',
    currency: 'Nexus Points',
    balance: null,
    purchasingEnabled: false,
    items: []
  });
});

test('shadow-ready storefront joins wallet balance to sanitized catalog without enabling purchase', async () => {
  const calls = [];
  let reads = 0;
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (String(sql).includes('pg_catalog')) return { rows: READY_RELATIONS };
      if (String(sql).includes('nexus_economy_accounts')) return { rows: [{ balance: '250' }] };
      throw new Error(`unexpected query: ${sql}`);
    }
  };
  const service = createNexusEconomyStorefrontReadService({
    pool,
    env: {
      NEXUS_ECONOMY_RUNTIME_MODE: 'shadow',
      NEXUS_ECONOMY_AUTHORITY: 'nexus'
    },
    catalogPath: '/safe/dino-caches.json',
    readFile: async (file, encoding) => {
      reads += 1;
      assert.equal(file, '/safe/dino-caches.json');
      assert.equal(encoding, 'utf8');
      return JSON.stringify(CATALOG);
    }
  });

  const result = await service.getStorefront('123456789');

  assert.equal(reads, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls.some(({ sql }) => /INSERT|UPDATE|DELETE|CREATE|ALTER|DROP/i.test(String(sql))), false);
  assert.equal(result.ok, true);
  assert.equal(result.available, true);
  assert.equal(result.mode, 'shadow');
  assert.equal(result.balance, 250);
  assert.equal(result.purchasingEnabled, false);
  assert.deepEqual(result.items, [
    {
      id: 'coastal',
      displayName: 'Coastal Cache',
      emoji: '🌊',
      tagline: 'Coastal starter pool.',
      price: 150,
      cooldownMinutes: 5,
      affordable: true,
      shortfall: 0,
      canPurchase: false
    },
    {
      id: 'apex',
      displayName: 'Apex Cache',
      emoji: '👑',
      tagline: 'Endgame apex pool.',
      price: 550,
      cooldownMinutes: 5,
      affordable: false,
      shortfall: 300,
      canPurchase: false
    }
  ]);

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('blueprint'), false);
  assert.equal(serialized.includes('SpawnDinoInBall'), false);
  assert.equal(serialized.includes('itemAliases'), false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.items), true);
  assert.equal(Object.isFrozen(result.items[0]), true);
});

test('catalog failure is sanitized and keeps purchasing disabled', async () => {
  const pool = {
    query: async (sql) => {
      if (String(sql).includes('pg_catalog')) return { rows: READY_RELATIONS };
      if (String(sql).includes('nexus_economy_accounts')) return { rows: [{ balance: '400' }] };
      throw new Error(`unexpected query: ${sql}`);
    }
  };
  const service = createNexusEconomyStorefrontReadService({
    pool,
    env: {
      NEXUS_ECONOMY_RUNTIME_MODE: 'shadow',
      NEXUS_ECONOMY_AUTHORITY: 'nexus'
    },
    readFile: async () => { throw new Error('private path /mnt/secrets/dino-caches.json'); }
  });

  const result = await service.getStorefront('123456789');

  assert.deepEqual(result, {
    ok: false,
    available: false,
    mode: 'shadow',
    reason: 'shop-catalog-unavailable',
    currency: 'Nexus Points',
    balance: 400,
    purchasingEnabled: false,
    items: []
  });
  assert.equal(JSON.stringify(result).includes('/mnt/secrets'), false);
});
