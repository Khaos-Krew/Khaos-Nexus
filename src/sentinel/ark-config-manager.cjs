'use strict';

const path = require('node:path');
const SftpClient = require('ssh2-sftp-client');
const {
  sftpSettingsFromEnv,
  remotePath,
  patchIniSection,
  GAME_USER_SETTINGS_PATH,
  GAME_INI_PATH
} = require('./ark-sftp-config.cjs');
const { findRemoteFile } = require('./ark-sftp-discovery.cjs');

const ARKSHOP_CONFIG_PATH = 'ShooterGame/Binaries/Win64/ArkApi/Plugins/ArkShop/Configs/config.json';
const FILES = Object.freeze({
  gus: { env: 'GUS_PATH', fallback: GAME_USER_SETTINGS_PATH, type: 'ini', restartRequired: true, fileName: 'GameUserSettings.ini' },
  game: { env: 'GAMEINI_PATH', fallback: GAME_INI_PATH, type: 'ini', restartRequired: true, fileName: 'Game.ini' },
  arkshop: { env: 'ARKSHOP_CONFIG_PATH', fallback: ARKSHOP_CONFIG_PATH, type: 'json', restartRequired: false, fileName: 'config.json' }
});

function timestampFolder(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-');
}

function resolveFile(prefix, fileKey) {
  const key = String(fileKey || '').trim().toLowerCase();
  const spec = FILES[key];
  if (!spec) throw new Error(`Unsupported ARK config file: ${fileKey}.`);
  const settings = sftpSettingsFromEnv(prefix);
  const relative = String(process.env[`${prefix}_${spec.env}`] || spec.fallback).trim();
  return { key, spec, settings, relative, remoteFile: remotePath(settings.root, relative) };
}

async function resolveExistingFile(client, prefix, fileKey) {
  const resolved = resolveFile(prefix, fileKey);
  const found = await findRemoteFile(client, {
    configuredRoot: resolved.settings.root,
    configuredPath: resolved.relative,
    preferredSuffix: resolved.spec.fallback,
    fileName: resolved.spec.fileName,
    maxDepth: resolved.key === 'arkshop' ? 9 : 7
  });
  return { ...resolved, remoteFile: found.path, discovered: found.discovered === true };
}

async function connect(prefix = 'ARK_GEN1') {
  const settings = sftpSettingsFromEnv(prefix);
  if (!settings.host || !settings.username || !settings.password) {
    throw new Error('ARK SFTP variables are incomplete. Host, username, and password are required.');
  }
  const client = new SftpClient('khaos-nexus-ark-config');
  await client.connect({
    host: settings.host,
    port: settings.port,
    username: settings.username,
    password: settings.password,
    readyTimeout: settings.readyTimeout
  });
  return client;
}

async function readText(client, remoteFile) {
  const data = await client.get(remoteFile);
  return Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
}

async function backupAndWrite(client, remoteFile, nextText) {
  const current = await readText(client, remoteFile);
  if (current === nextText) return { changed: false, backup: null };
  const parent = path.posix.dirname(remoteFile);
  const backupDir = path.posix.join(parent, 'NexusBackups', timestampFolder());
  await client.mkdir(backupDir, true);
  const backup = path.posix.join(backupDir, path.posix.basename(remoteFile));
  await client.put(Buffer.from(current, 'utf8'), backup);
  await client.put(Buffer.from(nextText, 'utf8'), remoteFile);
  const verify = await readText(client, remoteFile);
  if (verify !== nextText) {
    await client.put(Buffer.from(current, 'utf8'), remoteFile).catch(() => {});
    throw new Error(`Verification failed writing ${remoteFile}; the previous contents were restored.`);
  }
  return { changed: true, backup };
}

function parseJsonValue(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  try { return JSON.parse(text); } catch { return text; }
}

function setJsonPath(root, dottedPath, value) {
  const parts = String(dottedPath || '').split('.').map((part) => part.trim()).filter(Boolean);
  if (!parts.length || parts.length > 12) throw new Error('ArkShop JSON path is invalid.');
  for (const part of parts) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(part)) throw new Error(`Unsafe ArkShop JSON path segment: ${part}`);
  }
  let cursor = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = value;
  return root;
}

async function discoverPaths(prefix = 'ARK_GEN1') {
  const client = await connect(prefix);
  try {
    const results = {};
    for (const key of ['gus', 'game', 'arkshop']) {
      try {
        const resolved = await resolveExistingFile(client, prefix, key);
        results[key] = { found: true, path: resolved.remoteFile, discovered: resolved.discovered };
      } catch (error) {
        results[key] = { found: false, error: String(error?.message || error) };
      }
    }
    return results;
  } finally {
    await client.end().catch(() => {});
  }
}

async function readConfig(prefix = 'ARK_GEN1', fileKey) {
  const client = await connect(prefix);
  try {
    const resolved = await resolveExistingFile(client, prefix, fileKey);
    return { ...resolved, text: await readText(client, resolved.remoteFile) };
  } finally {
    await client.end().catch(() => {});
  }
}

async function setIniValue({ prefix = 'ARK_GEN1', fileKey, section, key, value, dryRun = false } = {}) {
  const initial = resolveFile(prefix, fileKey);
  if (initial.spec.type !== 'ini') throw new Error(`${initial.key} is not an INI config.`);
  if (!String(section || '').trim() || !String(key || '').trim()) throw new Error('INI section and key are required.');
  if (/\r|\n|\[|\]/.test(String(key))) throw new Error('INI key contains invalid characters.');
  const client = await connect(prefix);
  try {
    const resolved = await resolveExistingFile(client, prefix, fileKey);
    const current = await readText(client, resolved.remoteFile);
    const next = patchIniSection(current, String(section).trim(), { [String(key).trim()]: String(value ?? '') });
    if (dryRun) return { changed: current !== next, restartRequired: true, remoteFile: resolved.remoteFile, backup: null, dryRun: true, discovered: resolved.discovered };
    const result = await backupAndWrite(client, resolved.remoteFile, next);
    return { ...result, restartRequired: result.changed, remoteFile: resolved.remoteFile, dryRun: false, discovered: resolved.discovered };
  } finally {
    await client.end().catch(() => {});
  }
}

async function setArkShopValue({ prefix = 'ARK_GEN1', jsonPath, value, dryRun = false } = {}) {
  const client = await connect(prefix);
  try {
    const resolved = await resolveExistingFile(client, prefix, 'arkshop');
    const current = await readText(client, resolved.remoteFile);
    let parsed;
    try { parsed = JSON.parse(current); } catch (error) { throw new Error(`ArkShop config.json is not valid JSON: ${error.message}`); }
    const nextObject = setJsonPath(parsed, jsonPath, parseJsonValue(value));
    const next = `${JSON.stringify(nextObject, null, 2)}\n`;
    if (dryRun) return { changed: current !== next, restartRequired: false, remoteFile: resolved.remoteFile, backup: null, dryRun: true, discovered: resolved.discovered };
    const result = await backupAndWrite(client, resolved.remoteFile, next);
    return { ...result, restartRequired: false, remoteFile: resolved.remoteFile, dryRun: false, discovered: resolved.discovered };
  } finally {
    await client.end().catch(() => {});
  }
}

async function syncArkShopMysqlFromEnv({ prefix = 'ARK_GEN1', dryRun = false } = {}) {
  const db = {
    host: String(process.env.ARKSHOP_DB_HOST || '').trim(),
    user: String(process.env.ARKSHOP_DB_USER || '').trim(),
    password: String(process.env.ARKSHOP_DB_PASSWORD || ''),
    database: String(process.env.ARKSHOP_DB_NAME || '').trim(),
    port: Number(process.env.ARKSHOP_DB_PORT || 3306),
    table: String(process.env.ARKSHOP_DB_TABLE || 'ArkShopPlayers').trim()
  };
  const missing = [];
  if (!db.host) missing.push('ARKSHOP_DB_HOST');
  if (!db.user) missing.push('ARKSHOP_DB_USER');
  if (!db.password) missing.push('ARKSHOP_DB_PASSWORD');
  if (!db.database) missing.push('ARKSHOP_DB_NAME');
  if (missing.length) throw new Error(`Cannot sync ArkShop MySQL yet. Missing protected Railway variables: ${missing.join(', ')}`);
  if (!Number.isInteger(db.port) || db.port < 1 || db.port > 65535) throw new Error('ARKSHOP_DB_PORT is invalid.');
  if (!/^[A-Za-z0-9_]{1,64}$/.test(db.table)) throw new Error('ARKSHOP_DB_TABLE contains unsafe characters.');

  const client = await connect(prefix);
  try {
    const resolved = await resolveExistingFile(client, prefix, 'arkshop');
    const current = await readText(client, resolved.remoteFile);
    let parsed;
    try { parsed = JSON.parse(current); } catch (error) { throw new Error(`ArkShop config.json is not valid JSON: ${error.message}`); }
    parsed.Mysql = {
      ...(parsed.Mysql && typeof parsed.Mysql === 'object' && !Array.isArray(parsed.Mysql) ? parsed.Mysql : {}),
      UseMysql: true,
      MysqlHost: db.host,
      MysqlUser: db.user,
      MysqlPass: db.password,
      MysqlDB: db.database,
      MysqlPort: db.port,
      MysqlPlayersTable: db.table
    };
    const next = `${JSON.stringify(parsed, null, 2)}\n`;
    if (dryRun) return { changed: current !== next, restartRequired: false, remoteFile: resolved.remoteFile, backup: null, dryRun: true, discovered: resolved.discovered };
    const result = await backupAndWrite(client, resolved.remoteFile, next);
    return { ...result, restartRequired: false, remoteFile: resolved.remoteFile, dryRun: false, discovered: resolved.discovered };
  } finally {
    await client.end().catch(() => {});
  }
}

async function restoreBackup({ prefix = 'ARK_GEN1', fileKey, backup } = {}) {
  const client = await connect(prefix);
  try {
    const resolved = await resolveExistingFile(client, prefix, fileKey);
    const backupPath = String(backup || '').replace(/\\/g, '/');
    const expectedParent = path.posix.dirname(resolved.remoteFile);
    const backupRoot = path.posix.join(expectedParent, 'NexusBackups') + '/';
    if (!backupPath.startsWith(backupRoot) || path.posix.basename(backupPath) !== path.posix.basename(resolved.remoteFile)) {
      throw new Error('Backup path is outside the approved NexusBackups location.');
    }
    const backupExists = await client.exists(backupPath);
    if (!backupExists) throw new Error('Requested backup does not exist.');
    const backupText = await readText(client, backupPath);
    const result = await backupAndWrite(client, resolved.remoteFile, backupText);
    return { ...result, restoredFrom: backupPath, restartRequired: resolved.spec.restartRequired && result.changed };
  } finally {
    await client.end().catch(() => {});
  }
}

module.exports = {
  ARKSHOP_CONFIG_PATH,
  FILES,
  resolveFile,
  resolveExistingFile,
  discoverPaths,
  parseJsonValue,
  setJsonPath,
  readConfig,
  setIniValue,
  setArkShopValue,
  syncArkShopMysqlFromEnv,
  restoreBackup
};
