'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sqlIdent } = require('../sentinel/nexus-economy-postgres-repository.cjs');

const COIN_SHOP_MIGRATION_ID = '2026-10-06-coin-shop';
const SQL_PATH = path.resolve(__dirname, '../../migrations/2026-10-06-coin-shop.sql');

function coinShopSchemaSql(schema = 'public') {
  const raw = fs.readFileSync(SQL_PATH, 'utf8');
  return raw.replaceAll('{{schema}}', sqlIdent(schema));
}

async function applyCoinShopMigration({ pool, schema = 'public' } = {}) {
  if (!pool) throw new Error('Postgres pool is required.');
  const s = sqlIdent(schema);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`nexus-economy:${COIN_SHOP_MIGRATION_ID}`]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${s}.nexus_economy_schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        row_count INTEGER NOT NULL DEFAULT 0
      )`
    );
    const existing = await client.query(
      `SELECT id FROM ${s}.nexus_economy_schema_migrations WHERE id = $1`,
      [COIN_SHOP_MIGRATION_ID]
    );
    if (existing.rows[0]) {
      await client.query('COMMIT');
      return { ok: true, skipped: 'already-applied', id: COIN_SHOP_MIGRATION_ID };
    }
    await client.query(coinShopSchemaSql(schema));
    await client.query(
      `INSERT INTO ${s}.nexus_economy_schema_migrations (id, row_count) VALUES ($1, 0)`,
      [COIN_SHOP_MIGRATION_ID]
    );
    await client.query('COMMIT');
    return { ok: true, applied: true, id: COIN_SHOP_MIGRATION_ID };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  COIN_SHOP_MIGRATION_ID,
  coinShopSchemaSql,
  applyCoinShopMigration
};
