'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { createPostgresEconomyRuntime } = require('../src/economy-worker/postgres-runtime.cjs');
const { applyAdditiveEconomyMigrations } = require('../src/economy-worker/arn-tokens-migration.cjs');
const { spendWithClient, refundWithClient } = require('../src/economy-worker/arn-tokens-postgres.cjs');
const fs = require('node:fs');
const path = require('node:path');

const postgresUrl = process.env.NEXUS_TEST_POSTGRES_URL || '';
const local = (() => {
  if (!postgresUrl) return false;
  try { return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(postgresUrl).hostname); }
  catch { return false; }
})();
const skip = !postgresUrl || !local;
const LIVE = {
  ARN_DRY_RUN: 'false',
  ARN_TOKENS_ENABLED: 'true',
  ARN_ECONOMY_WRITES_ENABLED: 'true',
  ARN_ROTATION_SECRET: 'arn-rotation-secret-at-least-32-characters'
};

test('live ARN spend does not use SELECT DISTINCT FOR UPDATE', { skip }, async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/economy-worker/arn-tokens-postgres.cjs'), 'utf8');
  const spendFn = source.slice(source.indexOf('async function loadSpendIdentity'), source.indexOf('async function deliveryMarker'));
  assert.doesNotMatch(spendFn, /SELECT\s+DISTINCT/i);

  const schema = `arn_spend_${crypto.randomBytes(4).toString('hex')}`;
  const admin = new Pool({ connectionString: postgresUrl });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const env = {
    NEXUS_ECONOMY_DATABASE_URL: postgresUrl,
    NEXUS_ECONOMY_SCHEMA: schema,
    NEXUS_ECONOMY_QUARANTINE_DENYLIST: ''
  };
  const runtime = await createPostgresEconomyRuntime({ env, now: () => Date.parse('2026-10-01T00:00:00.000Z') });
  try {
    await applyAdditiveEconomyMigrations({ pool: runtime.pool, schema });
    const econId = 'econ_spender';
    const discord = '300000000000000001';
    const eos = 'EOSSPENDER01';
    await runtime.pool.query(
      `INSERT INTO "${schema}".nexus_economic_identities (economic_identity_id, status, created_at)
       VALUES ($1, 'verified', NOW())`,
      [econId]
    );
    await runtime.pool.query(
      `INSERT INTO "${schema}".nexus_economic_identity_links
       (provider, external_id, economic_identity_id, verified_at, source)
       VALUES ('discord', $1, $2, NOW(), 'test'), ('eos', $3, $2, NOW(), 'test')`,
      [discord, econId, eos]
    );
    await runtime.pool.query(
      `INSERT INTO "${schema}".nexus_economy_wallets (economic_identity_id, currency, balance)
       VALUES ($1, 'ARN_TOKENS', 2)`,
      [econId]
    );
    const raw = await runtime.pool.connect();
    const seen = [];
    const client = {
      query(text, params) {
        seen.push(String(text));
        return raw.query(text, params);
      },
      release() { return raw.release(); }
    };
    try {
      const spent = await spendWithClient(client, {
        schema,
        discordUserId: discord,
        orderId: 'pg-order-1',
        workerEnv: LIVE,
        rotation: { id: 'rot', version: 'rot', entries: [] }
      });
      assert.equal(spent.ok, true);
      assert.equal(spent.debited, true);
      assert.equal(spent.eosId, eos);
      assert.equal(spent.balance, 1);
      assert.equal(seen.some((sql) => /SELECT\s+DISTINCT[\s\S]*FOR\s+UPDATE/i.test(sql)), false);
      const minted = await refundWithClient(client, {
        schema,
        orderId: 'pg-order-1',
        workerEnv: LIVE,
        economicIdentityId: 'someone-else',
        amount: 2
      });
      assert.equal(minted.refunded, true);
      assert.equal(minted.amount, 1);
      assert.equal(minted.economicIdentityId, econId);
      const again = await refundWithClient(client, {
        schema,
        orderId: 'pg-order-1',
        workerEnv: LIVE,
        amount: 2
      });
      assert.equal(again.duplicate, true);
      const balance = await runtime.pool.query(
        `SELECT balance FROM "${schema}".nexus_economy_wallets
         WHERE economic_identity_id = $1 AND currency = 'ARN_TOKENS'`,
        [econId]
      );
      assert.equal(Number(balance.rows[0].balance), 2);
    } finally {
      client.release();
    }
  } finally {
    await runtime.close().catch(() => {});
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
});
