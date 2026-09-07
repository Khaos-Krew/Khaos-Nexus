'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { mysqlConfigFromEnv, validateMysqlConfig } = require('./arkshop-mysql.cjs');
const { sqliteConfigFromEnv, downloadVerifiedSnapshot } = require('./arkshop-sqlite.cjs');
const { readSqlite } = require('./arkshop-map2-sqlite-migration.cjs');
const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');
const { ArkRconClient } = require('./ark-rcon.cjs');
const { serverConnectionFromRecord, parseListPlayers } = require('./ark-cluster-monitor.cjs');

const PREFIX = 'ARK_GEN1';
const ENV_KEY = 'ARK_GEN1_ARKSHOP_POINTS_RECOVERY_ONCE';
const POLICY = 'restore-sqlite-balance-floor-v1';

function quoteId(value) {
  const text = String(value || '');
  if (!/^[A-Za-z0-9_]{1,64}$/.test(text)) throw new Error('Unsafe SQL identifier.');
  return `\`${text}\``;
}

function backupTableName(now = new Date()) {
  return `ArkShopPlayers_Nexus_PointsRecovery_${now.toISOString().replace(/\D/g, '').slice(0, 14)}`;
}

async function assertEmptyServer() {
  const server = new ArkClusterRegistry().get('gen1');
  if (!server) throw new Error('MAP1 registry record is unavailable.');
  const rcon = new ArkRconClient(serverConnectionFromRecord(server));
  const players = parseListPlayers(await rcon.execute('ListPlayers'));
  if (players.length) throw new Error(`MAP1 points recovery requires an empty server; ${players.length} player(s) are online.`);
  return { server, rcon };
}

async function loadMysqlRows(connection, config) {
  const table = quoteId(config.table);
  const [columns] = await connection.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',
    [config.database, config.table]
  );
  const names = new Set(columns.map((row) => String(row.COLUMN_NAME)));
  for (const required of ['EosId', 'Kits', 'Points', 'TotalSpent']) {
    if (!names.has(required)) throw new Error(`MySQL ArkShop table is missing required column ${required}.`);
  }
  const [rows] = await connection.query(`SELECT EosId,Kits,Points,TotalSpent FROM ${table} ORDER BY EosId`);
  return rows.map((row) => ({
    EosId: String(row.EosId || ''),
    Kits: String(row.Kits ?? '{}'),
    Points: Number(row.Points || 0),
    TotalSpent: Number(row.TotalSpent || 0)
  }));
}

async function recover({ mysqlModule } = {}) {
  if (String(process.env[ENV_KEY] || '').trim() !== POLICY) {
    throw new Error(`Points recovery policy must equal ${POLICY}.`);
  }

  await assertEmptyServer();
  const sqliteConfig = sqliteConfigFromEnv(PREFIX);
  const snapshot = await downloadVerifiedSnapshot(sqliteConfig);
  const mysqlConfig = mysqlConfigFromEnv();
  validateMysqlConfig(mysqlConfig);
  const mysql = mysqlModule || require('mysql2/promise');
  let connection;
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

    const before = await loadMysqlRows(connection, mysqlConfig);
    const oldById = new Map(sqlite.rows.map((row) => [String(row.EosId), row]));
    const newById = new Map(before.map((row) => [String(row.EosId), row]));
    if (oldById.has('') || newById.has('') || oldById.size !== sqlite.rows.length || newById.size !== before.length) {
      throw new Error('ArkShop player IDs are empty or duplicated; recovery refused.');
    }

    let raised = 0;
    let unchanged = 0;
    let mysqlHigherPreserved = 0;
    let inserted = 0;
    let pointsAdded = 0;

    backupTable = backupTableName();
    await connection.query(`CREATE TABLE ${quoteId(backupTable)} LIKE ${quoteId(mysqlConfig.table)}`);
    await connection.query(`INSERT INTO ${quoteId(backupTable)} SELECT * FROM ${quoteId(mysqlConfig.table)}`);

    await connection.beginTransaction();
    try {
      for (const [eosId, oldRow] of oldById) {
        const current = newById.get(eosId);
        if (!current) {
          await connection.execute(
            `INSERT INTO ${quoteId(mysqlConfig.table)} (EosId,Kits,Points,TotalSpent) VALUES (?,?,?,?)`,
            [eosId, String(oldRow.Kits ?? '{}'), Number(oldRow.Points || 0), Number(oldRow.TotalSpent || 0)]
          );
          inserted += 1;
          pointsAdded += Number(oldRow.Points || 0);
          continue;
        }

        const oldPoints = Number(oldRow.Points || 0);
        const currentPoints = Number(current.Points || 0);
        if (currentPoints < oldPoints) {
          await connection.execute(
            `UPDATE ${quoteId(mysqlConfig.table)} SET Points=? WHERE EosId=?`,
            [oldPoints, eosId]
          );
          raised += 1;
          pointsAdded += oldPoints - currentPoints;
        } else if (currentPoints > oldPoints) {
          mysqlHigherPreserved += 1;
        } else {
          unchanged += 1;
        }
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    }

    const after = await loadMysqlRows(connection, mysqlConfig);
    const afterById = new Map(after.map((row) => [row.EosId, row]));
    for (const [eosId, oldRow] of oldById) {
      const restored = afterById.get(eosId);
      if (!restored) throw new Error(`Recovery verification failed: ${eosId} is missing from MySQL.`);
      if (Number(restored.Points || 0) < Number(oldRow.Points || 0)) {
        throw new Error(`Recovery verification failed: ${eosId} is below the archived SQLite balance.`);
      }
    }

    await assertEmptyServer();
    return {
      applied: true,
      backupTable,
      sqliteRows: sqlite.rows.length,
      mysqlRowsBefore: before.length,
      mysqlRowsAfter: after.length,
      inserted,
      raised,
      unchanged,
      mysqlHigherPreserved,
      pointsAdded,
      totalPointsBefore: before.reduce((sum, row) => sum + Number(row.Points || 0), 0),
      totalPointsAfter: after.reduce((sum, row) => sum + Number(row.Points || 0), 0)
    };
  } finally {
    if (connection) await connection.end().catch(() => {});
    fs.rmSync(snapshot.snapshotFile, { force: true });
  }
}

async function runIfRequested({ stampDirectory = process.env.NEXUS_DATA_DIR || '/app/data' } = {}) {
  const request = String(process.env[ENV_KEY] || '').trim();
  if (!request) return { skipped: 'not-requested' };
  if (request !== POLICY) throw new Error(`Refusing unknown points recovery policy '${request}'.`);
  const stampFile = path.join(stampDirectory, `arkshop-points-recovery-${POLICY}.done.json`);
  if (fs.existsSync(stampFile)) return { skipped: 'already-applied', stampFile };
  const result = await recover();
  fs.mkdirSync(stampDirectory, { recursive: true });
  fs.writeFileSync(stampFile, JSON.stringify({ appliedAt: new Date().toISOString(), ...result }, null, 2), { mode: 0o600 });
  return { ...result, stampFile };
}

module.exports = { ENV_KEY, POLICY, backupTableName, assertEmptyServer, recover, runIfRequested };
