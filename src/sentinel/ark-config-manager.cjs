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

const ARKSHOP_CONFIG_PATH = 'ShooterGame/Binaries/Win64/ArkApi/Plugins/ArkShop/Configs/config.json';
const FILES = Object.freeze({
  gus: { env: 'GUS_PATH', fallback: GAME_USER_SETTINGS_PATH, type: 'ini', restartRequired: true },
  game: { env: 'GAMEINI_PATH', fallback: GAME_INI_PATH, type: 'ini', restartRequired: true },
  arkshop: { env: 'ARKSHOP_CONFIG_PATH', fallback: ARKSHOP_CONFIG_PATH, type: 'json', restartRequired: false }
});

function timestampFolder(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-');
}

function resolveFile(prefix, fileKey) {
  const key = String(fileKey || '').trim().toLowerCase();
  const spec = FILES[key];
  if (!spec) throw new Error(`Unsupported ARK config file: ${fileKey}.`);
  const settings = sftpSettingsFromEnv(prefix);
  const relative = process.env[`${prefix}_${spec.env}`] || spec.fallback;
  return { key, spec, settings, remoteFile: remotePath(settings.root, relative) };
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

async function readConfig(prefix = 'ARK_GEN1', fileKey) {
  const resolved = resolveFile(prefix, fileKey);
  const client = await connect(prefix);
  try {
    const exists = await client.exists(resolved.remoteFile);
    if (!exists) throw new Error(`${resolved.key} config was not found at ${resolved.remoteFile}.`);
    return { ...resolved, text: await readText(client, resolved.remoteFile) };
  } finally {
    await client.end().catch(() => {});
  }
}

async function setIniValue({ prefix = 'ARK_GEN1', fileKey, section, key, value, dryRun = false } = {}) {
  const resolved = resolveFile(prefix, fileKey);
  if (resolved.spec.type !== 'ini') throw new Error(`${resolved.key} is not an INI config.`);
  if (!String(section || '').trim() || !String(key || '').trim()) throw new Error('INI section and key are required.');
  if (/\r|\n|\[|\]/.test(String(key))) throw new Error('INI key contains invalid characters.');
  const client = await connect(prefix);
  try {
    const current = await readText(client, resolved.remoteFile);
    const next = patchIniSection(current, String(section).trim(), { [String(key).trim()]: String(value ?? '') });
    if (dryRun) return { changed: current !== next, restartRequired: true, remoteFile: resolved.remoteFile, backup: null, dryRun: true };
    const result = await backupAndWrite(client, resolved.remoteFile, next);
    return { ...result, restartRequired: result.changed, remoteFile: resolved.remoteFile, dryRun: false };
  } finally {
    await client.end().catch(() => {});
  }
}

async function setArkShopValue({ prefix = 'ARK_GEN1', jsonPath, value, dryRun = false } = {}) {
  const resolved = resolveFile(prefix, 'arkshop');
  const client = await connect(prefix);
  try {
    const current = await readText(client, resolved.remoteFile);
    let parsed;
    try { parsed = JSON.parse(current); } catch (error) { throw new Error(`ArkShop config.json is not valid JSON: ${error.message}`); }
    const nextObject = setJsonPath(parsed, jsonPath, parseJsonValue(value));
    const next = `${JSON.stringify(nextObject, null, 2)}\n`;
    if (dryRun) return { changed: current !== next, restartRequired: false, remoteFile: resolved.remoteFile, backup: null, dryRun: true };
    const result = await backupAndWrite(client, resolved.remoteFile, next);
    return { ...result, restartRequired: false, remoteFile: resolved.remoteFile, dryRun: false };
  } finally {
    await client.end().catch(() => {});
  }
}

async function restoreBackup({ prefix = 'ARK_GEN1', fileKey, backup } = {}) {
  const resolved = resolveFile(prefix, fileKey);
  const backupPath = String(backup || '').replace(/\\/g, '/');
  const expectedParent = path.posix.dirname(resolved.remoteFile);
  const backupRoot = path.posix.join(expectedParent, 'NexusBackups') + '/';
  if (!backupPath.startsWith(backupRoot) || path.posix.basename(backupPath) !== path.posix.basename(resolved.remoteFile)) {
    throw new Error('Backup path is outside the approved NexusBackups location.');
  }
  const client = await connect(prefix);
  try {
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
  parseJsonValue,
  setJsonPath,
  readConfig,
  setIniValue,
  setArkShopValue,
  restoreBackup
};
