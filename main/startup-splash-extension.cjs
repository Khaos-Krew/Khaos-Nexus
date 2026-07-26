'use strict';

const path = require('node:path');
const electron = require('electron');
const { StartupManager } = require('./services/startup-manager.cjs');

const STARTUP_TIMEOUT_MS = 45000;
const OPTIONAL_MODULE_TIMEOUT_MS = 20000;
let installed = false;
let manager = null;
let splashWindow = null;
let mainWindow = null;
let mainWindowLoaded = false;
let allowMainWindowReveal = false;
let revealWasRequested = false;
let startupTimeout = null;
let optionalModuleTimeout = null;
let originalShow = null;
let originalLoadFile = null;

function usableWindow(window) {
  try {
    return Boolean(window && !window.isDestroyed() && window.webContents && !window.webContents.isDestroyed());
  } catch {
    return false;
  }
}

function currentState() {
  return manager?.snapshot() || {
    status: 'starting',
    stage: 'not-started',
    progress: 0,
    message: 'Preparing Khaos Nexus…',
    detail: '',
    version: electron.app.getVersion?.() || 'unknown',
    warnings: []
  };
}

function sendState(state = currentState()) {
  if (!usableWindow(splashWindow)) return;
  try { splashWindow.webContents.send('startup-splash:state', state); } catch {}
}

function clearTimers() {
  if (startupTimeout) clearTimeout(startupTimeout);
  if (optionalModuleTimeout) clearTimeout(optionalModuleTimeout);
  startupTimeout = null;
  optionalModuleTimeout = null;
}

function revealMainWindow() {
  if (!usableWindow(mainWindow)) return false;
  allowMainWindowReveal = true;
  try {
    originalShow.call(mainWindow);
    mainWindow.moveTop?.();
    mainWindow.focus();
    return true;
  } catch (error) {
    manager?.fail(error, 'window-reveal-failed');
    return false;
  }
}

function closeSplashSoon() {
  const timer = setTimeout(() => {
    if (usableWindow(splashWindow)) splashWindow.close();
    splashWindow = null;
  }, 380);
  timer.unref?.();
}

function finishStartup({ degraded = false, message, detail = '' } = {}) {
  if (!manager || ['ready', 'degraded'].includes(manager.snapshot().status)) return;
  clearTimers();
  manager.complete({ degraded, message, detail });
  revealMainWindow();
  closeSplashSoon();
}

function failStartup(error, stage = 'startup-failed') {
  clearTimers();
  if (!manager) return;
  manager.fail(error, stage);
  if (!usableWindow(splashWindow)) {
    electron.dialog.showErrorBox('Khaos Nexus startup failed', error?.message || String(error));
  }
}

function armOptionalModuleTimeout() {
  if (optionalModuleTimeout) clearTimeout(optionalModuleTimeout);
  optionalModuleTimeout = setTimeout(() => {
    manager?.warn('Optional desktop modules did not report ready before the safety timeout.');
    finishStartup({
      degraded: true,
      message: 'Khaos Nexus opened while optional modules continue loading.',
      detail: 'Core controls are available. Any module still initializing will become available when ready.'
    });
  }, OPTIONAL_MODULE_TIMEOUT_MS);
  optionalModuleTimeout.unref?.();
}

function attachMainWindow(window) {
  if (!usableWindow(window) || window.__khaosStartupSplashAttached) return;
  window.__khaosStartupSplashAttached = true;
  mainWindow = window;
  manager?.transition({
    stage: 'core-services-ready',
    progress: 42,
    message: 'Core services initialized',
    detail: 'Loading the protected desktop interface.'
  });

  window.webContents.on('did-start-loading', () => manager?.transition({
    stage: 'renderer-loading',
    progress: 52,
    message: 'Loading the Khaos Nexus interface',
    detail: 'Preparing navigation, controls, and local modules.'
  }));

  window.webContents.on('dom-ready', () => manager?.transition({
    stage: 'renderer-document-ready',
    progress: 68,
    message: 'Desktop interface prepared',
    detail: 'Connecting the interface to local services.'
  }));

  window.webContents.on('did-finish-load', () => {
    mainWindowLoaded = true;
    manager?.transition({
      stage: 'renderer-ready',
      progress: 82,
      message: 'Desktop interface loaded',
      detail: 'Starting feature modules in a safe sequence.'
    });
    armOptionalModuleTimeout();
  });

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (!isMainFrame) return;
    const error = new Error(`Desktop interface failed to load (${errorCode}): ${errorDescription || validatedUrl || 'unknown error'}`);
    failStartup(error, 'renderer-load-failed');
  });

  window.webContents.on('render-process-gone', (_event, details) => {
    failStartup(new Error(`Desktop renderer exited during startup: ${details?.reason || 'unknown reason'}`), 'renderer-process-exited');
  });

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
}

function isPrimaryRendererFile(filePath) {
  const normalized = path.normalize(String(filePath || '')).toLowerCase();
  return path.basename(normalized) === 'index.html' && path.basename(path.dirname(normalized)) === 'renderer';
}

function patchBrowserWindow() {
  const prototype = electron.BrowserWindow?.prototype;
  if (!prototype || prototype.__khaosStartupSplashPatched) return;
  originalShow = prototype.show;
  originalLoadFile = prototype.loadFile;

  prototype.show = function startupGatedShow(...args) {
    if (this === mainWindow && !allowMainWindowReveal) {
      revealWasRequested = true;
      return false;
    }
    return originalShow.apply(this, args);
  };

  prototype.loadFile = function startupObservedLoadFile(filePath, ...args) {
    if (!this.__khaosStartupSplashWindow && isPrimaryRendererFile(filePath)) attachMainWindow(this);
    return originalLoadFile.call(this, filePath, ...args);
  };

  Object.defineProperty(prototype, '__khaosStartupSplashPatched', { value: true });
}

function createSplashWindow() {
  splashWindow = new electron.BrowserWindow({
    width: 720,
    height: 500,
    minWidth: 720,
    minHeight: 500,
    maxWidth: 720,
    maxHeight: 500,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    center: true,
    backgroundColor: '#06070a',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'startup-splash-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  splashWindow.__khaosStartupSplashWindow = true;
  splashWindow.setMenuBarVisibility(false);
  splashWindow.once('ready-to-show', () => {
    if (!usableWindow(splashWindow)) return;
    splashWindow.show();
    sendState();
  });
  splashWindow.webContents.on('did-finish-load', () => sendState());
  splashWindow.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame) return;
    electron.dialog.showErrorBox('Khaos Nexus', `The startup screen could not load (${code}): ${description || url}`);
    electron.app.quit();
  });
  splashWindow.on('closed', () => { splashWindow = null; });
  splashWindow.loadFile(path.join(__dirname, '..', 'renderer', 'splash.html')).catch((error) => {
    electron.dialog.showErrorBox('Khaos Nexus', `The startup screen could not open: ${error.message}`);
    electron.app.quit();
  });
}

function registerIpc() {
  const { ipcMain, app, shell } = electron;
  ipcMain.handle('startup-splash:get-state', () => currentState());
  ipcMain.handle('startup-splash:retry', () => {
    app.relaunch();
    app.exit(0);
    return { restarting: true };
  });
  ipcMain.handle('startup-splash:open-offline', () => {
    if (!mainWindowLoaded || !usableWindow(mainWindow)) {
      return { opened: false, reason: 'The desktop interface did not finish loading, so offline mode cannot be opened safely.' };
    }
    manager?.warn('Startup recovery opened the desktop in offline mode.');
    finishStartup({
      degraded: true,
      message: 'Khaos Nexus opened in offline mode.',
      detail: 'Network-dependent and unfinished services remain unavailable until the application is restarted.'
    });
    return { opened: true };
  });
  ipcMain.handle('startup-splash:open-logs', () => {
    const logDirectory = path.join(app.getPath('userData'), 'logs');
    return shell.openPath(logDirectory);
  });
  ipcMain.handle('startup-splash:exit', () => {
    app.quit();
    return { exiting: true };
  });

  ipcMain.on('renderer-boot:stage', (event, payload = {}) => {
    if (!usableWindow(mainWindow) || event.sender.id !== mainWindow.webContents.id) return;
    const stage = String(payload.stage || 'unknown');
    const detail = payload.detail && typeof payload.detail === 'object' ? payload.detail : {};

    if (stage === 'coordinator-ready') manager?.transition({
      stage: 'module-coordinator-ready',
      progress: 76,
      message: 'Module coordinator ready',
      detail: 'Feature modules will load one at a time for stability.'
    });
    else if (stage === 'document-loaded') manager?.transition({
      stage: 'renderer-connected',
      progress: 84,
      message: 'Desktop services connected',
      detail: 'Finalizing feature modules.'
    });
    else if (stage === 'feature-loading') {
      const position = Math.max(1, Number(detail.position) || 1);
      const remaining = Math.max(0, Number(detail.remaining) || 0);
      const total = Math.max(position, position + remaining);
      const progress = 85 + Math.round((position / total) * 12);
      manager?.transition({
        stage: 'module-loading',
        progress,
        message: `Loading ${String(detail.source || 'desktop module')}`,
        detail: `Module ${position} of ${total}`
      });
    } else if (stage === 'feature-failed') {
      manager?.warn(`Optional module failed to initialize: ${String(detail.source || 'unknown module')}`);
    } else if (stage === 'features-ready') {
      finishStartup({
        degraded: Boolean(manager?.snapshot().warnings.length),
        message: manager?.snapshot().warnings.length ? 'Khaos Nexus started with limited functionality.' : 'Khaos Nexus is ready.',
        detail: manager?.snapshot().warnings.length ? 'One or more optional modules reported a startup warning. Core controls remain available.' : 'All critical desktop services and feature modules are ready.'
      });
    }
  });
}

function install() {
  if (installed) return;
  installed = true;
  patchBrowserWindow();
  registerIpc();

  electron.app.whenReady().then(() => {
    const logDirectory = path.join(electron.app.getPath('userData'), 'logs');
    manager = new StartupManager({ version: electron.app.getVersion(), logDirectory });
    manager.on('state', sendState);
    manager.transition({
      stage: 'electron-ready',
      progress: 12,
      message: 'Khaos Nexus runtime ready',
      detail: 'Opening the protected startup environment.'
    });
    createSplashWindow();
    manager.transition({
      stage: 'loading-configuration',
      progress: 22,
      message: 'Loading protected configuration',
      detail: 'Restoring local settings, credentials, and service definitions.'
    });

    startupTimeout = setTimeout(() => {
      if (mainWindowLoaded) {
        manager.warn('Startup exceeded the critical safety timeout after the interface loaded.');
        finishStartup({
          degraded: true,
          message: 'Khaos Nexus opened after a delayed startup.',
          detail: 'The interface is available, but one or more services may still be initializing.'
        });
      } else {
        failStartup(new Error('Khaos Nexus did not finish critical startup within 45 seconds.'), 'startup-timeout');
      }
    }, STARTUP_TIMEOUT_MS);
    startupTimeout.unref?.();
  }).catch((error) => failStartup(error, 'electron-ready-failed'));
}

module.exports = {
  STARTUP_TIMEOUT_MS,
  OPTIONAL_MODULE_TIMEOUT_MS,
  install,
  currentState,
  usableWindow,
  isPrimaryRendererFile
};
