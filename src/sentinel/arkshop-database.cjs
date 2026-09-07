'use strict';

function databaseModeFromEnv() {
  const mode = String(process.env.ARKSHOP_DB_MODE || 'mysql').trim().toLowerCase();
  if (mode !== 'mysql') {
    throw new Error('ArkShop production backend is MySQL-only. SQLite is retired and available only to explicit recovery tooling.');
  }
  return 'mysql';
}

function adapter() {
  databaseModeFromEnv();
  return require('./arkshop-mysql.cjs');
}

async function databaseStatus() {
  const status = await adapter().mysqlStatus();
  return { backend: 'mysql', ...status };
}

async function databaseSchema() {
  const schema = await adapter().mysqlSchema();
  return { backend: 'mysql', ...schema };
}

async function lookupPlayer(playerId) {
  const result = await adapter().lookupPlayer(playerId);
  return { backend: 'mysql', ...result };
}

module.exports = { databaseModeFromEnv, databaseStatus, databaseSchema, lookupPlayer };
