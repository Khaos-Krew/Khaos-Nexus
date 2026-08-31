'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const mysql = require('mysql2/promise');
const SftpClient = require('ssh2-sftp-client');
const { sftpSettingsFromEnv } = require('./ark-sftp-config.cjs');
const { inspectArkApiLog } = require('./ark-api-log-diagnostic.cjs');

const PREFIX = 'ARK_MAP2';
const EXPECTED_ROOT = '/72.46.128.202_8120';
const EXPECTED_MAP = 'Astraeos_WP';
const EXPECTED_DB = Object.freeze({ host: '167.235.134.46', port: 3306, database: 'khaosk_nexus', user: 'khaosk_48289' });
const PLAYERS_TABLE = 'ArkShopPlayers';
const LOG_TABLE = 'ArkShopLogTransactions';
const PLAYER_COLUMNS = ['Id', 'EosId', 'Kits', 'Points', 'TotalSpent'];

function cleanError(error) { return String(error?.code || error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 300); }
function quoteId(value) {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(String(value || ''))) throw new Error('Unsafe SQL identifier.');
  return `\`${value}\``;
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex').toUpperCase(); }
function timestamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function normalizeRoot(value) { return `/${String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')}`; }

function playerStats(rows) {
  const normalized = rows.map((row) => `${row.Id}\0${row.EosId}\0${row.Kits}\0${row.Points}\0${row.TotalSpent}`).sort();
  return {
    rowCount: rows.length,
    totalPoints: rows.reduce((sum, row) => sum + row.Points, 0),
    totalSpent: rows.reduce((sum, row) => sum + row.TotalSpent, 0),
    playersWithKitState: rows.filter((row) => row.Kits && !['{}', '[]'].includes(row.Kits)).length,
    digest: sha256(Buffer.from(normalized.join('\n'), 'utf8'))
  };
}

function readSqlite(file) {
  const db = new DatabaseSync(file, { readOnly: true, enableForeignKeyConstraints: false, allowExtension: false });
  try {
    const check = db.prepare('PRAGMA quick_check').get();
    if (String(Object.values(check || {})[0]).toLowerCase() !== 'ok') throw new Error('SQLite quick_check failed.');
    const table = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='Players'").get();
    if (!table) throw new Error('SQLite Players table is missing.');
    const columns = db.prepare('PRAGMA table_info("Players")').all().map((row) => String(row.name));
    const missing = PLAYER_COLUMNS.filter((column) => !columns.includes(column));
    if (missing.length) throw new Error(`SQLite Players table is missing columns: ${missing.join(', ')}`);
    const rows = db.prepare('SELECT Id, EosId, Kits, Points, TotalSpent FROM Players ORDER BY EosId').all().map((row) => ({
      Id: Number(row.Id),
      EosId: String(row.EosId),
      Kits: String(row.Kits ?? '{}'),
      Points: Number(row.Points || 0),
      TotalSpent: Number(row.TotalSpent || 0)
    }));
    return { columns, rows, stats: playerStats(rows) };
  } finally { db.close(); }
}

async function stableRemoteFile(client, remoteFile) {
  if (await client.exists(`${remoteFile}-journal`) || await client.exists(`${remoteFile}-wal`)) throw new Error('SQLite journal/WAL exists; Astraeos may still be writing.');
  const before = await client.stat(remoteFile);
  const bytes = Buffer.from(await client.get(remoteFile));
  const after = await client.stat(remoteFile);
  if (Number(before.size) !== Number(after.size) || Number(before.modifyTime) !== Number(after.modifyTime) || bytes.length !== Number(before.size)) throw new Error('SQLite changed while it was being read.');
  if (bytes.subarray(0, 16).toString('ascii') !== 'SQLite format 3\0') throw new Error('ArkShop.db is not SQLite 3.');
  return bytes;
}

function databaseSettings() {
  const settings = {
    host: String(process.env.ARKSHOP_DB_HOST || '').trim(),
    port: Number(process.env.ARKSHOP_DB_PORT || 3306),
    database: String(process.env.ARKSHOP_DB_NAME || '').trim(),
    user: String(process.env.ARKSHOP_DB_USER || '').trim(),
    password: String(process.env.ARKSHOP_DB_PASSWORD || '')
  };
  for (const key of ['host', 'database', 'user', 'password']) if (!settings[key]) throw new Error(`ARKSHOP_DB_${key === 'database' ? 'NAME' : key.toUpperCase()} is missing.`);
  if (settings.host !== EXPECTED_DB.host || settings.port !== EXPECTED_DB.port || settings.database !== EXPECTED_DB.database || settings.user !== EXPECTED_DB.user) throw new Error('Railway MySQL target does not match the approved Citadel database.');
  return settings;
}

async function authPlugin(connection) {
  const [rows] = await connection.query('SHOW CREATE USER CURRENT_USER()');
  const sql = String(Object.values(rows[0] || {}).find((value) => /CREATE\s+USER/i.test(String(value))) || '');
  return sql.match(/IDENTIFIED WITH [`']?([^`' ]+)/i)?.[1] || 'unknown';
}

async function ensureArkShopAuthentication(connection, settings) {
  let plugin = await authPlugin(connection);
  if (plugin === 'mysql_native_password') return { before: plugin, after: plugin, changed: false };
  if (plugin !== 'caching_sha2_password') throw new Error(`Unsupported MySQL authentication plugin: ${plugin}`);
  const query = `ALTER USER CURRENT_USER() IDENTIFIED WITH mysql_native_password BY ${connection.escape(settings.password)}`;
  await connection.query(query);
  plugin = await authPlugin(connection);
  if (plugin !== 'mysql_native_password') throw new Error('MySQL authentication plugin change did not verify.');
  return { before: 'caching_sha2_password', after: plugin, changed: true };
}

async function mysqlRows(connection) {
  const [columns] = await connection.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', [EXPECTED_DB.database, PLAYERS_TABLE]);
  if (!columns.length) return { exists: false, rows: [], stats: playerStats([]) };
  const names = columns.map((row) => String(row.COLUMN_NAME));
  const missing = PLAYER_COLUMNS.filter((column) => !names.includes(column));
  if (missing.length) throw new Error(`Existing ${PLAYERS_TABLE} has an incompatible schema: ${missing.join(', ')}`);
  const [rows] = await connection.query(`SELECT Id,EosId,Kits,Points,TotalSpent FROM ${quoteId(PLAYERS_TABLE)} ORDER BY EosId`);
  const normalized = rows.map((row) => ({ Id: Number(row.Id), EosId: String(row.EosId), Kits: String(row.Kits ?? '{}'), Points: Number(row.Points || 0), TotalSpent: Number(row.TotalSpent || 0) }));
  return { exists: true, rows: normalized, stats: playerStats(normalized) };
}

async function createSchema(connection) {
  await connection.query(`CREATE TABLE IF NOT EXISTS ${quoteId(PLAYERS_TABLE)} (Id INT NOT NULL AUTO_INCREMENT,EosId VARCHAR(50) NOT NULL,Kits LONGTEXT NOT NULL,Points INT DEFAULT 0,TotalSpent INT DEFAULT 0,PRIMARY KEY(Id),UNIQUE INDEX EosId_UNIQUE (EosId ASC))`);
  await connection.query(`CREATE TABLE IF NOT EXISTS ${quoteId(LOG_TABLE)} (Id INT NOT NULL AUTO_INCREMENT,EosId VARCHAR(50) NOT NULL,ItemName VARCHAR(255) NOT NULL,ItemAmount INT DEFAULT 1,TotalPrice INT DEFAULT 0,ServersId VARCHAR(100) NOT NULL DEFAULT '',BuyerDate DATETIME DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(Id),INDEX idx_eosid (EosId ASC))`);
}

async function assertAstraeosIdentity() {
  const root = normalizeRoot(process.env.ARK_MAP2_SFTP_ROOT);
  if (root !== EXPECTED_ROOT) throw new Error(`Refusing unexpected MAP2 root: ${root}`);
  const evidence = await inspectArkApiLog(PREFIX);
  const identifiers = evidence.newest?.mapIdentifiers || [];
  const names = evidence.newest?.serverNames || [];
  if (!identifiers.includes(EXPECTED_MAP) || !names.some((name) => /Astraeos/i.test(name))) throw new Error('MAP2 logs do not prove the Astraeos map and server name.');
  return { root, mapIdentifier: EXPECTED_MAP, serverName: names.find((name) => /Astraeos/i.test(name)) };
}

async function migrateAstraeosArkShop() {
  const identity = await assertAstraeosIdentity();
  const sftpSettings = sftpSettingsFromEnv(PREFIX);
  const dbSettings = databaseSettings();
  const sftp = new SftpClient('khaos-nexus-astraeos-migration');
  let connection;
  let configUploaded = false;
  let originalConfigBytes;
  const pluginRoot = path.posix.join(EXPECTED_ROOT, 'ShooterGame/Binaries/Win64/ArkApi/Plugins/ArkShop');
  const configFile = path.posix.join(pluginRoot, 'config.json');
  const sqliteFile = path.posix.join(pluginRoot, 'ArkShop.db');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-astraeos-'));
  try {
    await sftp.connect({ host: sftpSettings.host, port: sftpSettings.port, username: sftpSettings.username, password: sftpSettings.password, readyTimeout: sftpSettings.readyTimeout });
    if (!await sftp.exists(configFile)) throw new Error('Source-defined ArkShop config path does not exist on Astraeos.');
    originalConfigBytes = Buffer.from(await sftp.get(configFile));
    const config = JSON.parse(originalConfigBytes.toString('utf8'));
    if (!config.Mysql || typeof config.Mysql !== 'object') throw new Error('ArkShop config has no Mysql object.');
    if (config.Mysql.UseMysql !== false) throw new Error('Astraeos ArkShop is not in the expected SQLite mode.');
    const sqliteBytes = await stableRemoteFile(sftp, sqliteFile);
    const localSqlite = path.join(tempDir, 'ArkShop.db');
    fs.writeFileSync(localSqlite, sqliteBytes, { mode: 0o600 });
    const sqlite = readSqlite(localSqlite);

    connection = await mysql.createConnection({ ...dbSettings, connectTimeout: 15000, charset: 'utf8mb4', supportBigNumbers: true, ssl: { rejectUnauthorized: false } });
    const authentication = await ensureArkShopAuthentication(connection, dbSettings);
    const existing = await mysqlRows(connection);
    if (existing.stats.rowCount > 0 && existing.stats.digest !== sqlite.stats.digest) throw new Error(`Existing ${PLAYERS_TABLE} is nonempty and differs from Astraeos SQLite; refusing to merge or overwrite.`);

    const backupDir = path.posix.join(pluginRoot, 'NexusBackups', `${timestamp()}-pre-arkshop-mysql-astraeos`);
    await sftp.mkdir(backupDir, true);
    await sftp.put(originalConfigBytes, path.posix.join(backupDir, 'config.sqlite.json'));
    await sftp.put(sqliteBytes, path.posix.join(backupDir, 'ArkShop.db'));

    await createSchema(connection);
    const current = await mysqlRows(connection);
    if (current.stats.rowCount === 0 && sqlite.rows.length) {
      await connection.beginTransaction();
      try {
        const insert = `INSERT INTO ${quoteId(PLAYERS_TABLE)} (Id,EosId,Kits,Points,TotalSpent) VALUES (?,?,?,?,?)`;
        for (const row of sqlite.rows) await connection.execute(insert, [row.Id, row.EosId, row.Kits, row.Points, row.TotalSpent]);
        await connection.commit();
      } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
      }
    }
    const imported = await mysqlRows(connection);
    if (imported.stats.digest !== sqlite.stats.digest) throw new Error('MySQL digest does not match SQLite after import; config was not changed.');

    const updated = JSON.parse(JSON.stringify(config));
    updated.Mysql = { ...updated.Mysql, UseMysql: true, MysqlHost: dbSettings.host, MysqlUser: dbSettings.user, MysqlPass: dbSettings.password, MysqlDB: dbSettings.database, MysqlPort: dbSettings.port, MysqlPlayersTable: PLAYERS_TABLE, MysqlLogTable: LOG_TABLE };
    const updatedBytes = Buffer.from(`${JSON.stringify(updated, null, 2)}\n`, 'utf8');
    await sftp.put(updatedBytes, configFile);
    configUploaded = true;
    const verified = JSON.parse(Buffer.from(await sftp.get(configFile)).toString('utf8'));
    if (verified.Mysql?.UseMysql !== true || verified.Mysql?.MysqlDB !== EXPECTED_DB.database || verified.Mysql?.MysqlPlayersTable !== PLAYERS_TABLE || verified.Mysql?.MysqlLogTable !== LOG_TABLE) throw new Error('Uploaded MySQL config did not verify.');

    return { applied: true, identity, configFile, sqliteFile, backupDir, sqliteSha256: sha256(sqliteBytes), configSha256: sha256(updatedBytes), authentication, imported: imported.stats, tables: { players: PLAYERS_TABLE, transactions: LOG_TABLE } };
  } catch (error) {
    if (configUploaded && originalConfigBytes) await sftp.put(originalConfigBytes, configFile).catch(() => {});
    throw error;
  } finally {
    await sftp.end().catch(() => {});
    if (connection) await connection.end().catch(() => {});
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function runIfRequested({ stampDirectory = '/app/data' } = {}) {
  const request = String(process.env.ARK_MAP2_ARKSHOP_SQLITE_TO_MYSQL_ONCE || '').trim();
  if (!request) return { skipped: 'not-requested' };
  const safe = request.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 100);
  const stampFile = path.join(stampDirectory, `arkshop-map2-sqlite-to-mysql-${safe}.done.json`);
  if (fs.existsSync(stampFile)) return { skipped: 'already-applied', stampFile };
  const result = await migrateAstraeosArkShop();
  fs.mkdirSync(stampDirectory, { recursive: true });
  fs.writeFileSync(stampFile, JSON.stringify({ request, appliedAt: new Date().toISOString(), result }, null, 2));
  return { ...result, stampFile };
}

module.exports = { EXPECTED_ROOT, EXPECTED_MAP, EXPECTED_DB, PLAYERS_TABLE, LOG_TABLE, playerStats, readSqlite, migrateAstraeosArkShop, runIfRequested, cleanError };
