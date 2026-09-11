'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createNexusEconomyPurchaseConfirmation,
  safeExpectedTotalPrice
} = require('../src/sentinel/nexus-economy-purchase-confirmation.cjs');

const READY_RELATIONS = [
  { relation_name: 'nexus_economy_accounts' },
  { relation_name: 'nexus_economy_ledger' },
  { relation_name: 'nexus_economy_audit' }
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

function fixture({ balance = '1000', price = 150, mode = 'shadow' } = {}) {
  const calls = [];
  let reads = 0;
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes('pg_catalog')) return { rows: READY_RELATIONS };
      if (String(sql).includes('nexus_economy_accounts')) return { rows: [{ balance }] };
      throw new Error(`unexpected query: ${sql}`);
    }
  };

  return {
    calls,
    get reads() { return reads; },
    options: {
      pool,
      env: {
        NEXUS_ECONOMY_RUNTIME_MODE: mode,
        NEXUS_ECONOMY_AUTHORITY: 'nexus'
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

test('expected total validation rejects unsafe values before Postgres or catalog access', async () => {
  assert.equal(safeExpectedTotalPrice(150), 150);
  assert.equal(safeExpectedTotalPrice('150'), 150);
  assert.equal(safeExpectedTotalPrice(0), null);
  assert.equal(safeExpectedTotalPrice(-1), null);
  assert.equal(safeExpectedTotalPrice(1.5), null);
  assert.equal(safeExpectedTotalPrice(Number.MAX_SAFE_INTEGER + 1), null);

  let queries = 0;
  let reads = 0;
  const confirmation = createNexusEconomyPurchaseConfirmation({
    pool: { query: async () => { queries += 1; throw new Error('must not query'); } },
    env: { NEXUS_ECONOMY_RUNTIME_MODE: 'shadow' },
    readFile: async () => { reads += 1; throw new Error('must not read'); }
  });

  const result = await confirmation.confirm('123456789', 'coastal', {
    requestId: 'req_12345678',
    expectedTotalPrice: 0
  });

  assert.equal(result.reason, 'invalid-expected-total-price');
  assert.equal(result.confirmationReady, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(queries, 0);
  assert.equal(reads, 0);
});

test('off mode remains inert and cannot confirm a purchase', async () => {
  let queries = 0;
  let reads = 0;
  const confirmation = createNexusEconomyPurchaseConfirmation({
    pool: { query: async () => { queries += 1; throw new Error('must not query'); } },
    env: { NEXUS_ECONOMY_RUNTIME_MODE: 'off', NEXUS_ECONOMY_AUTHORITY: 'nexus' },
    readFile: async () => { reads += 1; throw new Error('must not read'); }
  });

  const result = await confirmation.confirm('123456789', 'coastal', {
    requestId: 'req_12345678',
    expectedTotalPrice: 150
  });

  assert.equal(result.reason, 'runtime-mode-off');
  assert.equal(result.confirmationReady, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(queries, 0);
  assert.equal(reads, 0);
});

test('changed price fails closed with current sanitized quote and no mutation SQL', async () => {
  const data = fixture({ balance: '1000', price: 200 });
  const confirmation = createNexusEconomyPurchaseConfirmation(data.options);

  const result = await confirmation.confirm('123456789', 'coastal', {
    quantity: 2,
    requestId: 'discord_abc12345',
    expectedTotalPrice: 300
  });

  assert.equal(result.reason, 'purchase-quote-changed');
  assert.equal(result.confirmationReady, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.expectedTotalPrice, 300);
  assert.equal(result.currentTotalPrice, 400);
  assert.equal(result.balance, 1000);
  assert.equal(result.projectedBalance, 600);
  assertNoMutationSql(data.calls);
});

test('fresh insufficient balance fails closed before confirmation', async () => {
  const data = fixture({ balance: '100', price: 150 });
  const confirmation = createNexusEconomyPurchaseConfirmation(data.options);

  const result = await confirmation.confirm('123456789', 'coastal', {
    requestId: 'discord_abc12345',
    expectedTotalPrice: 150
  });

  assert.equal(result.reason, 'insufficient-balance');
  assert.equal(result.confirmationReady, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.balance, 100);
  assertNoMutationSql(data.calls);
});

test('matching fresh quote creates immutable confirmation but never permits execution', async () => {
  const data = fixture({ balance: '1000', price: 150 });
  const confirmation = createNexusEconomyPurchaseConfirmation(data.options);

  const result = await confirmation.confirm('123456789', 'coastal', {
    quantity: 3,
    requestId: 'discord_abc12345',
    expectedTotalPrice: 450
  });

  assert.equal(result.ok, true);
  assert.equal(result.confirmationReady, true);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.reason, 'purchase-confirmation-ready');
  assert.equal(result.orderId, 'shop_discord_abc12345');
  assert.equal(result.currentTotalPrice, 450);
  assert.equal(result.projectedBalance, 550);
  assert.equal(Object.isFrozen(result), true);
  assertNoMutationSql(data.calls);
});
