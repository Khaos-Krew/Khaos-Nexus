'use strict';

const electron = require('electron');
const {
  BOT_STARTUP_TIMEOUT_MS,
  isStartupStatus,
  startupTimeoutMessage
} = require('../shared/startup-guard.cjs');

const RENDERER_HEARTBEAT_TIMEOUT_MS = 15000;
const RENDERER_RECOVERY_COOLDOWN_MS = 60000;
const rendererHeartbeats = new Map();
let rendererWatchdog = null;
let recoveryPromptOpen = false;
let installed = false;

function restartApplication() {
  electron.app.relaunch();
  electron.app.exit(0);
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

async function offerRendererRecovery(window, reason) {
  if (!window || window.isDestroyed() || recoveryPromptOpen) return false;
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
  } finally {
    recoveryPromptOpen = false;
    rendererHeartbeats.set(window.webContents.id, Date.now());
  }
}

function attachWindowRecovery(window) {
  if (!window || window.__khaosRendererRecoveryAttached) return;
  window.__khaosRendererRecoveryAttached = true;
  rendererHeartbeats.set(window.webContents.id, Date.now());

  window.on('unresponsive', () => offerRendererRecovery(window, 'Electron reported an unresponsive renderer'));
  window.webContents.on('did-finish-load', () => rendererHeartbeats.set(window.webContents.id, Date.now()));
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Khaos Nexus] Renderer process exited.', details);
    if (!electron.app.isQuitting) setTimeout(() => offerRendererRecovery(window, `The renderer process exited (${details.reason || 'unknown'})`), 500);
  });
  window.webContents.on('destroyed', () => rendererHeartbeats.delete(window.webContents.id));
}

function patchBrowserLoader() {
  const prototype = electron.BrowserWindow?.prototype;
  if (!prototype || prototype.__khaosStabilityUiPatched) return;
  const original = prototype.loadFile;

  prototype.loadFile = function patchedLoadFile(...args) {
    attachWindowRecovery(this);
    this.webContents.once('did-finish-load', () => {
      this.webContents.executeJavaScript(`(() => {
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
      })();`).catch(() => {});
    });
    return original.apply(this, args);
  };

  Object.defineProperty(prototype, '__khaosStabilityUiPatched', { value: true });
}

function installRendererHeartbeat() {
  if (installRendererHeartbeat.done) return;
  installRendererHeartbeat.done = true;
  electron.ipcMain.handle('stability:heartbeat', (event) => {
    rendererHeartbeats.set(event.sender.id, Date.now());
    return { ok: true };
  });

  rendererWatchdog = setInterval(() => {
    const now = Date.now();
    for (const window of electron.BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || !window.isVisible()) continue;
      const last = rendererHeartbeats.get(window.webContents.id) || now;
      if (now - last > RENDERER_HEARTBEAT_TIMEOUT_MS) offerRendererRecovery(window, 'The renderer heartbeat stopped');
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
        { label: 'Open Local Data Folder', click: () => shell.openPath(app.getPath('userData')) },
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

  // This is a 2D operator dashboard. Software rendering avoids Chromium compositor
  // freezes observed on mixed-DPI, multi-monitor Windows systems.
  electron.app.disableHardwareAcceleration();
  electron.app.commandLine.appendSwitch('disable-gpu-compositing');
  electron.app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

  patchBotSupervisor();
  patchRendererErrorCapture();
  patchBrowserLoader();
  electron.app.whenReady().then(() => {
    installRendererHeartbeat();
    installNativeMenu();
  });
  electron.app.on('before-quit', () => {
    electron.app.isQuitting = true;
    if (rendererWatchdog) clearInterval(rendererWatchdog);
  });
}

module.exports = { install };
