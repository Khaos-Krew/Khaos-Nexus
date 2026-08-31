'use strict';

function mysqlConfigFromEnv() {
  const port = Number(process.env.ARKSHOP_DB_PORT || 3306);
  const table = String(process.env.ARKSHOP_DB_TABLE || 'ArkShopPlayers').trim();
  if (!/^[A-Za-z0-9_]{1,64}$/.test(table)) throw new Error('ARKSHOP_DB_TABLE contains unsafe characters.');
  return {
    host: String(process.env.ARKSHOP_DB_HOST || '').trim(),
    port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 3306,
    database: String(process.env.ARKSHOP_DB_NAME || '').trim(),
    user: String(process.env.ARKSHOP_DB_USER || '').trim(),
    password: String(process.env.ARKSHOP_DB_PASSWORD || ''),
    table,
    connectTimeout: 8000
  };
}

function validateMysqlConfig(config) {
  const missing = [];
  if (!config.host) missing.push('ARKSHOP_DB_HOST');
  if (!config.database) missing.push('ARKSHOP_DB_NAME');
  if (!config.user) missing.push('ARKSHOP_DB_USER');
  if (!config.password) missing.push('ARKSHOP_DB_PASSWORD');
  if (missing.length) throw new Error(`ArkShop MySQL variables are incomplete. Missing at runtime: ${missing.join(', ')}`);
}

async function connectMysql() {
  const config = mysqlConfigFromEnv();
  validateMysqlConfig(config);
  let mysql;
  try { mysql = require('mysql2/promise'); } catch {
    throw new Error('mysql2 runtime dependency is not installed.');
  }
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    connectTimeout: config.connectTimeout,
    enableKeepAlive: true,
    charset: 'utf8mb4'
  });
  return { connection, config };
}

async function mysqlStatus() {
  const { connection, config } = await connectMysql();
  try {
    const [pingRows] = await connection.query('SELECT 1 AS ok');
    const [tableRows] = await connection.query(
      'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1',
      [config.database, config.table]
    );
    return {
      connected: Number(pingRows?.[0]?.ok) === 1,
      database: config.database,
      table: config.table,
      tableExists: tableRows.length > 0
    };
  } finally {
    await connection.end().catch(() => {});
  }
}

async function mysqlSchema() {
  const { connection, config } = await connectMysql();
  try {
    const [rows] = await connection.query(
      'SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
      [config.database, config.table]
    );
    return { database: config.database, table: config.table, columns: rows };
  } finally {
    await connection.end().catch(() => {});
  }
}

async function lookupPlayer(playerId) {
  const id = String(playerId || '').trim();
  if (!/^\d{5,30}$/.test(id)) throw new Error('ArkShop player/Steam ID must be numeric.');
  const { connection, config } = await connectMysql();
  try {
    const [columns] = await connection.query(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      [config.database, config.table]
    );
    const names = new Set(columns.map((row) => String(row.COLUMN_NAME)));
    const idColumn = ['SteamId', 'SteamID', 'steam_id', 'PlayerId', 'PlayerID'].find((name) => names.has(name));
    if (!idColumn) throw new Error('Could not identify the ArkShop player ID column from the live table schema.');
    const safeColumns = ['SteamId', 'SteamID', 'steam_id', 'PlayerId', 'PlayerID', 'Points', 'Kits', 'TotalSpent', 'Name'].filter((name) => names.has(name));
    const select = safeColumns.length ? safeColumns.map((name) => `\`${name}\``).join(', ') : `\`${idColumn}\``;
    const [rows] = await connection.execute(`SELECT ${select} FROM \`${config.table}\` WHERE \`${idColumn}\` = ? LIMIT 1`, [id]);
    return { table: config.table, idColumn, player: rows[0] || null };
  } finally {
    await connection.end().catch(() => {});
  }
}

module.exports = {
  mysqlConfigFromEnv,
  validateMysqlConfig,
  connectMysql,
  mysqlStatus,
  mysqlSchema,
  lookupPlayer
};
