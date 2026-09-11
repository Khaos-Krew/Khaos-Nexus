'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createNexusEconomyWalletReadService } = require('../src/sentinel/nexus-economy-wallet-read-service.cjs');

const READY_RELATIONS = [
  { relation_name: 'nexus_economy_accounts' },
  { relation_name: 'nexus_economy_ledger' },
  { relation_name: 'nexus_economy_audit' }
];

test('off mode returns unavailable wallet without querying Postgres', async () => {
  let queries = 0;
  const pool = { query: async () => { queries += 1; throw new Error('must not query'); } };
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

test('shadow-ready mode allows a read-only wallet balance lookup', async () => {
  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (String(sql).includes('pg_catalog')) return { rows: READY_RELATIONS };
      if (String(sql).includes('nexus_economy_accounts')) return { rows: [{ balance: '250' }] };
      throw new Error(`unexpected query: ${sql}`);
    }
  };
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

test('readiness failure fails closed before wallet balance query', async () => {
  let queries = 0;
  const pool = {
    query: async () => {
      queries += 1;
      throw new Error('postgres://user:password@private-host/db');
    }
  };
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
  const pool = {
    query: async (sql) => {
      queries += 1;
      if (String(sql).includes('pg_catalog')) return { rows: READY_RELATIONS };
      throw new Error('account query should not run');
    }
  };
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
