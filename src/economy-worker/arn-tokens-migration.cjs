'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sqlIdent } = require('../sentinel/nexus-economy-postgres-repository.cjs');
const { MIGRATION_ID, CONTROL_MIGRATION_ID } = require('./arn-tokens-postgres.cjs');

const HOLDS_MIGRATION_ID = 'arn-tokens-legacy-holds';
const ADDITIVE_MIGRATIONS = Object.freeze([
  Object.freeze({ id: MIGRATION_ID, file: '003-arn-tokens-events.sql' }),
  Object.freeze({ id: CONTROL_MIGRATION_ID, file: '005-arn-tokens-control.sql' }),
  Object.freeze({ id: HOLDS_MIGRATION_ID, file: '006-arn-tokens-migration-holds.sql' })
]);

function migrationsDir() {
  return path.resolve(__dirname, '../../db/migrations');
}

function sqlStatements(sql) {
  return String(sql || '')
    .split(/;\s*(?:\r?\n|$)/)
    .map((part) => part.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
}

function loadAdditiveMigration(entry, dir = migrationsDir()) {
  const file = path.join(dir, entry.file);
  const statements = sqlStatements(fs.readFileSync(file, 'utf8'));
  for (const statement of statements) {
    if (/DROP\s+CONSTRAINT|ALTER\s+TABLE/i.test(statement)) {
      throw new Error(`${entry.file} is not an additive migration.`);
    }
  }
  return { id: entry.id, file, statements };
}

async function applyAdditiveEconomyMigrations({ pool, schema = 'public', dir } = {}) {
  if (!pool || typeof pool.connect !== 'function') throw new Error('Economy SQL migrations require a pool.');
  const migrations = ADDITIVE_MIGRATIONS.map((entry) => loadAdditiveMigration(entry, dir));
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`nexus-economy:${MIGRATION_ID}`]);
    const schemaSql = sqlIdent(schema);
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${schemaSql}.nexus_economy_schema_migrations (
         id TEXT PRIMARY KEY,
         row_count BIGINT NOT NULL DEFAULT 0,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`
    );
    await client.query(`SET LOCAL search_path TO ${schemaSql}`);
    for (const migration of migrations) {
      const existing = await client.query(
        `SELECT id FROM ${schemaSql}.nexus_economy_schema_migrations WHERE id = $1`,
        [migration.id]
      );
      if (existing.rows?.[0]) continue;
      for (const statement of migration.statements) await client.query(statement);
      await client.query(
        `INSERT INTO ${schemaSql}.nexus_economy_schema_migrations (id, row_count) VALUES ($1, 0)`,
        [migration.id]
      );
      applied.push(migration.id);
    }
    await client.query('COMMIT');
    return { ok: true, applied };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  ADDITIVE_MIGRATIONS,
  MIGRATION_ID,
  CONTROL_MIGRATION_ID,
  HOLDS_MIGRATION_ID,
  sqlStatements,
  loadAdditiveMigration,
  applyAdditiveEconomyMigrations
};
