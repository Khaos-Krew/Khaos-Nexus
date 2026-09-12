'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createNexusEconomyWalletReadService } = require('../src/sentinel/nexus-economy-wallet-read-service.cjs');

const READY_RELATIONS = [
  { relname: 'nexus_economy_accounts', relkind: 'r' },
  { relname: 'nexus_economy_ledger', relkind: 'r' },
  { relname: 'nexus_economy_audit', relkind: 'r' }
];

function readOnlyPool(query) {
  return {
    query,
    connect: async () => { throw new Error('read-only path must not open a transaction'); }
  };
}

test('off mode returns unavailable wallet without querying Postgres', async () => {
  let queries = 0;
  const pool = readOnlyPool(async () => { queries += 1; throw new Error('must not query'); });
  const service = createNexusEconomyWalletReadService({
    pool,
    env: { NEXUS_ECONOMY_RUNTIME_MODE: 'off' }
  });

  const result = await service.getBalance('123456789');

  assert.equal(queries, 0);
  assert.deepEqual(result, {
    ok: false,
    available: false,
    mode: 'off',
    reason: 'runtime-mode-off',
    balance: null
  });
});

test('off mode wallet snapshot is inert and returns no ledger entries', async () => {
  let queries = 0;
  const pool = readOnlyPool(async () => { queries += 1; throw new Error('must not query'); });
  const service = createNexusEconomyWalletReadService({
    pool,
    env: { NEXUS_ECONOMY_RUNTIME_MODE: 'off' }
  });

  const result = await service.getSnapshot('123456789');

  assert.equal(queries, 0);
  assert.deepEqual(result, {
    ok: false,
    available: false,
    mode: 'off',
    reason: 'runtime-mode-off',
    balance: null,
    entries: []
  });
});

test('shadow-ready mode allows a read-only wallet balance lookup', async () => {
  const calls = [];
  const pool = readOnlyPool(async (sql, params) => {
    calls.push({ sql, params });
    if (String(sql).includes('pg_catalog')) return { rows: READY_RELATIONS };
    if (String(sql).includes('nexus_economy_accounts')) return { rows: [{ balance: '250' }] };
    throw new Error(`unexpected query: ${sql}`);
  });
  const service = createNexusEconomyWalletReadService({
    pool,
    env: {
      NEXUS_ECONOMY_RUNTIME_MODE: 'shadow',
      NEXUS_ECONOMY_AUTHORITY: 'nexus'
    }
  });

  const result = await service.getBalance('123456789');

  assert.deepEqual(result, {
    ok: true,
    available: true,
    mode: 'shadow',
    reason: 'shadow-ready',
    balance: 250
  });
  assert.equal(calls.length, 2);
  assert.equal(calls.some(({ sql }) => /INSERT|UPDATE|DELETE|CREATE|ALTER|DROP/i.test(String(sql))), false);
});

test('shadow-ready wallet snapshot returns balance and sanitized recent ledger history only', async () => {
  const calls = [];
  const pool = readOnlyPool(async (sql, params) => {
    calls.push({ sql, params });
    if (String(sql).includes('pg_catalog')) return { rows: READY_RELATIONS };
    if (String(sql).includes('nexus_economy_accounts')) return { rows: [{ balance: '250' }] };
    if (String(sql).includes('nexus_economy_ledger')) {
      return {
        rows: [{
          id: '41',
          amount: '25',
          balance_after: '250',
          entry_type: 'cache-token-credit',
          source: 'dino-cache',
          created_at: '2026-09-11T12:00:00.000Z'
        }]
      };
    }
    throw new Error(`unexpected query: ${sql}`);
  });
  const service = createNexusEconomyWalletReadService({
    pool,
    env: {
      NEXUS_ECONOMY_RUNTIME_MODE: 'shadow',
      NEXUS_ECONOMY_AUTHORITY: 'nexus'
    }
  });

  const result = await service.getSnapshot('123456789', { limit: 5 });

  assert.deepEqual(result, {
    ok: true,
    available: true,
    mode: 'shadow',
    reason: 'shadow-ready',
    balance: 250,
    entries: [{
      id: '41',
      amount: 25,
      balanceAfter: 250,
      type: 'cache-token-credit',
      source: 'dino-cache',
      at: '2026-09-11T12:00:00.000Z'
    }]
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2].params, ['123456789', 5]);
  assert.equal(calls.some(({ sql }) => /INSERT|UPDATE|DELETE|CREATE|ALTER|DROP/i.test(String(sql))), false);
  assert.equal(JSON.stringify(result).includes('idempotency'), false);
  assert.equal(JSON.stringify(result).includes('metadata'), false);
});

test('wallet snapshot rejects invalid ledger limits before any database access', async () => {
  let queries = 0;
  const pool = readOnlyPool(async () => { queries += 1; throw new Error('must not query'); });
  const service = createNexusEconomyWalletReadService({
    pool,
    env: {
      NEXUS_ECONOMY_RUNTIME_MODE: 'shadow',
      NEXUS_ECONOMY_AUTHORITY: 'nexus'
    }
  });

  await assert.rejects(() => service.getSnapshot('123456789', { limit: 500 }), /Ledger limit/);
  assert.equal(queries, 0);
});

test('readiness failure fails closed before wallet balance query', async () => {
  let queries = 0;
  const pool = readOnlyPool(async () => {
    queries += 1;
    throw new Error('postgres://user:password@private-host/db');
  });
  const service = createNexusEconomyWalletReadService({
    pool,
    env: {
      NEXUS_ECONOMY_RUNTIME_MODE: 'shadow',
      NEXUS_ECONOMY_AUTHORITY: 'nexus'
    }
  });

  const result = await service.getBalance('123456789');

  assert.equal(queries, 1);
  assert.equal(result.ok, false);
  assert.equal(result.available, false);
  assert.equal(result.balance, null);
  assert.equal(result.reason, 'economy-not-ready');
  assert.equal(JSON.stringify(result).includes('password'), false);
  assert.equal(JSON.stringify(result).includes('private-host'), false);
});

test('invalid Discord user id is rejected before account read after readiness succeeds', async () => {
  let queries = 0;
  const pool = readOnlyPool(async (sql) => {
    queries += 1;
    if (String(sql).includes('pg_catalog')) return { rows: READY_RELATIONS };
    throw new Error('account query should not run');
  });
  const service = createNexusEconomyWalletReadService({
    pool,
    env: {
      NEXUS_ECONOMY_RUNTIME_MODE: 'shadow',
      NEXUS_ECONOMY_AUTHORITY: 'nexus'
    }
  });

  await assert.rejects(() => service.getBalance('bad user id'), /Discord user ID is invalid/);
  assert.equal(queries, 1);
});
