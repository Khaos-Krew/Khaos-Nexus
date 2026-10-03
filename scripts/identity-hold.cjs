'use strict';

// Operator hold tool. Lift and place a marker with this script.
// Do not clear hold_reason with raw SQL: that skips the accrual checkpoint and the audit row.
//
//   node scripts/identity-hold.cjs place --identity <id> --reason <text> --actor <name>
//   node scripts/identity-hold.cjs lift --identity <id> --actor <name>
//   node scripts/identity-hold.cjs list
//   node scripts/identity-hold.cjs preview
//   node scripts/identity-hold.cjs --dry-run
//
// preview / --dry-run counts restricted rows the legacy-review backfill would mark.
// list shows current holds. Neither runs schema setup. Both are read-only, including
// on a database that does not have hold_reason yet (those rows count as unmarked).
// Only place and lift run runtime schema setup.

const { Pool } = require('pg');
const { NexusEconomyPostgresRuntimeRepository } = require('../src/sentinel/nexus-economy-postgres-runtime-repository.cjs');
const { PostgresEconomyAccrual } = require('../src/economy-worker/postgres-accrual.cjs');

function usage() {
  return [
    'Usage:',
    '  node scripts/identity-hold.cjs place --identity <id> --reason <text> --actor <name>',
    '  node scripts/identity-hold.cjs lift --identity <id> --actor <name>',
    '  node scripts/identity-hold.cjs list [--limit <n>]',
    '  node scripts/identity-hold.cjs preview',
    '  node scripts/identity-hold.cjs --dry-run'
  ].join('\n');
}

function parseArgs(argv) {
  const flags = { dryRun: false };
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--dry-run') {
      flags.dryRun = true;
      continue;
    }
    if (token.startsWith('--')) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${token} requires a value.`);
      flags[token.slice(2)] = value;
      index += 1;
      continue;
    }
    positionals.push(token);
  }
  return { command: positionals[0] || '', extra: positionals.slice(1), flags };
}

function databaseUrl() {
  const url = String(process.env.NEXUS_ECONOMY_DATABASE_URL || process.env.DATABASE_URL || '').trim();
  if (!url) throw new Error('NEXUS_ECONOMY_DATABASE_URL or DATABASE_URL is required.');
  return url;
}

function schemaName() {
  return String(process.env.NEXUS_ECONOMY_SCHEMA || process.env.NEXUS_ECONOMY_DB_SCHEMA || 'public').trim() || 'public';
}

async function main() {
  const { command, extra, flags } = parseArgs(process.argv.slice(2));
  if (extra.length) throw new Error(`Unexpected argument ${extra[0]}.\n${usage()}`);
  const preview = flags.dryRun || command === 'preview';
  if (!preview && !['place', 'lift', 'list'].includes(command)) {
    throw new Error(usage());
  }
  const pool = new Pool({ connectionString: databaseUrl(), max: 2, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000 });
  const repository = new NexusEconomyPostgresRuntimeRepository({ pool, schema: schemaName(), env: process.env });
  try {
    if (command === 'place' || command === 'lift') {
      await pool.query(NexusEconomyPostgresRuntimeRepository.runtimeSchemaSql({ schema: schemaName() }));
      await new PostgresEconomyAccrual({ pool, schema: schemaName(), env: process.env }).ensureSchema();
    }
    let result;
    if (preview) result = await repository.previewLegacyRestrictedHolds();
    else if (command === 'list') result = await repository.listIdentityHolds({ limit: flags.limit });
    else if (command === 'place') {
      result = await repository.placeIdentityHold(flags.identity, { reason: flags.reason, heldBy: flags.actor });
    } else {
      result = await repository.liftIdentityHoldById(flags.identity, { actor: flags.actor });
    }
    console.log(JSON.stringify(result));
    if (result.ok === false) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`[Nexus Economy] identity-hold: ${String(error?.message || error)}`);
  process.exitCode = 1;
});
