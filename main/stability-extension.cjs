'use strict';

const path = require('node:path');
const electron = require('electron');
const {
  BOT_STARTUP_TIMEOUT_MS,
  isStartupStatus,
  startupTimeoutMessage
} = require('../shared/startup-guard.cjs');

const RENDERER_HEARTBEAT_TIMEOUT_MS = 30000;
const RENDERER_STARTUP_GRACE_MS = 60000;
const NATIVE_UNRESPONSIVE_CONFIRM_MS = 12000;
const RENDERER_RECOVERY_COOLDOWN_MS = 60000;
const rendererHeartbeats = new Map();
const rendererLoadedAt = new Map();
const nativeUnresponsiveTimers = new Map();
let rendererWatchdog = null;
let recoveryPromptOpen = false;
let installed = false;

function restartApplication() {
  if (electron.app.isQuitting) return;
  electron.app.relaunch();
  electron.app.exit(0);
}

function softwareRenderingRequested() {
  return process.argv.includes('--safe-renderer') || process.argv.includes('--disable-gpu') || process.env.KHAOS_NEXUS_SOFTWARE_RENDERING === '1';
}

function configureGraphicsMode() {
  if (!softwareRenderingRequested()) return false;
  electron.app.disableHardwareAcceleration();
  electron.app.commandLine.appendSwitch('disable-gpu-compositing');
  electron.app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  return true;
}

function usableWindow(window) {
  try {
    return Boolean(window && !window.isDestroyed() && window.webContents && !window.webContents.isDestroyed());
  } catch {
    return false;
  }
}

function preloadName(window) {
  try {
    const preferences = window?.webContents?.getLastWebPreferences?.() || {};
    return path.basename(String(preferences.preload || ''));
  } catch {
    return '';
  }
}

function isMainInterfaceWindow(window) {
  if (!usableWindow(window) || window.__khaosStartupSplashWindow) return false;
  return preloadName(window) === 'preload.cjs';
}

function clearNativeUnresponsiveTimer(webContentsId) {
  const timer = nativeUnresponsiveTimers.get(webContentsId);
  if (timer) clearTimeout(timer);
  nativeUnresponsiveTimers.delete(webContentsId);
}

function cleanupRendererTracking(webContentsId) {
  clearNativeUnresponsiveTimer(webContentsId);
  rendererHeartbeats.delete(webContentsId);
  rendererLoadedAt.delete(webContentsId);
}

function patchBotSupervisor() {
  const target = require('./services/bot-supervisor.cjs');
  const Original = target.BotSupervisor;
  if (!Original || Original.__khaosStabilityPatched) return;

  class StableBotSupervisor extends Original {
    constructor(...args) {
      super(...args);
      this.khaosStartupTimer = null;
      this.khaosTimedOutChild = null;
      this.khaosLaunchFailureChild = null;
    }

    clearKhaosStartupTimer() {
      if (this.khaosStartupTimer) clearTimeout(this.khaosStartupTimer);
      this.khaosStartupTimer = null;
    }

    armKhaosStartupTimer(child) {
      this.clearKhaosStartupTimer();
      if (!child) return;
      this.khaosStartupTimer = setTimeout(() => {
        if (this.child !== child || !isStartupStatus(this.state?.status)) return;
        this.khaosTimedOutChild = child;
        const error = new Error(startupTimeoutMessage(BOT_STARTUP_TIMEOUT_MS));
        error.code = 'BOT_STARTUP_TIMEOUT';
        this.recordError(error);
        this.update({ status: 'error' });
        this.logger?.error?.('Discord bot startup timed out.', { timeoutMs: BOT_STARTUP_TIMEOUT_MS, pid: child.pid || null });
        try { child.kill(); } catch (killError) {
          this.logger?.error?.('Could not terminate the timed-out Discord bot process.', { message: killError.message });
          this.child = null;
          this.update({ pid: null, ready: null, heartbeat: null, lastHeartbeatAt: null, status: 'error' });
        }
      }, BOT_STARTUP_TIMEOUT_MS);
      this.khaosStartupTimer?.unref?.();
    }

    start() {
      if (this.child) return super.start();
      try {
        const result = super.start();
        if (this.child && isStartupStatus(this.state?.status)) this.armKhaosStartupTimer(this.child);
        return result;
      } catch (error) {
        this.clearKhaosStartupTimer();
        const failedChild = this.child;
        if (failedChild) this.khaosLaunchFailureChild = failedChild;
        this.recordError(error);
        this.update({ status: 'error', pid: failedChild?.pid || null });
        if (failedChild) {
          try { failedChild.kill(); } catch {}
        } else {
          this.khaosLaunchFailureChild = null;
          this.update({ pid: null, ready: null, heartbeat: null, lastHeartbeatAt: null });
        }
        throw error;
      }
    }

    handleMessage(message) {
      if (message?.type === 'ready' || (message?.type === 'heartbeat' && message?.payload?.ready)) this.clearKhaosStartupTimer();
      return super.handleMessage(message);
    }

    handleExit(code) {
      const exitingChild = this.child;
      if (exitingChild && exitingChild === this.khaosTimedOutChild) {
        this.clearKhaosStartupTimer();
        this.khaosTimedOutChild = null;
        this.child = null;
        this.stopping = false;
        this.restartPending = false;
        this.update({ pid: null, ready: null, heartbeat: null, lastHeartbeatAt: null, status: 'error' });
        this.logger?.error?.('Timed-out Discord bot process exited.', { code });
        return;
      }
      if (exitingChild && exitingChild === this.khaosLaunchFailureChild) {
        this.clearKhaosStartupTimer();
        this.khaosLaunchFailureChild = null;
        this.child = null;
        this.stopping = false;
        this.restartPending = false;
        this.update({ pid: null, ready: null, heartbeat: null, lastHeartbeatAt: null, status: 'error' });
        this.logger?.error?.('Discord bot launch failed and the child process exited.', { code });
        return;
      }
      this.clearKhaosStartupTimer();
      return super.handleExit(code);
    }

    async stop() {
      this.clearKhaosStartupTimer();
      this.khaosTimedOutChild = null;
      this.khaosLaunchFailureChild = null;
      return super.stop();
    }
  }

  Object.defineProperty(StableBotSupervisor, '__khaosStabilityPatched', { value: true });
  target.BotSupervisor = StableBotSupervisor;
}

function patchRendererErrorCapture() {
  const ipcMain = electron.ipcMain;
  if (!ipcMain || ipcMain.__khaosRendererErrorDeduped) return;
  const originalHandle = ipcMain.handle.bind(ipcMain);
  const recent = new Map();

  ipcMain.handle = function patchedHandle(channel, listener) {
    if (channel !== 'monitor:capture-renderer') return originalHandle(channel, listener);
    return originalHandle(channel, (event, payload = {}) => {
      const message = String(payload.message || 'Unknown renderer error').slice(0, 1000);
      const stack = String(payload.stack || '').slice(0, 12000);
      const key = `${message}\n${stack}`;
      const now = Date.now();
      const previous = recent.get(key) || 0;
      recent.set(key, now);
      for (const [entry, time] of recent) if (now - time > 5 * 60 * 1000) recent.delete(entry);
      if (now - previous < 60000) return { captured: false, duplicate: true };
      return listener(event, { ...payload, message, stack });
    });
  };

  Object.defineProperty(ipcMain, '__khaosRendererErrorDeduped', { value: true });
}

async function offerRendererRecovery(window, reason, webContentsId = null) {
  if (!isMainInterfaceWindow(window) || recoveryPromptOpen || electron.app.isQuitting) return false;
  const id = webContentsId || window.webContents.id;
  const now = Date.now();
  if (now - Number(window.__khaosLastRendererRecoveryPrompt || 0) < RENDERER_RECOVERY_COOLDOWN_MS) return false;
  window.__khaosLastRendererRecoveryPrompt = now;
  recoveryPromptOpen = true;
  try {
    const result = await electron.dialog.showMessageBox(window, {
      type: 'warning',
      title: 'Khaos Nexus Interface Not Responding',
      message: 'The Khaos Nexus interface stopped responding.',
      detail: `${reason}. Your settings and protected credentials are safe. Restart the application to restore the interface.`,
      buttons: ['Restart Khaos Nexus', 'Wait'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (result.response === 0) restartApplication();
    return result.response === 0;
  } catch (error) {
    console.error('[Khaos Nexus] Renderer recovery prompt failed.', error);
    return false;
  } finally {
    recoveryPromptOpen = false;
    rendererHeartbeats.set(id, Date.now());
  }
}

function scheduleNativeUnresponsiveConfirmation(window, webContentsId) {
  if (!isMainInterfaceWindow(window) || nativeUnresponsiveTimers.has(webContentsId) || electron.app.isQuitting) return;
  const signalAt = Date.now();
  const timer = setTimeout(() => {
    nativeUnresponsiveTimers.delete(webContentsId);
    if (!isMainInterfaceWindow(window) || window.webContents.id !== webContentsId || electron.app.isQuitting) return;
    const now = Date.now();
    const loadedAt = rendererLoadedAt.get(webContentsId) || signalAt;
    const lastHeartbeat = rendererHeartbeats.get(webContentsId) || loadedAt;
    if (now - loadedAt < RENDERER_STARTUP_GRACE_MS) return;
    if (lastHeartbeat > signalAt || now - lastHeartbeat <= RENDERER_HEARTBEAT_TIMEOUT_MS) return;
    offerRendererRecovery(window, 'The renderer remained unresponsive and stopped sending health heartbeats', webContentsId).catch((error) => {
      console.error('[Khaos Nexus] Sustained unresponsive-renderer recovery failed.', error);
    });
  }, NATIVE_UNRESPONSIVE_CONFIRM_MS);
  timer.unref?.();
  nativeUnresponsiveTimers.set(webContentsId, timer);
}

function attachWindowRecovery(window) {
  if (!isMainInterfaceWindow(window) || window.__khaosRendererRecoveryAttached) return;
  window.__khaosRendererRecoveryAttached = true;
  const webContents = window.webContents;
  const webContentsId = webContents.id;
  const attachedAt = Date.now();
  rendererHeartbeats.set(webContentsId, attachedAt);
  rendererLoadedAt.set(webContentsId, attachedAt);

  window.on('unresponsive', () => {
    console.warn('[Khaos Nexus] Electron reported a temporarily unresponsive main renderer; waiting for heartbeat confirmation.');
    scheduleNativeUnresponsiveConfirmation(window, webContentsId);
  });
  window.on('responsive', () => {
    clearNativeUnresponsiveTimer(webContentsId);
    rendererHeartbeats.set(webContentsId, Date.now());
  });
  webContents.on('did-finish-load', () => {
    const now = Date.now();
    rendererLoadedAt.set(webContentsId, now);
    rendererHeartbeats.set(webContentsId, now);
  });
  webContents.on('render-process-gone', (_event, details) => {
    console.error('[Khaos Nexus] Main renderer process exited.', details);
    if (electron.app.isQuitting) return;
    const timer = setTimeout(() => {
      offerRendererRecovery(window, `The renderer process exited (${details.reason || 'unknown'})`, webContentsId).catch((error) => {
        console.error('[Khaos Nexus] Renderer-process recovery failed.', error);
      });
    }, 500);
    timer.unref?.();
  });
  webContents.on('destroyed', () => cleanupRendererTracking(webContentsId));
  window.on('closed', () => cleanupRendererTracking(webContentsId));
}

function patchBrowserLoader() {
  const prototype = electron.BrowserWindow?.prototype;
  if (!prototype || prototype.__khaosStabilityUiPatched) return;
  const original = prototype.loadFile;

  prototype.loadFile = function patchedLoadFile(...args) {
    const window = this;
    const managed = isMainInterfaceWindow(window);
    if (managed) attachWindowRecovery(window);
    const webContents = window.webContents;
    const webContentsId = webContents.id;
    if (managed) {
      webContents.once('did-finish-load', () => {
        if (!isMainInterfaceWindow(window) || window.webContents.id !== webContentsId) return;
        window.webContents.executeJavaScript(`(() => {
          if (!document.querySelector('link[href="stability-fixes.css"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'stability-fixes.css';
            document.head.appendChild(link);
          }
          if (!document.querySelector('script[src="stability-fixes.js"]')) {
            const script = document.createElement('script');
            script.src = 'stability-fixes.js';
            script.defer = true;
            document.body.appendChild(script);
          }
        })();`).catch((error) => console.error('[Khaos Nexus] Stability renderer bootstrap failed.', error));
      });
    }
    return original.apply(window, args);
  };

  Object.defineProperty(prototype, '__khaosStabilityUiPatched', { value: true });
}

function installRendererHeartbeat() {
  if (installRendererHeartbeat.done) return;
  installRendererHeartbeat.done = true;
  electron.ipcMain.handle('stability:heartbeat', (event) => {
    const now = Date.now();
    rendererHeartbeats.set(event.sender.id, now);
    if (!rendererLoadedAt.has(event.sender.id)) rendererLoadedAt.set(event.sender.id, now);
    clearNativeUnresponsiveTimer(event.sender.id);
    return { ok: true };
  });

  rendererWatchdog = setInterval(() => {
    const now = Date.now();
    for (const window of electron.BrowserWindow.getAllWindows()) {
      try {
        if (!isMainInterfaceWindow(window) || !window.isVisible()) continue;
        const webContentsId = window.webContents.id;
        if (!rendererHeartbeats.has(webContentsId)) continue;
        const loadedAt = rendererLoadedAt.get(webContentsId) || now;
        if (now - loadedAt < RENDERER_STARTUP_GRACE_MS) continue;
        const last = rendererHeartbeats.get(webContentsId) || loadedAt;
        if (now - last > RENDERER_HEARTBEAT_TIMEOUT_MS) {
          offerRendererRecovery(window, 'The renderer heartbeat stopped for more than 30 seconds', webContentsId).catch((error) => {
            console.error('[Khaos Nexus] Heartbeat recovery failed.', error);
          });
        }
      } catch (error) {
        console.error('[Khaos Nexus] Renderer watchdog skipped a closing window.', error);
      }
    }
  }, 5000);
  rendererWatchdog.unref?.();
}

function installNativeMenu() {
  const { app, BrowserWindow, Menu, shell } = electron;
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Restart Interface', accelerator: 'CmdOrCtrl+R', click: restartApplication },
        { label: 'Restart Khaos Nexus', click: restartApplication },
        { type: 'separator' },
        { label: 'Open Local Data Folder', click: () => shell.openPath(app.getPath('userData')).catch((error) => console.error('[Khaos Nexus] Could not open local data folder.', error)) },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'View',
      submenu: [
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  for (const window of BrowserWindow.getAllWindows()) attachWindowRecovery(window);
}

function install() {
  if (installed) return;
  installed = true;

  configureGraphicsMode();
  patchBotSupervisor();
  patchRendererErrorCapture();
  patchBrowserLoader();
  electron.app.whenReady().then(() => {
    installRendererHeartbeat();
    installNativeMenu();
  }).catch((error) => console.error('[Khaos Nexus] Stability initialization failed.', error));
  electron.app.on('before-quit', () => {
    electron.app.isQuitting = true;
    if (rendererWatchdog) clearInterval(rendererWatchdog);
    for (const id of nativeUnresponsiveTimers.keys()) clearNativeUnresponsiveTimer(id);
  });
}

module.exports = {
  install,
  usableWindow,
  preloadName,
  isMainInterfaceWindow,
  offerRendererRecovery,
  softwareRenderingRequested,
  configureGraphicsMode,
  RENDERER_HEARTBEAT_TIMEOUT_MS,
  RENDERER_STARTUP_GRACE_MS,
  NATIVE_UNRESPONSIVE_CONFIRM_MS
};
