'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');

const MINIMUM_SPLASH_MS = 30 * 1000;
const STARTUP_HEALTH_TIMEOUT_MS = 75 * 1000;
const PROFILE_DATA_FILES = [
  'autonomy-settings.json',
  'hosted-server-connections.json',
  'hosted-server-history.json',
  'server-scheduler-history.json',
  'server-scheduler-state.json',
  'status-panels.json',
  'player-console-history.json',
  'discord-observability.json',
  'discord-automation.json',
  'renderer-action-errors.json',
  'application-monitor-state.json',
  'application-monitor-queue.json'
];
const SKIP_DIRECTORIES = new Set([
  'Cache', 'Code Cache', 'DawnCache', 'GPUCache', 'ShaderCache', 'Crashpad',
  'blob_storage', 'Session Storage', 'Local Storage', 'Network', 'Service Worker'
]);

const refs = {
  configStore: null,
  discordAuth: null,
  logger: null,
  mainWindow: null,
  splashWindow: null
};

let installed = false;
let ipcInstalled = false;
let releaseTimer = null;
let timeoutTimer = null;
let rendererModulesReady = false;
let rendererBridgeReady = false;
let preflightComplete = false;
let configStoreReady = false;
let authObserved = false;
let released = false;
let limitedMode = false;
let pendingMainShow = false;

const startedAtMs = Date.now();
let state = {
  version: 1,
  startedAt: new Date(startedAtMs).toISOString(),
  minimumVisibleUntil: new Date(startedAtMs + MINIMUM_SPLASH_MS).toISOString(),
  minimumVisibleMs: MINIMUM_SPLASH_MS,
  phase: 'starting',
  overall: 'running',
  completed: false,
  releaseAllowed: false,
  released: false,
  limitedMode: false,
  profile: {
    path: null,
    status: 'pending',
    recovered: false,
    source: null,
    backup: null,
    score: 0
  },
  checks: []
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeReadJson(filePath) {
  try { return { ok: true, value: JSON.parse(fs.readFileSync(filePath, 'utf8')), error: null }; }
  catch (error) { return { ok: false, value: null, error }; }
}

function setCheck(id, label, status, detail = '', critical = true, extra = {}) {
  const next = {
    id,
    label,
    status,
    detail: String(detail || '').slice(0, 500),
    critical: Boolean(critical),
    updatedAt: new Date().toISOString(),
    ...extra
  };
  const index = state.checks.findIndex((check) => check.id === id);
  if (index >= 0) state.checks[index] = { ...state.checks[index], ...next };
  else state.checks.push(next);
  updateOverall();
  broadcast();
  return next;
}

function profileConfigSignal(config) {
  if (!config || typeof config !== 'object') return 0;
  const discord = config.discord || {};
  const general = config.general || {};
  const monitor = config.monitor || {};
  const servers = Array.isArray(config.servers) ? config.servers : [];
  let score = servers.length * 100;
  for (const value of [discord.guildId, discord.ownerUserId, discord.oauthClientId]) if (value) score += 20;
  if (Array.isArray(discord.operatorUserIds)) score += discord.operatorUserIds.length * 8;
  if (monitor.autoReportEnabled) score += 10;
  if (monitor.reportRepository && monitor.reportRepository !== 'Khaos-Krew/Khaos-Nexus-Bot-Manager') score += 8;
  if (general.autoStartBot === false || general.autoRestart === false || general.minimizeToTray === false || general.checkUpdates === false || general.startWithWindows) score += 5;
  score += Object.keys(config).filter((key) => !['schemaVersion', 'general', 'discord', 'monitor', 'servers'].includes(key)).length * 30;
  return score;
}

function profileSummary(directory) {
  const summary = {
    directory: path.resolve(directory),
    exists: fs.existsSync(directory),
    configExists: false,
    configValid: false,
    schemaVersion: null,
    configSignal: 0,
    secretBytes: 0,
    dataFiles: 0,
    invalidDataFiles: [],
    dataBytes: 0,
    modifiedAtMs: 0,
    score: 0,
    meaningful: false
  };
  if (!summary.exists) return summary;

  const configPath = path.join(directory, 'config.json');
  if (fs.existsSync(configPath)) {
    summary.configExists = true;
    const parsed = safeReadJson(configPath);
    if (parsed.ok && parsed.value && typeof parsed.value === 'object') {
      summary.configValid = true;
      summary.schemaVersion = Number(parsed.value.schemaVersion || 0) || null;
      summary.configSignal = profileConfigSignal(parsed.value);
    }
    try { summary.modifiedAtMs = Math.max(summary.modifiedAtMs, fs.statSync(configPath).mtimeMs); } catch {}
  }

  try {
    const stat = fs.statSync(path.join(directory, 'secrets.bin'));
    summary.secretBytes = stat.size;
    summary.modifiedAtMs = Math.max(summary.modifiedAtMs, stat.mtimeMs);
  } catch {}

  for (const name of PROFILE_DATA_FILES) {
    const filePath = path.join(directory, name);
    if (!fs.existsSync(filePath)) continue;
    try {
      const stat = fs.statSync(filePath);
      summary.dataBytes += stat.size;
      summary.modifiedAtMs = Math.max(summary.modifiedAtMs, stat.mtimeMs);
      if (name.endsWith('.json')) {
        const parsed = safeReadJson(filePath);
        if (!parsed.ok) summary.invalidDataFiles.push(name);
        else summary.dataFiles += 1;
      } else summary.dataFiles += 1;
    } catch {
      summary.invalidDataFiles.push(name);
    }
  }

  summary.score = summary.configSignal + (summary.secretBytes > 16 ? 50 : 0) + (summary.dataFiles * 20) + Math.min(50, Math.floor(summary.dataBytes / 4096));
  summary.meaningful = summary.score > 0;
  return summary;
}

function shouldSkip(name) {
  return SKIP_DIRECTORIES.has(name) || /^(Singleton|LOCK$|lockfile$)/i.test(name);
}

function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  let files = 0;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (shouldSkip(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) files += copyTree(from, to);
    else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      files += 1;
    }
  }
  return files;
}

function candidateProfiles(destination) {
  const values = new Set();
  const add = (directory, reason) => {
    if (!directory) return;
    const resolved = path.resolve(directory);
    if (resolved === path.resolve(destination) || values.has(resolved)) return;
    values.add(resolved);
    candidates.push({ directory: resolved, reason });
  };
  const candidates = [];

  const marker = safeReadJson(path.join(destination, 'user-data-migration.json'));
  if (marker.ok) {
    add(marker.value?.backup, 'v0.18 migration backup');
    add(marker.value?.source, 'v0.18 migration source');
  }

  const parent = path.dirname(destination);
  const base = path.basename(destination);
  try {
    for (const name of fs.readdirSync(parent)) {
      if (name.startsWith(`${base}.pre-migration-`) || name.startsWith(`${base}.before-v0.18.3-`)) {
        add(path.join(parent, name), 'pre-migration backup');
      }
    }
  } catch {}

  const names = ['Khaos Nexus', 'khaos-nexus', 'Khaos-Nexus', 'KhaosNexus', 'khaosnexus'];
  for (const root of [process.env.APPDATA, process.env.LOCALAPPDATA]) {
    if (!root) continue;
    for (const name of names) add(path.join(root, name), 'legacy application profile');
  }

  const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath || '');
  for (const relative of ['data', 'user-data', 'Khaos Nexus Data', '.khaos-nexus']) add(path.join(portableRoot, relative), 'portable profile');

  return candidates
    .map((candidate) => ({ ...candidate, summary: profileSummary(candidate.directory) }))
    .filter((candidate) => candidate.summary.exists && candidate.summary.configValid && candidate.summary.meaningful)
    .sort((a, b) => {
      const aBackup = /backup/i.test(a.reason) ? 1 : 0;
      const bBackup = /backup/i.test(b.reason) ? 1 : 0;
      return (bBackup - aBackup) || (b.summary.score - a.summary.score) || (b.summary.modifiedAtMs - a.summary.modifiedAtMs);
    });
}

function recoverProfileIfNeeded(destination) {
  const current = profileSummary(destination);
  const candidates = candidateProfiles(destination);
  const preferred = candidates[0] || null;
  const currentInvalid = current.configExists && !current.configValid;
  const currentEmpty = !current.meaningful || current.configSignal === 0;
  const recordedBackup = preferred && /migration backup|pre-migration backup/i.test(preferred.reason);
  const clearlyBetterBackup = Boolean(recordedBackup && preferred.summary.score >= current.score + 20 && preferred.summary.configSignal > current.configSignal);

  if (!preferred || (!currentInvalid && !currentEmpty && !clearlyBetterBackup)) {
    return { recovered: false, current, preferred, candidates };
  }

  const timestamp = Date.now();
  const parent = path.dirname(destination);
  const temporary = path.join(parent, `${path.basename(destination)}.restore-tmp-${timestamp}`);
  const backup = path.join(parent, `${path.basename(destination)}.before-v0.18.3-${timestamp}`);
  let movedCurrent = false;

  try {
    fs.rmSync(temporary, { recursive: true, force: true });
    copyTree(preferred.directory, temporary);
    const verified = profileSummary(temporary);
    if (!verified.configValid || !verified.meaningful || verified.score < preferred.summary.score * 0.75) {
      throw new Error('The recovered profile did not pass post-copy validation.');
    }
    if (fs.existsSync(destination)) {
      fs.renameSync(destination, backup);
      movedCurrent = true;
    }
    fs.renameSync(temporary, destination);
    return {
      recovered: true,
      source: preferred.directory,
      sourceReason: preferred.reason,
      backup: movedCurrent ? backup : null,
      current: profileSummary(destination),
      previous: current,
      candidates
    };
  } catch (error) {
    try { fs.rmSync(temporary, { recursive: true, force: true }); } catch {}
    if (movedCurrent && !fs.existsSync(destination) && fs.existsSync(backup)) {
      try { fs.renameSync(backup, destination); } catch {}
    }
    return { recovered: false, current: profileSummary(destination), preferred, candidates, error: error.message };
  }
}

function testWritable(directory) {
  const filePath = path.join(directory, `.startup-health-${process.pid}-${Date.now()}.tmp`);
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(filePath, 'ok', 'utf8');
    fs.unlinkSync(filePath);
    return true;
  } catch {
    try { fs.unlinkSync(filePath); } catch {}
    return false;
  }
}

function runPreflight() {
  const destination = electron.app.getPath('userData');
  state.profile.path = destination;
  setCheck('profile-location', 'v0.17-compatible data location', 'running', destination, true);

  const recovery = recoverProfileIfNeeded(destination);
  const summary = recovery.current;
  state.profile = {
    path: destination,
    status: recovery.error ? 'failed' : recovery.recovered ? 'recovered' : 'loaded',
    recovered: Boolean(recovery.recovered),
    source: recovery.source || null,
    backup: recovery.backup || null,
    score: summary.score,
    candidateCount: recovery.candidates?.length || 0
  };

  if (recovery.error) {
    setCheck('profile-location', 'v0.17-compatible data location', 'fail', `Profile recovery failed: ${recovery.error}`, true);
  } else if (recovery.recovered) {
    setCheck('profile-location', 'v0.17-compatible data location', 'pass', `Recovered the prior profile from ${recovery.sourceReason}.`, true);
  } else {
    setCheck('profile-location', 'v0.17-compatible data location', 'pass', 'Using the same canonical profile path as v0.17.2.', true);
  }

  if (!summary.configExists) {
    setCheck('config-file', 'Configuration file', 'warn', 'No saved config.json was found; Khaos Nexus will start with a new profile.', false);
  } else if (!summary.configValid) {
    setCheck('config-file', 'Configuration file', 'fail', 'config.json is not valid JSON.', true);
  } else {
    setCheck('config-file', 'Configuration file', 'pass', `Schema ${summary.schemaVersion || 'unknown'} • profile score ${summary.score}.`, true);
  }

  if (summary.invalidDataFiles.length) {
    setCheck('data-integrity', 'Local module data', 'fail', `Invalid JSON: ${summary.invalidDataFiles.join(', ')}`, true);
  } else {
    setCheck('data-integrity', 'Local module data', 'pass', `${summary.dataFiles} retained module data file${summary.dataFiles === 1 ? '' : 's'} verified.`, true);
  }

  setCheck('data-write', 'Data directory write access', testWritable(destination) ? 'pass' : 'fail', destination, true);
  const secure = electron.safeStorage.isEncryptionAvailable();
  setCheck('secure-storage', 'Windows secure storage', secure ? 'pass' : 'warn', secure ? `${summary.secretBytes} encrypted credential bytes detected.` : 'Windows secure storage is unavailable; protected credentials cannot be loaded.', Boolean(summary.secretBytes));
  preflightComplete = true;
  evaluateCompletion();
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosStartupHealthPatched) return;

  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
      if (refName === 'configStore') verifyLoadedConfig(this);
      if (refName === 'discordAuth') observeDiscordAuth(this);
      if (refName === 'logger') setCheck('logger', 'Local logging', 'pass', 'Startup and health events are being retained locally.', false);
    }
  }
  Object.defineProperty(Captured, '__khaosStartupHealthPatched', { value: true });
  target[exportName] = Captured;
}

function verifyLoadedConfig(store) {
  try {
    const publicConfig = store.getPublicConfig();
    const config = store.getConfig();
    const servers = Array.isArray(config.servers) ? config.servers.length : 0;
    const secretCount = store.getSecretValues().length;
    setCheck('config-store', 'Configuration loaded into services', 'pass', `${servers} server${servers === 1 ? '' : 's'} • ${secretCount} protected value${secretCount === 1 ? '' : 's'} • ${Object.keys(config).length} configuration sections.`, true, {
      counts: { servers, secretCount, sections: Object.keys(config).length },
      hasDiscordLogin: Boolean(publicConfig.hasDiscordLogin)
    });
    configStoreReady = true;
  } catch (error) {
    setCheck('config-store', 'Configuration loaded into services', 'fail', error.message, true);
  }
  evaluateCompletion();
}

function observeDiscordAuth(auth) {
  const update = (authState) => {
    authObserved = true;
    const status = authState?.status || 'signed-out';
    if (status === 'signed-in') setCheck('discord-restore', 'Saved Discord access', 'pass', `Restored ${authState.user?.globalName || authState.user?.username || 'authorized account'}.`, false);
    else if (status === 'restoring' || status === 'refreshing') setCheck('discord-restore', 'Saved Discord access', 'running', `Discord access is ${status}.`, false);
    else if (authState?.configured) setCheck('discord-restore', 'Saved Discord access', 'warn', authState.lastError || `Discord is ${status}; sign-in remains available after startup.`, false);
    else setCheck('discord-restore', 'Saved Discord access', 'warn', 'Discord desktop login is not configured.', false);
    evaluateCompletion();
  };
  auth.on('state', update);
  setTimeout(() => update(auth.getState()), 2500).unref?.();
}

function createSplashWindow() {
  if (refs.splashWindow && !refs.splashWindow.isDestroyed()) return refs.splashWindow;
  const icon = electron.app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar', 'assets', 'icon.png')
    : path.join(__dirname, '..', 'assets', 'icon.png');
  const splash = new electron.BrowserWindow({
    width: 760,
    height: 570,
    minWidth: 660,
    minHeight: 500,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    center: true,
    show: false,
    backgroundColor: '#050608',
    icon,
    webPreferences: {
      preload: path.join(__dirname, 'startup-health-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  splash.__khaosStartupSplashWindow = true;
  splash.loadFile(path.join(__dirname, '..', 'renderer', 'startup-health.html'));
  splash.once('ready-to-show', () => {
    if (!splash.isDestroyed()) {
      splash.show();
      splash.focus();
      broadcast();
    }
  });
  splash.on('close', (event) => {
    if (!released && !limitedMode && !electron.app.isQuitting) event.preventDefault();
  });
  splash.on('closed', () => { refs.splashWindow = null; });
  refs.splashWindow = splash;
  return splash;
}

function registerMainWindow(window) {
  if (!window || window.__khaosStartupRegistered || window.__khaosStartupSplashWindow) return;
  window.__khaosStartupRegistered = true;
  refs.mainWindow = window;
  if (!released && !limitedMode) {
    window.__khaosHoldForStartup = true;
    try { window.hide(); } catch {}
  }
  window.on('closed', () => { if (refs.mainWindow === window) refs.mainWindow = null; });
}

function requestMainWindowShow(window = refs.mainWindow) {
  if (!window || window.isDestroyed()) return false;
  registerMainWindow(window);
  if (!released && !limitedMode) {
    pendingMainShow = true;
    try { window.hide(); } catch {}
    return false;
  }
  try {
    window.__khaosHoldForStartup = false;
    window.show();
    window.focus();
    return true;
  } catch {
    return false;
  }
}

function rendererStage(stage, detail = {}) {
  if (stage === 'features-ready') {
    rendererModulesReady = true;
    setCheck('renderer-modules', 'Desktop modules', 'pass', `${Number(detail.loaded) || 0} serialized feature modules loaded.`, true);
  } else if (stage === 'feature-failed') {
    setCheck('renderer-modules', 'Desktop modules', 'warn', `${detail.source || 'A feature module'} reported a load warning.`, false);
  } else if (stage === 'feature-loading') {
    setCheck('renderer-modules', 'Desktop modules', 'running', `${detail.source || 'Module'} • ${detail.position || 0} loaded • ${detail.remaining || 0} remaining.`, true);
  }
  evaluateCompletion();
}

function updateOverall() {
  const criticalFailure = state.checks.some((check) => check.critical && check.status === 'fail');
  const warning = state.checks.some((check) => check.status === 'warn' || (!check.critical && check.status === 'fail'));
  state.overall = criticalFailure ? 'failed' : state.completed ? (warning ? 'warning' : 'healthy') : 'running';
}

function completionPrerequisitesMet() {
  return preflightComplete && configStoreReady && rendererBridgeReady && rendererModulesReady;
}

function evaluateCompletion() {
  const prerequisites = completionPrerequisitesMet();
  if (prerequisites && !state.completed) {
    state.completed = true;
    state.phase = 'health-check-complete';
    state.completedAt = new Date().toISOString();
  }
  const elapsed = Date.now() - startedAtMs;
  state.releaseAllowed = Boolean(state.completed && elapsed >= MINIMUM_SPLASH_MS && !state.checks.some((check) => check.critical && check.status === 'fail'));
  updateOverall();
  broadcast();

  if (state.releaseAllowed && !released && !limitedMode) {
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => release(false), 250);
    releaseTimer.unref?.();
  } else if (state.completed && elapsed < MINIMUM_SPLASH_MS && !releaseTimer) {
    releaseTimer = setTimeout(() => {
      releaseTimer = null;
      evaluateCompletion();
    }, MINIMUM_SPLASH_MS - elapsed);
    releaseTimer.unref?.();
  }
}

function release(limited = false) {
  if (released) return;
  if (!limited && !state.releaseAllowed) return;
  released = true;
  limitedMode = Boolean(limited);
  state.released = true;
  state.limitedMode = limitedMode;
  state.phase = limitedMode ? 'limited-mode' : 'ready';
  updateOverall();
  broadcast();

  const main = refs.mainWindow;
  if (main && !main.isDestroyed()) {
    main.__khaosHoldForStartup = false;
    try { main.show(); main.focus(); } catch {}
  }
  const splash = refs.splashWindow;
  setTimeout(() => {
    if (splash && !splash.isDestroyed()) {
      splash.setAlwaysOnTop(false);
      splash.destroy();
    }
  }, limitedMode ? 100 : 550).unref?.();
}

function broadcast() {
  const payload = publicState();
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('startup-health:update', payload);
  }
}

function publicState() {
  const now = Date.now();
  return clone({
    ...state,
    elapsedMs: now - startedAtMs,
    minimumRemainingMs: Math.max(0, (startedAtMs + MINIMUM_SPLASH_MS) - now),
    rendererBridgeReady,
    rendererModulesReady,
    configStoreReady,
    authObserved,
    pendingMainShow
  });
}

function registerIpc() {
  if (ipcInstalled) return;
  ipcInstalled = true;
  electron.ipcMain.handle('startup-health:get', () => publicState());
  electron.ipcMain.handle('startup-health:renderer-ready', () => {
    rendererBridgeReady = true;
    setCheck('renderer-bridge', 'Protected renderer bridge', 'pass', 'Main/renderer IPC bridge is available.', true);
    evaluateCompletion();
    return publicState();
  });
  electron.ipcMain.handle('startup-health:retry', () => {
    electron.app.relaunch();
    electron.app.exit(0);
    return { restarting: true };
  });
  electron.ipcMain.handle('startup-health:continue-limited', () => {
    release(true);
    return publicState();
  });
  electron.ipcMain.handle('startup-health:open-data', async () => {
    const result = await electron.shell.openPath(electron.app.getPath('userData'));
    if (result) throw new Error(result);
    return { opened: true };
  });
}

function install() {
  if (installed) return;
  installed = true;
  registerIpc();
  captureClass('./services/config-store.cjs', 'ConfigStore', 'configStore');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');

  electron.ipcMain.on('renderer-boot:stage', (_event, payload) => rendererStage(String(payload?.stage || ''), payload?.detail || {}));
  electron.app.on('browser-window-created', (_event, window) => {
    if (!window.__khaosStartupSplashWindow) registerMainWindow(window);
  });

  electron.app.whenReady().then(() => {
    createSplashWindow();
    runPreflight();
    timeoutTimer = setTimeout(() => {
      if (state.completed || released) return;
      setCheck('startup-timeout', 'Startup completion', 'fail', 'Startup did not complete within 75 seconds. Review the failed or pending checks.', true);
      state.completed = true;
      state.phase = 'needs-attention';
      evaluateCompletion();
    }, STARTUP_HEALTH_TIMEOUT_MS);
    timeoutTimer.unref?.();
  }).catch((error) => {
    setCheck('startup-service', 'Startup health service', 'fail', error.message, true);
  });

  electron.app.on('before-quit', () => {
    electron.app.isQuitting = true;
    clearTimeout(releaseTimer);
    clearTimeout(timeoutTimer);
  });
}

module.exports = {
  MINIMUM_SPLASH_MS,
  STARTUP_HEALTH_TIMEOUT_MS,
  PROFILE_DATA_FILES,
  profileConfigSignal,
  profileSummary,
  candidateProfiles,
  recoverProfileIfNeeded,
  publicState,
  registerMainWindow,
  requestMainWindowShow,
  install,
  refs
};
