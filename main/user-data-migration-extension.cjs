'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');

let installed = false;
let migrationResult = {
  status: 'pending',
  migrated: false,
  source: null,
  destination: null,
  score: 0,
  files: 0,
  error: null
};

const APP_DIRECTORY_NAMES = [
  'Khaos Nexus',
  'khaos-nexus',
  'Khaos-Nexus',
  'KhaosNexus',
  'khaosnexus'
];

const SKIP_DIRECTORY_NAMES = new Set([
  'Cache',
  'Code Cache',
  'DawnCache',
  'GPUCache',
  'ShaderCache',
  'Crashpad',
  'blob_storage',
  'Session Storage',
  'Local Storage',
  'Network',
  'Service Worker'
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

function configurationValueScore(directory) {
  if (!directory || !fs.existsSync(directory)) return 0;
  const config = readJson(path.join(directory, 'config.json'));
  if (!config || typeof config !== 'object') return 0;
  const discord = config.discord || {};
  const monitor = config.monitor || {};
  const general = config.general || {};
  const servers = Array.isArray(config.servers) ? config.servers : [];
  let score = servers.length * 25;
  if (discord.guildId) score += 12;
  if (discord.ownerUserId) score += 12;
  if (discord.oauthClientId) score += 12;
  if (Array.isArray(discord.operatorUserIds) && discord.operatorUserIds.length) score += 8;
  if (monitor.autoReportEnabled) score += 6;
  if (monitor.reportRepository && monitor.reportRepository !== 'Khaos-Krew/Khaos-Nexus-Bot-Manager') score += 4;
  if (general.startWithWindows) score += 2;
  if (general.autoStartBot === false || general.autoRestart === false || general.minimizeToTray === false || general.checkUpdates === false) score += 2;
  if (Object.keys(config).some((key) => !['schemaVersion', 'general', 'discord', 'monitor', 'servers'].includes(key))) score += 10;
  return score;
}

function configScore(directory) {
  if (!directory || !fs.existsSync(directory)) return 0;
  let score = configurationValueScore(directory);

  try {
    const secretStats = fs.statSync(path.join(directory, 'secrets.bin'));
    if (secretStats.size > 16) score += 40;
  } catch {}

  const autonomy = readJson(path.join(directory, 'autonomy-settings.json'));
  if (autonomy && typeof autonomy === 'object') {
    if (autonomy.accessControlEnabled) score += 8;
    if (autonomy.discordNotificationsEnabled) score += 5;
    if (autonomy.notificationChannelId) score += 5;
  }

  for (const fileName of [
    'hosted-server-connections.json',
    'hosted-server-history.json',
    'server-scheduler-history.json',
    'server-scheduler-state.json',
    'status-panels.json',
    'player-console-history.json',
    'discord-observability.json',
    'discord-automation.json'
  ]) {
    try {
      if (fs.statSync(path.join(directory, fileName)).size > 2) score += 4;
    } catch {}
  }

  return score;
}

function candidateDirectories(destination) {
  const values = new Set();
  const add = (value) => {
    if (!value) return;
    const resolved = path.resolve(value);
    if (resolved !== path.resolve(destination)) values.add(resolved);
  };

  const appData = process.env.APPDATA || (() => {
    try { return electron.app.getPath('appData'); } catch { return ''; }
  })();
  const localAppData = process.env.LOCALAPPDATA || '';
  for (const root of [appData, localAppData]) {
    if (!root) continue;
    for (const name of APP_DIRECTORY_NAMES) add(path.join(root, name));
  }

  const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath || '');
  for (const relative of ['data', 'user-data', 'Khaos Nexus Data', '.khaos-nexus']) add(path.join(portableRoot, relative));

  const destinationParent = path.dirname(destination);
  for (const name of APP_DIRECTORY_NAMES) add(path.join(destinationParent, name));

  return [...values];
}

function shouldSkip(sourcePath) {
  const name = path.basename(sourcePath);
  if (SKIP_DIRECTORY_NAMES.has(name)) return true;
  if (/^(Singleton|LOCK$|lockfile$)/i.test(name)) return true;
  return false;
}

function copyTree(source, destination) {
  let files = 0;
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (shouldSkip(from)) continue;
    if (entry.isDirectory()) {
      files += copyTree(from, to);
      continue;
    }
    if (!entry.isFile()) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    files += 1;
  }
  return files;
}

function backupDestination(destination) {
  if (!fs.existsSync(destination)) return null;
  const entries = fs.readdirSync(destination).filter((name) => !shouldSkip(path.join(destination, name)));
  if (!entries.length) return null;
  const backup = `${destination}.pre-migration-${Date.now()}`;
  fs.mkdirSync(backup, { recursive: true });
  for (const name of entries) {
    const from = path.join(destination, name);
    const to = path.join(backup, name);
    const stat = fs.statSync(from);
    if (stat.isDirectory()) copyTree(from, to);
    else if (stat.isFile()) fs.copyFileSync(from, to);
  }
  return backup;
}

function migrateUserData() {
  const destination = electron.app.getPath('userData');
  const destinationScore = configScore(destination);
  const destinationConfigValue = configurationValueScore(destination);
  const candidates = candidateDirectories(destination)
    .map((directory) => ({
      directory,
      score: configScore(directory),
      configValue: configurationValueScore(directory)
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => (b.configValue - a.configValue) || (b.score - a.score));
  const best = candidates[0] || null;

  migrationResult = {
    status: 'complete',
    migrated: false,
    source: null,
    destination,
    score: destinationScore,
    configValue: destinationConfigValue,
    files: 0,
    error: null
  };

  const shouldMigrate = Boolean(best && (
    (destinationConfigValue === 0 && best.configValue > 0) ||
    (best.score > destinationScore && destinationScore < 20)
  ));
  if (!shouldMigrate) return clone(migrationResult);

  try {
    const backup = backupDestination(destination);
    const files = copyTree(best.directory, destination);
    migrationResult = {
      status: 'complete',
      migrated: true,
      source: best.directory,
      destination,
      score: best.score,
      configValue: best.configValue,
      previousScore: destinationScore,
      previousConfigValue: destinationConfigValue,
      files,
      backup,
      error: null
    };
    fs.writeFileSync(path.join(destination, 'user-data-migration.json'), JSON.stringify({
      ...migrationResult,
      completedAt: new Date().toISOString()
    }, null, 2), 'utf8');
  } catch (error) {
    migrationResult = {
      status: 'failed',
      migrated: false,
      source: best.directory,
      destination,
      score: best.score,
      configValue: best.configValue,
      files: 0,
      error: error.message
    };
  }
  return clone(migrationResult);
}

function getMigrationResult() {
  return clone(migrationResult);
}

function install() {
  if (installed) return;
  installed = true;
  electron.app.whenReady().then(() => {
    const result = migrateUserData();
    if (result.migrated) console.info('[Khaos Nexus] Restored prior local configuration.', result);
    if (result.error) console.error('[Khaos Nexus] Prior configuration migration failed.', result);
  }).catch((error) => {
    migrationResult = { ...migrationResult, status: 'failed', error: error.message };
    console.error('[Khaos Nexus] User-data migration initialization failed.', error);
  });
}

module.exports = {
  APP_DIRECTORY_NAMES,
  configurationValueScore,
  configScore,
  candidateDirectories,
  migrateUserData,
  getMigrationResult,
  install
};
