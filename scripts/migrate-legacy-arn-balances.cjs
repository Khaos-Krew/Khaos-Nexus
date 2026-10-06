'use strict';

const { Pool } = require('pg');
const { mysqlConfigFromEnv } = require('../src/sentinel/arkshop-mysql.cjs');
const { arnFlags } = require('../src/shared/arn-flags.cjs');
const { migrateLegacyArnBalances } = require('../src/sentinel/arn-legacy-balance-migration.cjs');

function requireMysqlConfig() {
  const config = mysqlConfigFromEnv();
  const missing = [];
  if (!config.host) missing.push('ARKSHOP_DB_HOST');
  if (!config.database) missing.push('ARKSHOP_DB_NAME');
  if (!config.user) missing.push('ARKSHOP_DB_USER');
  if (!config.password) missing.push('ARKSHOP_DB_PASSWORD');
  if (missing.length) throw new Error(`Legacy ARN MySQL variables are incomplete. Missing at runtime: ${missing.join(', ')}`);
  return config;
}

async function openMysql() {
  const config = requireMysqlConfig();
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
  return connection;
}

async function readWallets(connection, lock) {
  const sql = lock
    ? 'SELECT discord_user_id, balance FROM nexus_arn_wallets WHERE balance <> 0 ORDER BY discord_user_id FOR UPDATE'
    : 'SELECT discord_user_id, balance FROM nexus_arn_wallets WHERE balance <> 0 ORDER BY discord_user_id';
  const [rows] = await connection.query(sql);
  return rows || [];
}

async function freezeMysqlWallet(connection) {
  await connection.query(
    `CREATE TABLE IF NOT EXISTS nexus_arn_wallet_freeze (
       id INT PRIMARY KEY,
       read_only TINYINT(1) NOT NULL,
       frozen_at DATETIME(3) NOT NULL
     )`
  );
  await connection.query(
    `INSERT INTO nexus_arn_wallet_freeze (id, read_only, frozen_at)
     VALUES (1, 1, CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE read_only = 1, frozen_at = CURRENT_TIMESTAMP(3)`
  );
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (apply && arnFlags(process.env).arnEconomyWritesEnabled !== true) {
    console.log(JSON.stringify({ ok: false, reason: 'writes-disabled', applied: false }));
    process.exitCode = 1;
    return;
  }
  const connectionString = String(process.env.NEXUS_ECONOMY_DATABASE_URL || process.env.DATABASE_URL || '').trim();
  if (!connectionString) throw new Error('NEXUS_ECONOMY_DATABASE_URL or DATABASE_URL is required.');
  const schema = String(process.env.NEXUS_ECONOMY_SCHEMA || 'public').trim() || 'public';
  const connection = await openMysql();
  const pool = new Pool({ connectionString, max: 1, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000 });
  const client = await pool.connect();
  try {
    if (!apply) {
      const wallets = await readWallets(connection, false);
      const result = await migrateLegacyArnBalances({ apply: false, env: process.env, wallets, client, schema });
      console.log(JSON.stringify(result));
      return;
    }
    await connection.beginTransaction();
    try {
      const wallets = await readWallets(connection, true);
      const result = await migrateLegacyArnBalances({
        apply: true,
        env: process.env,
        wallets,
        client,
        schema,
        freezeWallet: () => freezeMysqlWallet(connection)
      });
      if (!result.ok || result.applied !== true) {
        await connection.rollback();
        console.log(JSON.stringify(result));
        process.exitCode = 1;
        return;
      }
      await connection.commit();
      console.log(JSON.stringify(result));
    } catch (error) {
      try { await connection.rollback(); } catch { /* already closed */ }
      throw error;
    }
  } finally {
    client.release();
    await pool.end();
    await connection.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[ARN Balance Migration] ${String(error?.message || error)}`);
    process.exitCode = 1;
  });
}

module.exports = { main, requireMysqlConfig, freezeMysqlWallet };
