'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createNexusEconomyPurchaseIntent,
  normalizeRequestId
} = require('../src/sentinel/nexus-economy-purchase-intent.cjs');

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
    }
  }
};

function fixture(balance = '1000', mode = 'shadow') {
  const calls = [];
  let reads = 0;
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes('pg_catalog')) return { rows: READY_RELATIONS };
      if (String(sql).includes('nexus_economy_accounts')) return { rows: [{ balance }] };
      throw new Error(`unexpected query: ${sql}`);
    },
    connect: async () => { throw new Error('read-only intent path must not connect'); }
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
        return JSON.stringify(CATALOG);
      }
    }
  };
}

test('request id validation is bounded and wallet-compatible', () => {
  const maxRequestId = `r${'a'.repeat(122)}`;
  assert.equal(normalizeRequestId('req_12345678'), 'req_12345678');
  assert.equal(normalizeRequestId(maxRequestId), maxRequestId);
  assert.equal(`shop_${maxRequestId}`.length, 128);
  assert.equal(normalizeRequestId('short'), null);
  assert.equal(normalizeRequestId('../unsafe-request'), null);
  assert.equal(normalizeRequestId(`r${'a'.repeat(123)}`), null);
});

test('invalid request id is rejected before Postgres or catalog access', async () => {
  let queries = 0;
  let reads = 0;
  const intent = createNexusEconomyPurchaseIntent({
    pool: {
      query: async () => { queries += 1; throw new Error('must not query'); },
      connect: async () => { throw new Error('must not connect'); }
    },
    env: { NEXUS_ECONOMY_RUNTIME_MODE: 'shadow' },
    readFile: async () => { reads += 1; throw new Error('must not read'); }
  });

  const result = await intent.prepare('123456789', 'coastal', { requestId: '../bad' });

  assert.equal(result.reason, 'invalid-purchase-request-id');
  assert.equal(result.intentReady, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(queries, 0);
  assert.equal(reads, 0);
});

test('invalid Discord user id is rejected before Postgres or catalog access', async () => {
  let queries = 0;
  let reads = 0;
  const intent = createNexusEconomyPurchaseIntent({
    pool: {
      query: async () => { queries += 1; throw new Error('must not query'); },
      connect: async () => { throw new Error('must not connect'); }
    },
    env: { NEXUS_ECONOMY_RUNTIME_MODE: 'shadow' },
    readFile: async () => { reads += 1; throw new Error('must not read'); }
  });

  const result = await intent.prepare('../user', 'coastal', { requestId: 'req_12345678' });

  assert.equal(result.reason, 'invalid-discord-user-id');
  assert.equal(result.requestId, 'req_12345678');
  assert.equal(result.executionPermitted, false);
  assert.equal(queries, 0);
  assert.equal(reads, 0);
});

test('off mode remains inert and cannot create an intent', async () => {
  let queries = 0;
  let reads = 0;
  const intent = createNexusEconomyPurchaseIntent({
    pool: {
      query: async () => { queries += 1; throw new Error('must not query'); },
      connect: async () => { throw new Error('must not connect'); }
    },
    env: { NEXUS_ECONOMY_RUNTIME_MODE: 'off', NEXUS_ECONOMY_AUTHORITY: 'nexus' },
    readFile: async () => { reads += 1; throw new Error('must not read'); }
  });

  const result = await intent.prepare('123456789', 'coastal', { requestId: 'req_12345678' });

  assert.equal(result.reason, 'runtime-mode-off');
  assert.equal(result.intentReady, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(queries, 0);
  assert.equal(reads, 0);
});

test('shadow mode creates an immutable idempotency-ready intent without mutation SQL', async () => {
  const data = fixture('1000');
  const intent = createNexusEconomyPurchaseIntent(data.options);

  const result = await intent.prepare('123456789', 'coastal', {
    quantity: 3,
    requestId: 'discord_abc12345'
  });

  assert.equal(result.ok, true);
  assert.equal(result.intentReady, true);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.reason, 'purchase-intent-ready');
  assert.equal(result.mode, 'shadow');
  assert.equal(result.requestId, 'discord_abc12345');
  assert.equal(result.orderId, 'shop_discord_abc12345');
  assert.equal(result.discordUserId, '123456789');
  assert.equal(result.itemId, 'coastal');
  assert.equal(result.quantity, 3);
  assert.equal(result.unitPrice, 150);
  assert.equal(result.totalPrice, 450);
  assert.equal(result.balance, 1000);
  assert.equal(result.projectedBalance, 550);
  assert.equal(result.shortfall, 0);
  assert.equal(data.reads, 1);
  assert.equal(data.calls.some(({ sql }) => /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(sql)), false);
  assert.equal(JSON.stringify(result).includes('SpawnDinoInBall'), false);
  assert.equal(Object.isFrozen(result), true);
});

test('insufficient balance never creates an intent', async () => {
  const data = fixture('200');
  const intent = createNexusEconomyPurchaseIntent(data.options);

  const result = await intent.prepare('123456789', 'coastal', {
    quantity: 2,
    requestId: 'discord_def12345'
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'insufficient-balance');
  assert.equal(result.intentReady, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.totalPrice, 300);
  assert.equal(result.balance, 200);
  assert.equal(result.shortfall, 100);
  assert.equal(result.orderId, null);
});
