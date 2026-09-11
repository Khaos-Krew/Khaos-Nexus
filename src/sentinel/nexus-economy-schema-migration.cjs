'use strict';

const { NexusEconomyPostgresRepository, sqlIdent } = require('./nexus-economy-postgres-repository.cjs');
const { NexusEconomyPostgresAudit } = require('./nexus-economy-postgres-audit.cjs');

const MIGRATION_LOCK_KEY = 'nexus-economy-schema-migration-v1';

function migrationPlan({ schema = 'public' } = {}) {
  sqlIdent(schema);
  return {
    schema,
    migrationId: 'nexus-economy-v1',
    lockKey: MIGRATION_LOCK_KEY,
    sql: [
      NexusEconomyPostgresRepository.schemaSql({ schema }),
      NexusEconomyPostgresAudit.schemaSql({ schema })
    ].join('\n')
  };
}

async function applyNexusEconomySchema({ pool, schema = 'public', apply = false } = {}) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new Error('Postgres pool with connect() is required.');
  }

  const plan = migrationPlan({ schema });
  if (apply !== true) {
    return { applied: false, dryRun: true, plan };
  }

  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [MIGRATION_LOCK_KEY]);
    await client.query(plan.sql);
    await client.query('COMMIT');
    committed = true;
    return { applied: true, dryRun: false, plan };
  } catch (error) {
    if (!committed) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  MIGRATION_LOCK_KEY,
  migrationPlan,
  applyNexusEconomySchema
};
