'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const startupHealth = require('./startup-health-extension.cjs');

const OPTIONAL_MODULE_GRACE_MS = 15 * 1000;
const BASE_UI_RETRY_MS = 500;
const BASE_UI_MAX_ATTEMPTS = 30;
let installed = false;
let baseUiVerified = false;
let featuresReadyObserved = false;
let fallbackTimer = null;
let lastVerification = null;

function preloadName(target) {
  try {
    const webContents = target?.webContents || target;
    const preferences = webContents?.getLastWebPreferences?.() || {};
    return path.basename(String(preferences.preload || ''));
  } catch {
    return '';
  }
}

function rendererFileName(target) {
  try {
    const webContents = target?.webContents || target;
    const url = new URL(String(webContents?.getURL?.() || ''));
    return path.basename(decodeURIComponent(url.pathname || ''));
  } catch {
    return '';
  }
}

function mainWebContents() {
  const window = startupHealth.refs.mainWindow;
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return null;
  return window.webContents;
}

function isMainInterfaceWindow(target) {
  const webContents = target?.webContents || target;
  if (!webContents || webContents.isDestroyed?.()) return false;
  const main = mainWebContents();
  if (main && main.id === webContents.id) return true;
  return preloadName(webContents) === 'preload.cjs' && rendererFileName(webContents) === 'index.html';
}

function diagnosticsPath() {
  try { return path.join(electron.app.getPath('userData'), 'startup-release-diagnostics.json'); }
  catch { return null; }
}

function safeHealthState() {
  try {
    const value = startupHealth.publicState();
    return {
      elapsedMs: value.elapsedMs,
      phase: value.phase,
      overall: value.overall,
      completed: value.completed,
      releaseAllowed: value.releaseAllowed,
      released: value.released,
      rendererBridgeReady: value.rendererBridgeReady,
      rendererModulesReady: value.rendererModulesReady,
      configStoreReady: value.configStoreReady,
      authObserved: value.authObserved,
      checks: (value.checks || []).map((check) => ({
        id: check.id,
        label: check.label,
        status: check.status,
        critical: check.critical,
        detail: check.detail
      }))
    };
  } catch {
    return null;
  }
}

function record(stage, detail = {}, level = 'info') {
  lastVerification = {
    format: 'khaos-nexus-startup-release-diagnostics',
    formatVersion: 1,
    time: new Date().toISOString(),
    stage,
    detail,
    baseUiVerified,
    featuresReadyObserved,
    health: safeHealthState()
  };
  const filePath = diagnosticsPath();
  if (filePath) {
    try {
      fs.writeFileSync(`${filePath}.tmp`, JSON.stringify(lastVerification, null, 2), 'utf8');
      try { fs.renameSync(`${filePath}.tmp`, filePath); }
      catch {
        fs.rmSync(filePath, { force: true });
        fs.renameSync(`${filePath}.tmp`, filePath);
      }
    } catch {}
  }
  const logger = startupHealth.refs.logger;
  const message = `Startup release: ${stage}.`;
  if (logger?.[level]) logger[level](message, detail);
  else console[level] ? console[level](`[Khaos Nexus] ${message}`, detail) : console.log(`[Khaos Nexus] ${message}`, detail);
}

function emitFallbackReady() {
  if (featuresReadyObserved || !baseUiVerified || electron.app.isQuitting) return;
  const main = mainWebContents();
  featuresReadyObserved = true;
  const detail = {
    loaded: 0,
    fallback: true,
    baseInterfaceVerified: true,
    optionalModulesContinuing: true,
    graceMs: OPTIONAL_MODULE_GRACE_MS,
    reason: 'Saved state, local logs, and the protected base interface were verified directly.'
  };
  electron.ipcMain.emit('renderer-boot:stage', { sender: main }, {
    stage: 'features-ready',
    detail,
    time: new Date().toISOString()
  });
  record('base-interface-released', detail, 'warn');
}

function scheduleRelease(payload = {}) {
  if (baseUiVerified) return false;
  baseUiVerified = true;
  clearTimeout(fallbackTimer);
  fallbackTimer = setTimeout(emitFallbackReady, OPTIONAL_MODULE_GRACE_MS);
  fallbackTimer.unref?.();
  record('base-interface-verified', {
    version: payload.version || null,
    servers: Number(payload.servers) || 0,
    configSections: Number(payload.configSections) || 0,
    logEntries: Number(payload.logEntries) || 0,
    documentReadyState: payload.documentReadyState || null,
    source: payload.source || 'unknown',
    optionalGraceMs: OPTIONAL_MODULE_GRACE_MS
  });
  return true;
}

function observeBootStage(_event, payload = {}) {
  if (String(payload?.stage || '') !== 'features-ready') return;
  const wasSynthetic = Boolean(payload?.detail?.fallback);
  featuresReadyObserved = true;
  clearTimeout(fallbackTimer);
  fallbackTimer = null;
  record(wasSynthetic ? 'synthetic-features-ready-observed' : 'renderer-features-ready-observed', payload.detail || {});
}

function registerIpc() {
  if (registerIpc.done) return;
  registerIpc.done = true;
  electron.ipcMain.on('renderer-boot:stage', observeBootStage);
  electron.ipcMain.handle('startup-health:base-ui-ready', (event, payload = {}) => {
    if (!isMainInterfaceWindow(event.sender)) {
      record('base-interface-signal-rejected', {
        senderId: event.sender?.id || null,
        preload: preloadName(event.sender),
        rendererFile: rendererFileName(event.sender)
      }, 'error');
      throw new Error('Only the protected main interface can complete the base startup check.');
    }
    const newlyVerified = scheduleRelease(payload);
    return {
      verified: true,
      optionalGraceMs: OPTIONAL_MODULE_GRACE_MS,
      alreadyVerified: !newlyVerified
    };
  });
}

function verifyFromMainDocument(window, attempt = 1) {
  if (!window || window.isDestroyed() || !isMainInterfaceWindow(window) || baseUiVerified) return;
  const webContents = window.webContents;
  webContents.executeJavaScript(`(async () => {
    if (!window.khaos || typeof window.khaos.invoke !== 'function') throw new Error('The protected renderer bridge is unavailable.');
    if (!document.getElementById('view-dashboard')) throw new Error('The base dashboard document is unavailable.');
    const [appState, logs] = await Promise.all([
      window.khaos.invoke('app:get-state'),
      window.khaos.invoke('logs:get', 20)
    ]);
    const config = appState?.config && typeof appState.config === 'object' ? appState.config : {};
    return window.khaos.invoke('startup-health:base-ui-ready', {
      version: appState?.app?.version || '',
      servers: Array.isArray(config.servers) ? config.servers.length : 0,
      configSections: Object.keys(config).length,
      logEntries: Array.isArray(logs) ? logs.length : 0,
      documentReadyState: document.readyState,
      source: 'main-document-backup'
    });
  })()`).then((result) => {
    if (!result?.verified) throw new Error('The startup base-interface verification did not complete.');
  }).catch((error) => {
    if (attempt < BASE_UI_MAX_ATTEMPTS && !baseUiVerified) {
      setTimeout(() => verifyFromMainDocument(window, attempt + 1), BASE_UI_RETRY_MS);
      return;
    }
    record('base-interface-verification-failed', {
      attempts: attempt,
      message: error.message || String(error),
      preload: preloadName(window),
      rendererFile: rendererFileName(window)
    }, 'error');
  });
}

function attachWindow(window) {
  if (!window || window.isDestroyed() || window.__khaosStartupReleaseFallbackAttached) return;
  window.__khaosStartupReleaseFallbackAttached = true;
  window.webContents.on('did-finish-load', () => {
    if (!isMainInterfaceWindow(window) || baseUiVerified) return;
    record('main-document-finished-loading', {
      webContentsId: window.webContents.id,
      preload: preloadName(window),
      rendererFile: rendererFileName(window)
    });
    setTimeout(() => verifyFromMainDocument(window, 1), 750);
  });
}

function install() {
  if (installed) return;
  installed = true;
  registerIpc();
  electron.app.on('browser-window-created', (_event, window) => attachWindow(window));
  electron.app.whenReady().then(() => {
    for (const window of electron.BrowserWindow.getAllWindows()) attachWindow(window);
  }).catch((error) => record('fallback-installation-failed', { message: error.message }, 'error'));
  electron.app.on('before-quit', () => {
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  });
}

module.exports = {
  OPTIONAL_MODULE_GRACE_MS,
  BASE_UI_RETRY_MS,
  BASE_UI_MAX_ATTEMPTS,
  preloadName,
  rendererFileName,
  isMainInterfaceWindow,
  scheduleRelease,
  verifyFromMainDocument,
  emitFallbackReady,
  install,
  getLastVerification: () => lastVerification
};
