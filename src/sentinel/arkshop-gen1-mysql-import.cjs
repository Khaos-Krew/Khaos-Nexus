'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { mysqlConfigFromEnv, validateMysqlConfig } = require('./arkshop-mysql.cjs');
const { sqliteConfigFromEnv, downloadVerifiedSnapshot } = require('./arkshop-sqlite.cjs');
const { readSqlite, EXPECTED_DB, APPROVED_DB_USERS, PLAYERS_TABLE } = require('./arkshop-map2-sqlite-migration.cjs');

const ENV_KEY = 'ARK_GEN1_ARKSHOP_IMPORT_TO_MYSQL_ONCE';

function sameState(left, right) {
  return String(left.EosId) === String(right.EosId) && String(left.Kits ?? '{}') === String(right.Kits ?? '{}') &&
    Number(left.Points || 0) === Number(right.Points || 0) && Number(left.TotalSpent || 0) === Number(right.TotalSpent || 0);
}

function planMerge(sourceRows = [], targetRows = []) {
  const target = new Map(targetRows.map((row) => [String(row.EosId), row]));
  const missing = [];
  let matching = 0;
  let conflicts = 0;
  for (const row of sourceRows) {
    const current = target.get(String(row.EosId));
    if (!current) missing.push(row);
    else if (sameState(row, current)) matching += 1;
    else conflicts += 1;
  }
  return { sourceRows: sourceRows.length, targetRows: targetRows.length, matching, missing, conflicts };
}

function validateApprovedTarget(config) {
  validateMysqlConfig(config);
  if (config.host !== EXPECTED_DB.host || config.port !== EXPECTED_DB.port || config.database !== EXPECTED_DB.database ||
      config.table !== PLAYERS_TABLE || !APPROVED_DB_USERS.has(config.user)) {
    throw new Error('MySQL target does not match the approved Citadel ArkShop database, table, and users.');
  }
}

async function readTarget(connection, database, table) {
  const [columns] = await connection.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',
    [database, table]
  );
  const names = new Set(columns.map((row) => String(row.COLUMN_NAME)));
  const required = ['Id', 'EosId', 'Kits', 'Points', 'TotalSpent'];
  const missing = required.filter((name) => !names.has(name));
  if (missing.length) throw new Error(`Existing ${table} has an incompatible schema: ${missing.join(', ')}`);
  const [rows] = await connection.query(`SELECT Id,EosId,Kits,Points,TotalSpent FROM \`${table}\` ORDER BY EosId`);
  return rows.map((row) => ({ Id: Number(row.Id), EosId: String(row.EosId), Kits: String(row.Kits ?? '{}'), Points: Number(row.Points || 0), TotalSpent: Number(row.TotalSpent || 0) }));
}

function backupName(token) {
  const digest = crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 12);
  return `NexusBackup_ArkShopPlayers_${digest}`;
}

async function migrateGen1ArkShop({ token, mysqlModule, snapshotDownloader = downloadVerifiedSnapshot } = {}) {
  if (!token) throw new Error('A unique import token is required.');
  const config = mysqlConfigFromEnv();
  validateApprovedTarget(config);
  const sqliteConfig = sqliteConfigFromEnv('ARK_GEN1');
  const snapshot = await snapshotDownloader(sqliteConfig);
  let connection;
  try {
    const source = readSqlite(snapshot.snapshotFile);
    const mysql = mysqlModule || require('mysql2/promise');
    connection = await mysql.createConnection({ host: config.host, port: config.port, database: config.database, user: config.user, password: config.password, connectTimeout: 10000, enableKeepAlive: true, charset: 'utf8mb4' });
    const before = await readTarget(connection, config.database, config.table);
    const plan = planMerge(source.rows, before);
    if (plan.conflicts) throw new Error(`Refusing MAP1 import: ${plan.conflicts} overlapping player record(s) have different points, kits, or spend state.`);
    if (!plan.missing.length) return { applied: false, sourceRows: plan.sourceRows, targetRowsBefore: plan.targetRows, inserted: 0, matching: plan.matching, backupTable: null, verified: true };

    const backupTable = backupName(token);
    await connection.query(`CREATE TABLE \`${backupTable}\` LIKE \`${config.table}\``);
    await connection.query(`INSERT INTO \`${backupTable}\` SELECT * FROM \`${config.table}\``);
    await connection.beginTransaction();
    try {
      const sql = `INSERT INTO \`${config.table}\` (EosId,Kits,Points,TotalSpent) VALUES (?,?,?,?)`;
      for (const row of plan.missing) await connection.execute(sql, [row.EosId, row.Kits, row.Points, row.TotalSpent]);
      const after = await readTarget(connection, config.database, config.table);
      const verified = planMerge(source.rows, after);
      if (verified.conflicts || verified.missing.length) throw new Error('Post-import source coverage verification failed.');
      await connection.commit();
      return { applied: true, sourceRows: plan.sourceRows, targetRowsBefore: plan.targetRows, targetRowsAfter: after.length, inserted: plan.missing.length, matching: plan.matching, backupTable, verified: true };
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    }
  } finally {
    if (connection) await connection.end().catch(() => {});
    fs.rmSync(snapshot.snapshotFile, { force: true });
  }
}

async function runIfRequested({ stampDirectory = process.env.NEXUS_DATA_DIR || '/app/data' } = {}) {
  const token = String(process.env[ENV_KEY] || '').trim();
  if (!token) return { skipped: 'not-requested' };
  const safe = token.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 100) || 'import';
  const stampFile = path.join(stampDirectory, `arkshop-gen1-mysql-import-${safe}.done.json`);
  if (fs.existsSync(stampFile)) return { skipped: 'already-applied', stampFile };
  const result = await migrateGen1ArkShop({ token });
  fs.mkdirSync(stampDirectory, { recursive: true });
  fs.writeFileSync(stampFile, JSON.stringify({ request: safe, appliedAt: new Date().toISOString(), ...result }, null, 2), { mode: 0o600 });
  return { ...result, stampFile };
}

module.exports = { ENV_KEY, sameState, planMerge, validateApprovedTarget, backupName, migrateGen1ArkShop, runIfRequested };
