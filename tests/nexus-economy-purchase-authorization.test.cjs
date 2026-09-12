'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ECONOMY_PURCHASES_ENABLED_ENV,
  createNexusEconomyPurchaseAuthorization
} = require('../src/sentinel/nexus-economy-purchase-authorization.cjs');

const READY_RELATIONS = [
  { relname: 'nexus_economy_accounts', relkind: 'r' },
  { relname: 'nexus_economy_ledger', relkind: 'r' },
  { relname: 'nexus_economy_audit', relkind: 'r' }
];

function catalog(price = 150) {
  return {
    version: 1,
    caches: {
      coastal: {
        displayName: 'Coastal Cache',
        emoji: '🌊',
        tagline: 'Coastal starter pool.',
        price,
        cooldownMinutes: 5,
        groups: ['coastal'],
        delivery: { command: 'SpawnDinoInBall' }
      }
    }
  };
}

function readOnlyPool(query) {
  return {
    query,
    connect: async () => {
      throw new Error('read-only authorization path must not call connect()');
    }
  };
}

function fixture({
  balance = '1000',
  price = 150,
  mode = 'active',
  runtimeEnabled = 'true',
  purchasesEnabled = 'true'
} = {}) {
  const calls = [];
  let reads = 0;
  const pool = readOnlyPool(async (sql, params) => {
    calls.push({ sql: String(sql), params });
    if (String(sql).includes('pg_catalog')) return { rows: READY_RELATIONS };
    if (String(sql).includes('nexus_economy_accounts')) return { rows: [{ balance }] };
    throw new Error(`unexpected query: ${sql}`);
  });

  return {
    calls,
    get reads() { return reads; },
    options: {
      pool,
      env: {
        NEXUS_ECONOMY_RUNTIME_MODE: mode,
        NEXUS_ECONOMY_RUNTIME_ENABLED: runtimeEnabled,
        NEXUS_ECONOMY_AUTHORITY: 'nexus',
        NEXUS_ECONOMY_LEGACY_ARKSHOP_MUTATIONS_ENABLED: 'false',
        [ECONOMY_PURCHASES_ENABLED_ENV]: purchasesEnabled
      },
      catalogPath: '/safe/dino-caches.json',
      readFile: async () => {
        reads += 1;
        return JSON.stringify(catalog(price));
      }
    }
  };
}

function assertNoMutationSql(calls) {
  for (const call of calls) {
    assert.doesNotMatch(call.sql, /\b(insert|update|delete|alter|create|drop|truncate)\b/i);
  }
}

test('off mode remains completely inert', async () => {
  let queries = 0;
  let reads = 0;
  const authorization = createNexusEconomyPurchaseAuthorization({
    pool: readOnlyPool(async () => { queries += 1; throw new Error('must not query'); }),
    env: {
      NEXUS_ECONOMY_RUNTIME_MODE: 'off',
      NEXUS_ECONOMY_AUTHORITY: 'nexus',
      [ECONOMY_PURCHASES_ENABLED_ENV]: 'true'
    },
    readFile: async () => { reads += 1; throw new Error('must not read'); }
  });

  const result = await authorization.authorize('123456789', 'coastal', {
    requestId: 'discord_abc12345',
    expectedTotalPrice: 150
  });

  assert.equal(result.reason, 'runtime-mode-off');
  assert.equal(result.authorizationReady, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(queries, 0);
  assert.equal(reads, 0);
});

test('shadow mode can inspect readiness but cannot reach wallet or catalog', async () => {
  const data = fixture({ mode: 'shadow' });
  const authorization = createNexusEconomyPurchaseAuthorization(data.options);

  const result = await authorization.authorize('123456789', 'coastal', {
    requestId: 'discord_abc12345',
    expectedTotalPrice: 150
  });

  assert.equal(result.reason, 'shadow-ready');
  assert.equal(result.authorizationReady, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(data.reads, 0);
  assert.equal(data.calls.length, 1);
  assert.match(data.calls[0].sql, /pg_catalog/i);
  assertNoMutationSql(data.calls);
});

test('active mode still requires the global runtime enable flag', async () => {
  const data = fixture({ mode: 'active', runtimeEnabled: 'false' });
  const authorization = createNexusEconomyPurchaseAuthorization(data.options);

  const result = await authorization.authorize('123456789', 'coastal', {
    requestId: 'discord_abc12345',
    expectedTotalPrice: 150
  });

  assert.equal(result.reason, 'runtime-enable-flag-required');
  assert.equal(result.authorizationReady, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(data.reads, 0);
  assertNoMutationSql(data.calls);
});

test('active economy requires an additional explicit shop-purchase enable flag', async () => {
  const data = fixture({ purchasesEnabled: 'false' });
  const authorization = createNexusEconomyPurchaseAuthorization(data.options);

  const result = await authorization.authorize('123456789', 'coastal', {
    requestId: 'discord_abc12345',
    expectedTotalPrice: 150
  });

  assert.equal(result.reason, 'shop-purchase-enable-flag-required');
  assert.equal(result.authorizationReady, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(data.reads, 0);
  assertNoMutationSql(data.calls);
});

test('fully gated fresh quote creates immutable authorization without executing a purchase', async () => {
  const data = fixture({ balance: '1000', price: 150 });
  const authorization = createNexusEconomyPurchaseAuthorization(data.options);

  const result = await authorization.authorize('123456789', 'coastal', {
    quantity: 2,
    requestId: 'discord_abc12345',
    expectedTotalPrice: 300
  });

  assert.equal(result.ok, true);
  assert.equal(result.authorizationReady, true);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.reason, 'purchase-authorization-ready');
  assert.equal(result.orderId, 'shop_discord_abc12345');
  assert.equal(result.currentTotalPrice, 300);
  assert.equal(result.balance, 1000);
  assert.equal(result.projectedBalance, 700);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(data.reads, 1);
  assertNoMutationSql(data.calls);
});

test('changed quote remains fail-closed after all mutation gates are enabled', async () => {
  const data = fixture({ balance: '1000', price: 200 });
  const authorization = createNexusEconomyPurchaseAuthorization(data.options);

  const result = await authorization.authorize('123456789', 'coastal', {
    quantity: 2,
    requestId: 'discord_abc12345',
    expectedTotalPrice: 300
  });

  assert.equal(result.reason, 'purchase-quote-changed');
  assert.equal(result.authorizationReady, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.expectedTotalPrice, 300);
  assert.equal(result.currentTotalPrice, 400);
  assertNoMutationSql(data.calls);
});
