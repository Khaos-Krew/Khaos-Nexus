'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MIGRATION_LOCK_KEY,
  migrationPlan,
  applyNexusEconomySchema
} = require('../src/sentinel/nexus-economy-schema-migration.cjs');

test('economy schema migration defaults to dry-run and performs no database work', async () => {
  let connectCalls = 0;
  const pool = {
    async connect() {
      connectCalls += 1;
      throw new Error('dry-run must not connect');
    }
  };

  const result = await applyNexusEconomySchema({ pool });
  assert.equal(result.applied, false);
  assert.equal(result.dryRun, true);
  assert.equal(connectCalls, 0);
  assert.match(result.plan.sql, /nexus_economy_accounts/);
  assert.match(result.plan.sql, /nexus_economy_ledger/);
});

test('economy schema migration requires explicit apply=true and uses transaction lock', async () => {
  const calls = [];
  let releases = 0;
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
    release() { releases += 1; }
  };
  const pool = { async connect() { return client; } };

  const result = await applyNexusEconomySchema({ pool, apply: true });
  assert.equal(result.applied, true);
  assert.equal(result.dryRun, false);
  assert.equal(calls[0].sql, 'BEGIN');
  assert.match(calls[1].sql, /pg_advisory_xact_lock/);
  assert.deepEqual(calls[1].params, [MIGRATION_LOCK_KEY]);
  assert.match(calls[2].sql, /CREATE TABLE IF NOT EXISTS/);
  assert.equal(calls[3].sql, 'COMMIT');
  assert.equal(releases, 1);
});

test('economy schema migration rolls back and releases on DDL failure', async () => {
  const calls = [];
  let releases = 0;
  const client = {
    async query(sql) {
      calls.push(sql);
      if (/CREATE TABLE/.test(sql)) throw new Error('ddl failed');
      return { rows: [] };
    },
    release() { releases += 1; }
  };
  const pool = { async connect() { return client; } };

  await assert.rejects(() => applyNexusEconomySchema({ pool, apply: true }), /ddl failed/);
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.equal(releases, 1);
});

test('migration plan rejects unsafe schema identifiers before database work', () => {
  assert.throws(() => migrationPlan({ schema: 'public; DROP SCHEMA public' }), /schema name is invalid/i);
});
