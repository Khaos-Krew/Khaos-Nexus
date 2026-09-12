'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { applyLegacyJsonMigration } = require('../src/sentinel/nexus-economy-json-postgres-migration.cjs');

function hasFlag(name) {
  return process.argv.slice(2).includes(name);
}

async function main() {
  const apply = hasFlag('--apply');
  const dataDir = process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '..', 'data');
  const file = path.resolve(process.env.NEXUS_ECONOMY_LEGACY_JSON || path.join(dataDir, 'nexus-economy.json'));
  const schema = String(process.env.NEXUS_ECONOMY_DB_SCHEMA || 'public').trim();
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));

  let pool = null;
  try {
    if (apply) {
      const connectionString = String(process.env.NEXUS_ECONOMY_DATABASE_URL || process.env.DATABASE_URL || '').trim();
      if (!connectionString) throw new Error('NEXUS_ECONOMY_DATABASE_URL or DATABASE_URL is required with --apply.');
      pool = new Pool({ connectionString, max: 2, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000 });
    }

    const result = await applyLegacyJsonMigration({ pool, state, schema, dryRun: !apply });
    console.log(JSON.stringify({
      ok: result.ok,
      dryRun: result.dryRun,
      applied: result.applied,
      source: file,
      schema,
      counts: result.plan.counts,
      currency: result.plan.currency
    }, null, 2));
  } finally {
    if (pool) await pool.end();
  }
}

main().catch((error) => {
  console.error(`[Nexus Economy Migration] ${String(error?.message || error)}`);
  process.exitCode = 1;
});
