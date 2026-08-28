'use strict';

function databaseModeFromEnv() {
  const mode = String(process.env.ARKSHOP_DB_MODE || 'mysql').trim().toLowerCase();
  if (!['mysql', 'sqlite'].includes(mode)) throw new Error('ARKSHOP_DB_MODE must be mysql or sqlite.');
  return mode;
}

function adapter() {
  return databaseModeFromEnv() === 'sqlite'
    ? require('./arkshop-sqlite.cjs')
    : require('./arkshop-mysql.cjs');
}

async function databaseStatus() {
  const mode = databaseModeFromEnv();
  const status = mode === 'sqlite' ? await adapter().sqliteStatus('ARK_GEN1') : await adapter().mysqlStatus();
  return { backend: mode, ...status };
}

async function databaseSchema() {
  const mode = databaseModeFromEnv();
  const schema = mode === 'sqlite' ? await adapter().sqliteSchema('ARK_GEN1') : await adapter().mysqlSchema();
  return { backend: mode, ...schema };
}

async function lookupPlayer(playerId) {
  const mode = databaseModeFromEnv();
  const result = mode === 'sqlite' ? await adapter().lookupPlayer(playerId, 'ARK_GEN1') : await adapter().lookupPlayer(playerId);
  return { backend: mode, ...result };
}

module.exports = { databaseModeFromEnv, databaseStatus, databaseSchema, lookupPlayer };
