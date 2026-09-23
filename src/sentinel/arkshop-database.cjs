'use strict';

const RETIRED_VALUES = new Set(['disabled', 'off', 'retired', 'none', 'false', '0']);

function isArkShopMysqlRetired(env = process.env) {
  const source = env || process.env;
  const mode = String(source.ARKSHOP_DB_MODE || '').trim().toLowerCase();
  if (RETIRED_VALUES.has(mode)) return true;
  const flag = String(source.NEXUS_ARKSHOP_MYSQL_ENABLED ?? '').trim().toLowerCase();
  return RETIRED_VALUES.has(flag);
}

function databaseModeFromEnv(env = process.env) {
  if (isArkShopMysqlRetired(env)) return 'retired';
  const mode = String((env || process.env).ARKSHOP_DB_MODE || 'mysql').trim().toLowerCase();
  if (mode !== 'mysql') {
    throw new Error('ArkShop production backend is MySQL-only. SQLite is retired and available only to explicit recovery tooling.');
  }
  return 'mysql';
}

function adapter() {
  if (databaseModeFromEnv() === 'retired') return null;
  return require('./arkshop-mysql.cjs');
}

async function databaseStatus() {
  if (databaseModeFromEnv() === 'retired') return { backend: 'retired', connected: false };
  const status = await adapter().mysqlStatus();
  return { backend: 'mysql', ...status };
}

async function databaseSchema() {
  if (databaseModeFromEnv() === 'retired') return { backend: 'retired', connected: false, columns: [] };
  const schema = await adapter().mysqlSchema();
  return { backend: 'mysql', ...schema };
}

async function lookupPlayer(playerId) {
  if (databaseModeFromEnv() === 'retired') return { backend: 'retired', connected: false, player: null };
  const result = await adapter().lookupPlayer(playerId);
  return { backend: 'mysql', ...result };
}

module.exports = { isArkShopMysqlRetired, databaseModeFromEnv, databaseStatus, databaseSchema, lookupPlayer };
