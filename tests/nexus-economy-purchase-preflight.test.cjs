'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_PURCHASE_QUANTITY,
  createNexusEconomyPurchasePreflight
} = require('../src/sentinel/nexus-economy-purchase-preflight.cjs');

const READY_RELATIONS = [
  { relation_name: 'nexus_economy_accounts' },
  { relation_name: 'nexus_economy_ledger' },
  { relation_name: 'nexus_economy_audit' }
];

const CATALOG = {
  version: 1,
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

function readyPool(balance = '1000') {
  const calls = [];
  return {
    calls,
    pool: {
      query: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes('pg_catalog')) return { rows: READY_RELATIONS };
        if (String(sql).includes('nexus_economy_accounts')) return { rows: [{ balance }] };
        throw new Error(`unexpected query: ${sql}`);
      }
    }
  };
}

function serviceOptions(balance = '1000') {
  const { pool, calls } = readyPool(balance);
  let reads = 0;
  return {
    calls,
    get reads() { return reads; },
    options: {
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
    }
  };
}

test('invalid item id is rejected before Postgres or catalog access', async () => {
  let queries = 0;
  let reads = 0;
  const preflight = createNexusEconomyPurchasePreflight({
    pool: { query: async () => { queries += 1; throw new Error('must not query'); } },
    env: { NEXUS_ECONOMY_RUNTIME_MODE: 'shadow' },
    readFile: async () => { reads += 1; throw new Error('must not read'); }
  });

  const result = await preflight.quote('123456789', '../apex');

  assert.equal(queries, 0);
  assert.equal(reads, 0);
  assert.equal(result.reason, 'invalid-shop-item');
  assert.equal(result.purchasePermitted, false);
});

test('invalid quantity is rejected before Postgres or catalog access', async () => {
  let queries = 0;
  let reads = 0;
  const preflight = createNexusEconomyPurchasePreflight({
    pool: { query: async () => { queries += 1; throw new Error('must not query'); } },
    env: { NEXUS_ECONOMY_RUNTIME_MODE: 'shadow' },
    readFile: async () => { reads += 1; throw new Error('must not read'); }
  });

  const result = await preflight.quote('123456789', 'apex', { quantity: MAX_PURCHASE_QUANTITY + 1 });

  assert.equal(queries, 0);
  assert.equal(reads, 0);
  assert.equal(result.reason, 'invalid-purchase-quantity');
  assert.equal(result.purchasePermitted, false);
});

test('off mode stays inert and cannot produce a purchasable quote', async () => {
  let queries = 0;
  let reads = 0;
  const preflight = createNexusEconomyPurchasePreflight({
    pool: { query: async () => { queries += 1; throw new Error('must not query'); } },
    env: { NEXUS_ECONOMY_RUNTIME_MODE: 'off' },
    readFile: async () => { reads += 1; throw new Error('must not read'); }
  });

  const result = await preflight.quote('123456789', 'coastal');

  assert.equal(queries, 0);
  assert.equal(reads, 0);
  assert.equal(result.mode, 'off');
  assert.equal(result.reason, 'runtime-mode-off');
  assert.equal(result.purchasePermitted, false);
});

test('shadow mode returns a deterministic multi-item quote without mutation SQL', async () => {
  const fixture = serviceOptions('1000');
  const preflight = createNexusEconomyPurchasePreflight(fixture.options);

  const result = await preflight.quote('123456789', 'coastal', { quantity: 3 });

  assert.equal(fixture.reads, 1);
  assert.equal(result.ok, true);
  assert.equal(result.available, true);
  assert.equal(result.mode, 'shadow');
  assert.equal(result.reason, 'quote-ready');
  assert.equal(result.balance, 1000);
  assert.equal(result.itemId, 'coastal');
  assert.equal(result.displayName, 'Coastal Cache');
  assert.equal(result.quantity, 3);
  assert.equal(result.unitPrice, 150);
  assert.equal(result.totalPrice, 450);
  assert.equal(result.affordable, true);
  assert.equal(result.shortfall, 0);
  assert.equal(result.purchasePermitted, false);
  assert.equal(fixture.calls.some(({ sql }) => /INSERT|UPDATE|DELETE|CREATE|ALTER|DROP/i.test(sql)), false);
  assert.equal(JSON.stringify(result).includes('SpawnDinoInBall'), false);
  assert.equal(JSON.stringify(result).includes('itemAliases'), false);
  assert.equal(Object.isFrozen(result), true);
});

test('insufficient balance returns exact shortfall while purchase remains disabled', async () => {
  const fixture = serviceOptions('200');
  const preflight = createNexusEconomyPurchasePreflight(fixture.options);

  const result = await preflight.quote('123456789', 'coastal', { quantity: 2 });

  assert.equal(result.reason, 'insufficient-balance');
  assert.equal(result.totalPrice, 300);
  assert.equal(result.affordable, false);
  assert.equal(result.shortfall, 100);
  assert.equal(result.purchasePermitted, false);
});

test('unknown sanitized item is reported without exposing catalog internals', async () => {
  const fixture = serviceOptions('1000');
  const preflight = createNexusEconomyPurchasePreflight(fixture.options);

  const result = await preflight.quote('123456789', 'unknown-cache');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'shop-item-not-found');
  assert.equal(result.itemId, 'unknown-cache');
  assert.equal(result.purchasePermitted, false);
  assert.equal(JSON.stringify(result).includes('blueprint'), false);
  assert.equal(JSON.stringify(result).includes('delivery'), false);
});
