'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const SftpClient = require('ssh2-sftp-client');
const { sftpSettingsFromEnv, remotePath } = require('./ark-sftp-config.cjs');

const DEFAULT_SQLITE_PATH = 'ShooterGame/Binaries/Win64/ArkApi/Plugins/ArkShop/ArkShop.db';
const MAX_SNAPSHOT_BYTES = 128 * 1024 * 1024;

function safeTableName(value) {
  const table = String(value || 'Players').trim();
  if (!/^[A-Za-z0-9_]{1,64}$/.test(table)) throw new Error('ARKSHOP_SQLITE_TABLE contains unsafe characters.');
  return table;
}

function sqliteConfigFromEnv(prefix = 'ARK_GEN1') {
  const settings = sftpSettingsFromEnv(prefix);
  const relative = String(process.env[`${prefix}_ARKSHOP_SQLITE_PATH`] || DEFAULT_SQLITE_PATH).trim();
  const snapshotDirectory = String(
    process.env.NEXUS_ARKSHOP_SQLITE_SNAPSHOT_DIR ||
    (process.env.RAILWAY_VOLUME_MOUNT_PATH ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'arkshop-sqlite') : path.join(os.tmpdir(), 'khaos-nexus-arkshop-sqlite'))
  ).trim();
  return {
    prefix,
    settings,
    relative,
    remoteFile: remotePath(settings.root, relative),
    snapshotDirectory,
    table: safeTableName(process.env.ARKSHOP_SQLITE_TABLE)
  };
}

function validateSftpSettings(settings) {
  const missing = [];
  if (!settings.host) missing.push('SFTP_HOST');
  if (!settings.username) missing.push('SFTP_USERNAME');
  if (!settings.password) missing.push('SFTP_PASSWORD');
  if (missing.length) throw new Error(`ARK SFTP variables are incomplete. Missing: ${missing.join(', ')}`);
}

function normalizeSqliteValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return `<blob:${value.length}>`;
  return value;
}

function normalizeRow(row) {
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, normalizeSqliteValue(value)]));
}

function openReadOnlyDatabase(snapshotFile) {
  return new DatabaseSync(snapshotFile, {
    readOnly: true,
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false
  });
}

function quickCheck(database) {
  const row = database.prepare('PRAGMA quick_check').get();
  const result = String(Object.values(row || {})[0] || '');
  if (result.toLowerCase() !== 'ok') throw new Error(`SQLite snapshot integrity check failed: ${result || 'unknown result'}`);
}

function tableExists(database, table) {
  return Boolean(database.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get(table));
}

function sqliteStatusFromFile(snapshotFile, config = {}) {
  const table = safeTableName(config.table);
  const database = openReadOnlyDatabase(snapshotFile);
  try {
    quickCheck(database);
    return {
      backend: 'sqlite',
      connected: true,
      database: config.remoteFile || snapshotFile,
      table,
      tableExists: tableExists(database, table)
    };
  } finally {
    database.close();
  }
}

function sqliteSchemaFromFile(snapshotFile, config = {}) {
  const table = safeTableName(config.table);
  const database = openReadOnlyDatabase(snapshotFile);
  try {
    quickCheck(database);
    const rows = database.prepare(`PRAGMA table_info(\"${table}\")`).all();
    return {
      backend: 'sqlite',
      database: config.remoteFile || snapshotFile,
      table,
      columns: rows.map((row) => ({
        COLUMN_NAME: String(row.name),
        DATA_TYPE: String(row.type || '').toLowerCase(),
        IS_NULLABLE: Number(row.notnull) === 1 ? 'NO' : 'YES',
        COLUMN_KEY: Number(row.pk) > 0 ? 'PRI' : ''
      }))
    };
  } finally {
    database.close();
  }
}

function lookupPlayerFromFile(snapshotFile, playerId, config = {}) {
  const id = String(playerId || '').trim();
  if (!/^[A-Za-z0-9_-]{5,128}$/.test(id)) throw new Error('ArkShop player/EOS ID contains unsupported characters.');
  const table = safeTableName(config.table);
  const database = openReadOnlyDatabase(snapshotFile);
  try {
    quickCheck(database);
    const columns = database.prepare(`PRAGMA table_info(\"${table}\")`).all();
    const names = new Set(columns.map((row) => String(row.name)));
    const idColumn = ['EosId', 'EOSId', 'eos_id', 'SteamId', 'SteamID', 'steam_id', 'PlayerId', 'PlayerID'].find((name) => names.has(name));
    if (!idColumn) throw new Error('Could not identify the ArkShop player ID column from the live table schema.');
    const safeColumns = ['EosId', 'EOSId', 'eos_id', 'SteamId', 'SteamID', 'steam_id', 'PlayerId', 'PlayerID', 'Points', 'Kits', 'TotalSpent', 'Name'].filter((name) => names.has(name));
    const select = (safeColumns.length ? safeColumns : [idColumn]).map((name) => `\"${name}\"`).join(', ');
    const statement = database.prepare(`SELECT ${select} FROM \"${table}\" WHERE \"${idColumn}\" = ? LIMIT 1`);
    statement.setReadBigInts(true);
    const row = statement.get(id);
    return { backend: 'sqlite', table, idColumn, player: row ? normalizeRow(row) : null };
  } finally {
    database.close();
  }
}

function sameRemoteStat(before, after) {
  return Number(before?.size) === Number(after?.size) && Number(before?.modifyTime) === Number(after?.modifyTime);
}

async function pause(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function downloadVerifiedSnapshot(config, { attempts = 4, retryDelayMs = 200, Client = SftpClient } = {}) {
  validateSftpSettings(config.settings);
  fs.mkdirSync(config.snapshotDirectory, { recursive: true, mode: 0o700 });
  const client = new Client('khaos-nexus-arkshop-sqlite');
  await client.connect({
    host: config.settings.host,
    port: config.settings.port,
    username: config.settings.username,
    password: config.settings.password,
    readyTimeout: config.settings.readyTimeout
  });

  let lastError;
  try {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let snapshotFile;
      try {
        const before = await client.stat(config.remoteFile);
        const size = Number(before?.size || 0);
        if (!size) throw new Error('ArkShop SQLite database is empty or missing.');
        if (size > MAX_SNAPSHOT_BYTES) throw new Error(`ArkShop SQLite database exceeds the ${MAX_SNAPSHOT_BYTES} byte snapshot safety limit.`);

        const busyBefore = Boolean(await client.exists(`${config.remoteFile}-journal`)) || Boolean(await client.exists(`${config.remoteFile}-wal`));
        if (busyBefore) throw new Error('ArkShop SQLite database has an active journal; waiting for a stable read window.');

        const bytes = await client.get(config.remoteFile);
        const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || '');
        const after = await client.stat(config.remoteFile);
        const busyAfter = Boolean(await client.exists(`${config.remoteFile}-journal`)) || Boolean(await client.exists(`${config.remoteFile}-wal`));
        if (busyAfter || !sameRemoteStat(before, after) || buffer.length !== size) {
          throw new Error('ArkShop SQLite database changed while the read-only snapshot was downloading.');
        }
        if (buffer.subarray(0, 16).toString('ascii') !== 'SQLite format 3\0') throw new Error('ArkShop database snapshot is not a SQLite 3 file.');

        const token = crypto.randomBytes(10).toString('hex');
        snapshotFile = path.join(config.snapshotDirectory, `arkshop-${process.pid}-${token}.db`);
        fs.writeFileSync(snapshotFile, buffer, { mode: 0o600, flag: 'wx' });
        sqliteStatusFromFile(snapshotFile, config);
        return { snapshotFile, bytes: buffer.length, modifiedAt: Number(after.modifyTime || 0), remoteFile: config.remoteFile };
      } catch (error) {
        lastError = error;
        if (snapshotFile) fs.rmSync(snapshotFile, { force: true });
        if (attempt < attempts) await pause(retryDelayMs);
      }
    }
  } finally {
    await client.end().catch(() => {});
  }
  throw new Error(`Could not obtain a consistent read-only ArkShop SQLite snapshot: ${String(lastError?.message || lastError || 'unknown error')}`);
}

async function withSnapshot(operation, prefix = 'ARK_GEN1', options = {}) {
  const config = sqliteConfigFromEnv(prefix);
  const snapshot = await downloadVerifiedSnapshot(config, options);
  try {
    return { ...(await operation(snapshot.snapshotFile, config)), snapshotBytes: snapshot.bytes, snapshotModifiedAt: snapshot.modifiedAt };
  } finally {
    fs.rmSync(snapshot.snapshotFile, { force: true });
  }
}

async function sqliteStatus(prefix = 'ARK_GEN1') {
  return withSnapshot((file, config) => sqliteStatusFromFile(file, config), prefix);
}

async function sqliteSchema(prefix = 'ARK_GEN1') {
  return withSnapshot((file, config) => sqliteSchemaFromFile(file, config), prefix);
}

async function lookupPlayer(playerId, prefix = 'ARK_GEN1') {
  return withSnapshot((file, config) => lookupPlayerFromFile(file, playerId, config), prefix);
}

module.exports = {
  DEFAULT_SQLITE_PATH,
  MAX_SNAPSHOT_BYTES,
  safeTableName,
  sqliteConfigFromEnv,
  normalizeSqliteValue,
  sqliteStatusFromFile,
  sqliteSchemaFromFile,
  lookupPlayerFromFile,
  downloadVerifiedSnapshot,
  sqliteStatus,
  sqliteSchema,
  lookupPlayer
};
