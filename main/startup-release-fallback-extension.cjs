'use strict';

const path = require('node:path');
const electron = require('electron');

const OPTIONAL_MODULE_GRACE_MS = 15 * 1000;
let installed = false;
let baseUiVerified = false;
let featuresReadyObserved = false;
let fallbackTimer = null;

function preloadName(target) {
  try {
    const webContents = target?.webContents || target;
    const preferences = webContents?.getLastWebPreferences?.() || {};
    return path.basename(String(preferences.preload || ''));
  } catch {
    return '';
  }
}

function isMainInterfaceWindow(target) {
  return preloadName(target) === 'preload.cjs';
}

function emitFallbackReady(event = {}) {
  if (featuresReadyObserved || !baseUiVerified || electron.app.isQuitting) return;
  featuresReadyObserved = true;
  electron.ipcMain.emit('renderer-boot:stage', event, {
    stage: 'features-ready',
    detail: {
      loaded: 0,
      fallback: true,
      baseInterfaceVerified: true,
      optionalModulesContinuing: true,
      graceMs: OPTIONAL_MODULE_GRACE_MS,
      reason: 'Saved state, local logs, and the protected base interface were verified.'
    },
    time: new Date().toISOString()
  });
  console.warn('[Khaos Nexus] Releasing the verified base interface after the optional-module grace period.');
}

function scheduleRelease(event, payload = {}) {
  if (baseUiVerified) return;
  baseUiVerified = true;
  clearTimeout(fallbackTimer);
  fallbackTimer = setTimeout(() => emitFallbackReady(event), OPTIONAL_MODULE_GRACE_MS);
  fallbackTimer.unref?.();
  console.info('[Khaos Nexus] Base interface verified for startup release.', {
    version: payload.version || null,
    servers: Number(payload.servers) || 0,
    configSections: Number(payload.configSections) || 0,
    logEntries: Number(payload.logEntries) || 0
  });
}

function observeBootStage(_event, payload = {}) {
  if (String(payload?.stage || '') !== 'features-ready') return;
  featuresReadyObserved = true;
  clearTimeout(fallbackTimer);
  fallbackTimer = null;
}

function registerIpc() {
  if (registerIpc.done) return;
  registerIpc.done = true;
  electron.ipcMain.on('renderer-boot:stage', observeBootStage);
  electron.ipcMain.handle('startup-health:base-ui-ready', (event, payload = {}) => {
    if (!isMainInterfaceWindow(event.sender)) throw new Error('Only the protected main interface can complete the base startup check.');
    scheduleRelease(event, payload);
    return {
      verified: true,
      optionalGraceMs: OPTIONAL_MODULE_GRACE_MS,
      alreadyVerified: baseUiVerified
    };
  });
}

function verifyBaseInterface(window) {
  if (!window || window.isDestroyed() || !isMainInterfaceWindow(window) || window.__khaosStartupReleaseFallbackInstalled) return;
  window.__khaosStartupReleaseFallbackInstalled = true;
  const webContents = window.webContents;
  const webContentsId = webContents.id;

  const run = () => {
    if (window.isDestroyed() || webContents.isDestroyed() || webContents.id !== webContentsId) return;
    webContents.executeJavaScript(`(async () => {
      if (!window.khaos || typeof window.khaos.invoke !== 'function') throw new Error('The protected renderer bridge is unavailable.');
      const [appState, logs] = await Promise.all([
        window.khaos.invoke('app:get-state'),
        window.khaos.invoke('logs:get', 20)
      ]);
      const payload = {
        version: appState?.app?.version || '',
        servers: Array.isArray(appState?.config?.servers) ? appState.config.servers.length : 0,
        configSections: appState?.config && typeof appState.config === 'object' ? Object.keys(appState.config).length : 0,
        logEntries: Array.isArray(logs) ? logs.length : 0
      };
      return window.khaos.invoke('startup-health:base-ui-ready', payload);
    })()`).then((result) => {
      if (!result?.verified) throw new Error('The startup base-interface verification did not complete.');
    }).catch((error) => {
      console.error('[Khaos Nexus] Base interface readiness verification failed.', error);
    });
  };

  if (webContents.isLoading()) webContents.once('did-finish-load', () => setTimeout(run, 750));
  else setTimeout(run, 750);
}

function patchBrowserLoader() {
  const prototype = electron.BrowserWindow?.prototype;
  if (!prototype || prototype.__khaosStartupReleaseFallbackPatched) return;
  const original = prototype.loadFile;
  prototype.loadFile = function patchedLoadFile(...args) {
    const result = original.apply(this, args);
    verifyBaseInterface(this);
    return result;
  };
  Object.defineProperty(prototype, '__khaosStartupReleaseFallbackPatched', { value: true });
}

function install() {
  if (installed) return;
  installed = true;
  registerIpc();
  patchBrowserLoader();
  electron.app.on('browser-window-created', (_event, window) => verifyBaseInterface(window));
  electron.app.whenReady().then(() => {
    for (const window of electron.BrowserWindow.getAllWindows()) verifyBaseInterface(window);
  }).catch(() => {});
  electron.app.on('before-quit', () => {
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  });
}

module.exports = {
  OPTIONAL_MODULE_GRACE_MS,
  preloadName,
  isMainInterfaceWindow,
  verifyBaseInterface,
  emitFallbackReady,
  install
};
