'use strict';

const { sqlIdent } = require('./nexus-economy-postgres-repository.cjs');

const REQUIRED_RELATIONS = Object.freeze([
  'nexus_economy_accounts',
  'nexus_economy_ledger',
  'nexus_economy_audit'
]);

async function inspectNexusEconomyReadiness({ pool, schema = 'public' } = {}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('Postgres pool with query() is required.');
  }

  // Validate before any database access. The readiness probe is deliberately
  // read-only and must never create or migrate schema as a side effect.
  sqlIdent(schema);
  const normalizedSchema = String(schema || 'public').trim();

  const result = await pool.query(
    `SELECT c.relname, c.relkind\n` +
    `FROM pg_catalog.pg_class AS c\n` +
    `JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace\n` +
    `WHERE n.nspname = $1 AND c.relname = ANY($2::text[])`,
    [normalizedSchema, REQUIRED_RELATIONS]
  );

  const found = new Map();
  for (const row of result.rows || []) {
    if (REQUIRED_RELATIONS.includes(row.relname)) found.set(row.relname, row.relkind);
  }

  const relations = Object.fromEntries(REQUIRED_RELATIONS.map((name) => [name, {
    present: found.has(name),
    relkind: found.get(name) || null
  }]));
  const missing = REQUIRED_RELATIONS.filter((name) => !found.has(name));

  return {
    ready: missing.length === 0,
    databaseReady: true,
    schema: normalizedSchema,
    relations,
    missing,
    checkedAt: new Date().toISOString(),
    mutationPerformed: false
  };
}

module.exports = {
  REQUIRED_RELATIONS,
  inspectNexusEconomyReadiness
};
