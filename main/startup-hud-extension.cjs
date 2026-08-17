'use strict';

const os = require('node:os');
const electron = require('electron');

let installed = false;
let ipcInstalled = false;

function fitStartupWindow(window) {
  if (!window || window.isDestroyed() || !window.__khaosStartupSplashWindow) return false;
  if (!electron.screen) return false;

  const display = electron.screen.getDisplayMatching(window.getBounds());
  const workArea = display?.workArea || electron.screen.getPrimaryDisplay().workArea;
  const margin = 24;
  const maxWidth = Math.max(920, Math.min(1440, workArea.width - (margin * 2)));
  const maxHeight = Math.max(600, Math.min(840, workArea.height - (margin * 2)));
  const targetAspect = 5 / 3;

  let width = maxWidth;
  let height = Math.round(width / targetAspect);
  if (height > maxHeight) {
    height = maxHeight;
    width = Math.round(height * targetAspect);
  }

  width = Math.min(width, workArea.width - (margin * 2));
  height = Math.min(height, workArea.height - (margin * 2));

  const x = Math.round(workArea.x + ((workArea.width - width) / 2));
  const y = Math.round(workArea.y + ((workArea.height - height) / 2));

  try {
    window.setBounds({ x, y, width, height }, false);
    window.setMinimumSize(Math.min(920, width), Math.min(600, height));
    window.setMenuBarVisibility(false);
    window.setResizable(false);
    return true;
  } catch {
    return false;
  }
}

function inspectWindow(window) {
  setImmediate(() => fitStartupWindow(window));
}

function registerIpc() {
  if (ipcInstalled) return;
  ipcInstalled = true;
  electron.ipcMain.handle('startup-hud:meta', () => ({
    appVersion: electron.app.getVersion(),
    platform: process.platform,
    architecture: process.arch,
    electronVersion: process.versions.electron,
    cpuThreads: os.cpus()?.length || 0,
    hostname: os.hostname(),
    secureStorageAvailable: electron.safeStorage.isEncryptionAvailable()
  }));
}

function install() {
  if (installed) return;
  installed = true;
  registerIpc();

  electron.app.on('browser-window-created', (_event, window) => inspectWindow(window));
  electron.app.whenReady().then(() => {
    for (const window of electron.BrowserWindow.getAllWindows()) inspectWindow(window);
  }).catch(() => {});
}

module.exports = {
  fitStartupWindow,
  install
};
