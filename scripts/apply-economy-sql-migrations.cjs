'use strict';

const { Pool } = require('pg');
const { applyAdditiveEconomyMigrations } = require('../src/economy-worker/arn-tokens-migration.cjs');

async function main() {
  const connectionString = String(process.env.NEXUS_ECONOMY_DATABASE_URL || process.env.DATABASE_URL || '').trim();
  if (!connectionString) throw new Error('NEXUS_ECONOMY_DATABASE_URL or DATABASE_URL is required.');
  const schema = String(process.env.NEXUS_ECONOMY_SCHEMA || 'public').trim() || 'public';
  const pool = new Pool({ connectionString, max: 1, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000 });
  try {
    const result = await applyAdditiveEconomyMigrations({ pool, schema });
    console.log(JSON.stringify({ ok: true, schema, applied: result.applied }));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`[Nexus Economy Migration] ${String(error?.message || error)}`);
  process.exitCode = 1;
});
