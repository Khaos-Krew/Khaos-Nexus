'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  ADDITIVE_MIGRATIONS,
  MIGRATION_ID,
  CONTROL_MIGRATION_ID,
  applyAdditiveEconomyMigrations
} = require('../src/economy-worker/arn-tokens-migration.cjs');
const { migrateLegacyArnBalances } = require('../src/sentinel/arn-legacy-balance-migration.cjs');
const { arnRequestBody } = require('../src/economy-worker/server.cjs');
const { arnRequestBody: clientBody } = require('../src/sentinel/nexus-economy-client.cjs');

test('the ARN currency migration is an additive file and is not applied on worker boot', async () => {
  assert.deepEqual(ADDITIVE_MIGRATIONS.map((entry) => entry.file), ['003-arn-tokens-events.sql', '005-arn-tokens-control.sql']);
  assert.equal(MIGRATION_ID, 'arn-tokens-main-ledger-currency');
  assert.equal(CONTROL_MIGRATION_ID, 'arn-tokens-control');
  const control = fs.readFileSync(path.join(__dirname, '../db/migrations/005-arn-tokens-control.sql'), 'utf8');
  assert.match(control, /CREATE TABLE IF NOT EXISTS nexus_economy_arn_control/);
  assert.doesNotMatch(control, /DROP\s+CONSTRAINT|ALTER\s+TABLE/i);
  const events = fs.readFileSync(path.join(__dirname, '../db/migrations/003-arn-tokens-events.sql'), 'utf8');
  const check = fs.readFileSync(path.join(__dirname, '../db/migrations/004-arn-tokens-currency-check.sql'), 'utf8');
  assert.match(events, /CREATE TABLE IF NOT EXISTS nexus_economy_arn_events/);
  assert.doesNotMatch(events, /DROP\s+CONSTRAINT|ALTER\s+TABLE/i);
  assert.match(check, /NOT VALID/);
  assert.match(check, /VALIDATE CONSTRAINT/);
  assert.doesNotMatch(ADDITIVE_MIGRATIONS.map((entry) => entry.file).join('\n'), /004-arn-tokens-currency-check/);
  const runtime = fs.readFileSync(path.join(__dirname, '../src/economy-worker/postgres-runtime.cjs'), 'utf8');
  assert.doesNotMatch(runtime, /applyAdditiveEconomyMigrations|003-arn-tokens-events|004-arn-tokens-currency-check|DROP CONSTRAINT/);

  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push(String(sql));
      if (/schema_migrations WHERE/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
    release() {}
  };
  const pool = { async connect() { return client; } };
  const first = await applyAdditiveEconomyMigrations({ pool, schema: 'public' });
  assert.deepEqual(first.applied, [MIGRATION_ID, CONTROL_MIGRATION_ID]);
  assert.equal(calls.some((sql) => /DROP\s+CONSTRAINT/i.test(sql)), false);
  assert.equal(calls.some((sql) => /nexus_economy_arn_events/.test(sql)), true);
  assert.equal(calls.filter((sql) => sql === 'BEGIN').length, 1);

  const poisoned = {
    messageId: 'm',
    env: { ARN_DRY_RUN: 'false' },
    workerEnv: { ARN_DRY_RUN: 'false' },
    orderId: 'o',
    roll: 0,
    seed: 'exposed',
    creditsEnabled: true,
    graceMs: 0
  };
  assert.deepEqual(arnRequestBody(poisoned), { messageId: 'm', orderId: 'o' });
  assert.deepEqual(clientBody(poisoned), { messageId: 'm', orderId: 'o' });
  assert.deepEqual(migrateLegacyArnBalances(), { ok: false, reason: 'pending-owner-decision', applied: false });
  const worker = fs.readFileSync(path.join(__dirname, '../src/economy-worker/arn-tokens-postgres.cjs'), 'utf8');
  assert.doesNotMatch(runtime, /migrateLegacyArnBalances|005-arn-tokens-control/);
  assert.doesNotMatch(worker, /migrateLegacyArnBalances|arn-dry-run\.json/);
});
