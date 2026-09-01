'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { mysqlConfigFromEnv, validateMysqlConfig } = require('./arkshop-mysql.cjs');
const { sqliteConfigFromEnv, downloadVerifiedSnapshot } = require('./arkshop-sqlite.cjs');
const { readSqlite } = require('./arkshop-map2-sqlite-migration.cjs');
const { syncArkShopMysqlFromEnv, restoreBackup } = require('./ark-config-manager.cjs');
const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');
const { ArkRconClient } = require('./ark-rcon.cjs');
const { serverConnectionFromRecord, parseListPlayers } = require('./ark-cluster-monitor.cjs');

const PREFIX = 'ARK_GEN1';
const ENV_KEY = 'ARK_GEN1_ARKSHOP_SQLITE_TO_MYSQL_ONCE';
const POLICY = 'map1-sqlite-authoritative-v1';
const REQUIRED_COLUMNS = ['Id', 'EosId', 'Kits', 'Points', 'TotalSpent'];

function quoteId(value) {
  const text = String(value || '');
  if (!/^[A-Za-z0-9_]{1,64}$/.test(text)) throw new Error('Unsafe SQL identifier.');
  return `\`${text}\``;
}

function cleanError(error) {
  return String(error?.code || error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500);
}

function normalizedRow(row = {}) {
  return {
    EosId: String(row.EosId || ''),
    Kits: String(row.Kits ?? '{}'),
    Points: Number(row.Points || 0),
    TotalSpent: Number(row.TotalSpent || 0)
  };
}

function mergePlan(sqliteRows = [], mysqlRows = []) {
  const source = new Map(sqliteRows.map((row) => [String(row.EosId), normalizedRow(row)]));
  const target = new Map(mysqlRows.map((row) => [String(row.EosId), normalizedRow(row)]));
  if (source.size !== sqliteRows.length || target.size !== mysqlRows.length || source.has('') || target.has('')) {
    throw new Error('ArkShop player IDs are empty or duplicated.');
  }
  let insert = 0;
  let update = 0;
  let unchanged = 0;
  for (const [id, row] of source) {
    const current = target.get(id);
    if (!current) insert += 1;
    else if (current.Points === row.Points && current.Kits === row.Kits && current.TotalSpent === row.TotalSpent) unchanged += 1;
    else update += 1;
  }
  return {
    insert,
    update,
    unchanged,
    preserveMysqlOnly: [...target.keys()].filter((id) => !source.has(id)).length,
    finalRows: new Map([...target, ...source])
  };
}

async function mysqlRows(connection, config) {
  const table = quoteId(config.table);
  const [columns] = await connection.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',
    [config.database, config.table]
  );
  if (!columns.length) throw new Error(`MySQL ${config.table} table does not exist.`);
  const names = columns.map((row) => String(row.COLUMN_NAME));
  const missing = REQUIRED_COLUMNS.filter((name) => !names.includes(name));
  if (missing.length) throw new Error(`MySQL ArkShop table is missing required columns: ${missing.join(', ')}`);
  const [rows] = await connection.query(`SELECT Id,EosId,Kits,Points,TotalSpent FROM ${table} ORDER BY EosId`);
  return rows.map((row) => ({ Id: Number(row.Id), ...normalizedRow(row) }));
}

function backupTableName(now = new Date()) {
  return `ArkShopPlayers_Nexus_${now.toISOString().replace(/\D/g, '').slice(0, 14)}`;
}

async function assertEmptyServer() {
  const server = new ArkClusterRegistry().get('gen1');
  if (!server) throw new Error('MAP1 registry record is unavailable.');
  const rcon = new ArkRconClient(serverConnectionFromRecord(server));
  const players = parseListPlayers(await rcon.execute('ListPlayers'));
  if (players.length) throw new Error(`MAP1 migration requires an empty server; ${players.length} player(s) are online.`);
  return { server, rcon };
}

async function migrate({ mysqlModule } = {}) {
  if (String(process.env[ENV_KEY] || '').trim() !== POLICY) throw new Error(`Migration policy must equal ${POLICY}.`);
  const { server, rcon } = await assertEmptyServer();
  const sqliteConfig = sqliteConfigFromEnv(PREFIX);
  const snapshot = await downloadVerifiedSnapshot(sqliteConfig);
  const mysqlConfig = mysqlConfigFromEnv();
  validateMysqlConfig(mysqlConfig);
  const mysql = mysqlModule || require('mysql2/promise');
  let connection;
  let configResult;
  let backupTable = '';
  try {
    const sqlite = readSqlite(snapshot.snapshotFile);
    connection = await mysql.createConnection({
      host: mysqlConfig.host,
      port: mysqlConfig.port,
      database: mysqlConfig.database,
      user: mysqlConfig.user,
      password: mysqlConfig.password,
      connectTimeout: 15000,
      charset: 'utf8mb4',
      enableKeepAlive: true
    });
    const before = await mysqlRows(connection, mysqlConfig);
    const plan = mergePlan(sqlite.rows, before);
    backupTable = backupTableName();
    await connection.query(`CREATE TABLE ${quoteId(backupTable)} LIKE ${quoteId(mysqlConfig.table)}`);
    await connection.query(`INSERT INTO ${quoteId(backupTable)} SELECT * FROM ${quoteId(mysqlConfig.table)}`);

    await connection.beginTransaction();
    try {
      const sql = `INSERT INTO ${quoteId(mysqlConfig.table)} (EosId,Kits,Points,TotalSpent) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE Kits=VALUES(Kits),Points=VALUES(Points),TotalSpent=VALUES(TotalSpent)`;
      for (const row of sqlite.rows) {
        const value = normalizedRow(row);
        await connection.execute(sql, [value.EosId, value.Kits, value.Points, value.TotalSpent]);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    }

    const imported = await mysqlRows(connection, mysqlConfig);
    const expected = plan.finalRows;
    const actual = new Map(imported.map((row) => [row.EosId, normalizedRow(row)]));
    if (actual.size !== expected.size || [...expected].some(([id, row]) => JSON.stringify(actual.get(id)) !== JSON.stringify(row))) {
      throw new Error('MySQL verification did not match the lossless MAP1 merge plan.');
    }

    await assertEmptyServer();
    configResult = await syncArkShopMysqlFromEnv({ prefix: PREFIX, dryRun: false });
    const reload = await rcon.execute('ArkShop.Reload');
    if (/unknown command|unrecognized command|not recognized|command not found|invalid command/i.test(String(reload || ''))) {
      throw new Error('ArkShop.Reload is not supported by the live plugin.');
    }

    return {
      applied: true,
      backupTable,
      remoteBackup: configResult.backup,
      configChanged: configResult.changed,
      inserted: plan.insert,
      updatedFromActiveMap1: plan.update,
      unchanged: plan.unchanged,
      preservedMysqlOnly: plan.preserveMysqlOnly,
      finalRows: actual.size,
      restartRequired: false
    };
  } catch (error) {
    if (configResult?.backup) {
      await restoreBackup({ prefix: PREFIX, fileKey: 'arkshop', backup: configResult.backup }).catch(() => {});
      await rcon.execute('ArkShop.Reload').catch(() => {});
    }
    throw error;
  } finally {
    if (connection) await connection.end().catch(() => {});
    fs.rmSync(snapshot.snapshotFile, { force: true });
  }
}

async function runIfRequested({ stampDirectory = process.env.NEXUS_DATA_DIR || '/app/data' } = {}) {
  const request = String(process.env[ENV_KEY] || '').trim();
  if (!request) return { skipped: 'not-requested' };
  if (request !== POLICY) throw new Error(`Refusing unknown MAP1 migration policy '${request}'.`);
  const stampFile = path.join(stampDirectory, `arkshop-map1-sqlite-to-mysql-${POLICY}.done.json`);
  if (fs.existsSync(stampFile)) return { skipped: 'already-applied', stampFile };
  const result = await migrate();
  fs.mkdirSync(stampDirectory, { recursive: true });
  fs.writeFileSync(stampFile, JSON.stringify({ appliedAt: new Date().toISOString(), ...result }, null, 2), { mode: 0o600 });
  return { ...result, stampFile };
}

module.exports = { ENV_KEY, POLICY, REQUIRED_COLUMNS, normalizedRow, mergePlan, backupTableName, migrate, runIfRequested, cleanError };
