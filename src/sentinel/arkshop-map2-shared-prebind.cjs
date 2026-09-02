'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const SftpClient = require('ssh2-sftp-client');
const { readConfig } = require('./ark-config-manager.cjs');
const { sftpSettingsFromEnv, remotePath } = require('./ark-sftp-config.cjs');

const SOURCE_PREFIX = 'ARK_GEN1';
const TARGET_PREFIX = 'ARK_MAP2';
const DEFAULT_TARGET_PATH = 'ArkApi/Plugins/ArkShop/config.json';
const MANAGED_SECTIONS = Object.freeze(['Kits', 'ShopItems', 'SellItems']);
const LOVE_SHOP_ID = 'apoth_love';

function cleanError(error) {
  return String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function sharedDatabaseFromEnv() {
  const database = {
    host: String(process.env.ARKSHOP_DB_HOST || '').trim(),
    port: Number(process.env.ARKSHOP_DB_PORT || 3306),
    user: String(process.env.ARKSHOP_DB_USER || '').trim(),
    password: String(process.env.ARKSHOP_DB_PASSWORD || ''),
    name: String(process.env.ARKSHOP_DB_NAME || '').trim(),
    playersTable: String(process.env.ARKSHOP_DB_PLAYERS_TABLE || process.env.ARKSHOP_DB_TABLE || 'ArkShopPlayers').trim(),
    logTable: String(process.env.ARKSHOP_DB_LOG_TABLE || 'ArkShopLogTransactions').trim()
  };

  const missing = [];
  if (!database.host) missing.push('ARKSHOP_DB_HOST');
  if (!database.user) missing.push('ARKSHOP_DB_USER');
  if (!database.password) missing.push('ARKSHOP_DB_PASSWORD');
  if (!database.name) missing.push('ARKSHOP_DB_NAME');
  if (missing.length) throw new Error(`Shared ArkShop MySQL authority is incomplete: ${missing.join(', ')}`);
  if (!Number.isInteger(database.port) || database.port < 1 || database.port > 65535) throw new Error('ARKSHOP_DB_PORT is invalid.');
  if (!/^[A-Za-z0-9_]{1,64}$/.test(database.playersTable)) throw new Error('ARKSHOP_DB_PLAYERS_TABLE contains unsafe characters.');
  if (!/^[A-Za-z0-9_]{1,64}$/.test(database.logTable)) throw new Error('ARKSHOP_DB_LOG_TABLE contains unsafe characters.');
  return database;
}

function targetRelativePath() {
  const configured = String(process.env.ARK_MAP2_ARKSHOP_CONFIG_PATH || DEFAULT_TARGET_PATH)
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (!configured || configured.includes('..')) throw new Error('ARK_MAP2_ARKSHOP_CONFIG_PATH is invalid.');

  const allowed = [
    /^ArkApi\/Plugins\/ArkShop\/config\.json$/i,
    /^ShooterGame\/Binaries\/Win64\/ArkApi\/Plugins\/ArkShop\/(?:Configs\/)?config\.json$/i
  ];
  if (!allowed.some((pattern) => pattern.test(configured))) {
    throw new Error('ARK_MAP2_ARKSHOP_CONFIG_PATH is outside the approved ArkShop config locations.');
  }
  return configured;
}

function buildTargetConfig(source, target, database) {
  const next = clone(target);
  for (const section of MANAGED_SECTIONS) next[section] = clone(source?.[section] || {});
  next.ShopItems ||= {};
  delete next.ShopItems[LOVE_SHOP_ID];

  const existingMysql = next.Mysql && typeof next.Mysql === 'object' && !Array.isArray(next.Mysql)
    ? next.Mysql
    : {};
  next.Mysql = {
    ...existingMysql,
    UseMysql: true,
    MysqlHost: database.host,
    MysqlPort: database.port,
    MysqlUser: database.user,
    MysqlPass: database.password,
    MysqlDB: database.name,
    MysqlPlayersTable: database.playersTable,
    MysqlLogTable: database.logTable
  };
  return next;
}

function databaseFingerprint(database) {
  const canonical = JSON.stringify({
    host: database.host.toLowerCase(),
    port: database.port,
    database: database.name,
    user: database.user,
    playersTable: database.playersTable,
    logTable: database.logTable
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

async function readRemoteText(client, remoteFile) {
  const data = await client.get(remoteFile);
  return Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
}

async function writeWithBackup(client, remoteFile, current, next) {
  if (current === next) return { changed: false, backup: null };
  const parent = path.posix.dirname(remoteFile);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.posix.join(parent, 'NexusBackups', stamp);
  const backup = path.posix.join(backupDir, path.posix.basename(remoteFile));
  await client.mkdir(backupDir, true);
  await client.put(Buffer.from(current, 'utf8'), backup);
  await client.put(Buffer.from(next, 'utf8'), remoteFile);
  const verify = await readRemoteText(client, remoteFile);
  if (verify !== next) {
    await client.put(Buffer.from(current, 'utf8'), remoteFile).catch(() => {});
    throw new Error(`Verification failed writing ${remoteFile}; previous ArkShop config was restored.`);
  }
  return { changed: true, backup };
}

function assertVerified(config, expected, database) {
  for (const section of MANAGED_SECTIONS) {
    if (JSON.stringify(config?.[section] || {}) !== JSON.stringify(expected?.[section] || {})) {
      throw new Error(`Astraeos ArkShop verification failed for ${section}.`);
    }
  }
  const mysql = config?.Mysql || {};
  const checks = [
    [mysql.UseMysql === true || String(mysql.UseMysql).toLowerCase() === 'true', 'UseMysql'],
    [String(mysql.MysqlHost || '') === database.host, 'MysqlHost'],
    [Number(mysql.MysqlPort || 3306) === database.port, 'MysqlPort'],
    [String(mysql.MysqlUser || '') === database.user, 'MysqlUser'],
    [String(mysql.MysqlPass || '') === database.password, 'MysqlPass'],
    [String(mysql.MysqlDB || '') === database.name, 'MysqlDB'],
    [String(mysql.MysqlPlayersTable || '') === database.playersTable, 'MysqlPlayersTable'],
    [String(mysql.MysqlLogTable || '') === database.logTable, 'MysqlLogTable']
  ];
  const failed = checks.find(([ok]) => !ok);
  if (failed) throw new Error(`Astraeos ArkShop shared-MySQL verification failed for ${failed[1]}.`);
}

async function run() {
  const database = sharedDatabaseFromEnv();
  const sourceRead = await readConfig(SOURCE_PREFIX, 'arkshop');
  const source = JSON.parse(sourceRead.text);

  const settings = sftpSettingsFromEnv(TARGET_PREFIX);
  if (!settings.host || !settings.username || !settings.password) {
    throw new Error('Astraeos SFTP credentials are incomplete.');
  }
  const relative = targetRelativePath();
  const remoteFile = remotePath(settings.root, relative);
  const client = new SftpClient('khaos-nexus-arkshop-map2-prebind');

  await client.connect({
    host: settings.host,
    port: settings.port,
    username: settings.username,
    password: settings.password,
    readyTimeout: settings.readyTimeout
  });

  try {
    const current = await readRemoteText(client, remoteFile);
    let target;
    try { target = JSON.parse(current); } catch (error) {
      throw new Error(`Astraeos ArkShop config.json is invalid JSON: ${error.message}`);
    }

    const expected = buildTargetConfig(source, target, database);
    const next = `${JSON.stringify(expected, null, 2)}\n`;
    const write = await writeWithBackup(client, remoteFile, current, next);
    const verified = JSON.parse(await readRemoteText(client, remoteFile));
    assertVerified(verified, expected, database);

    return {
      changed: write.changed,
      backup: write.backup,
      remoteFile,
      kitCount: Object.keys(verified.Kits || {}).length,
      shopItemCount: Object.keys(verified.ShopItems || {}).length,
      sellItemCount: Object.keys(verified.SellItems || {}).length,
      databaseFingerprint: databaseFingerprint(database),
      playersTable: database.playersTable,
      localSqliteImported: false,
      gameplayIniTouched: false,
      verified: true
    };
  } finally {
    await client.end().catch(() => {});
  }
}

module.exports = {
  SOURCE_PREFIX,
  TARGET_PREFIX,
  DEFAULT_TARGET_PATH,
  MANAGED_SECTIONS,
  LOVE_SHOP_ID,
  cleanError,
  sharedDatabaseFromEnv,
  targetRelativePath,
  buildTargetConfig,
  databaseFingerprint,
  run
};
