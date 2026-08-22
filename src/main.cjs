'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { loadConfig } = require('./shared/config.cjs');
const { BackendClient } = require('./sentinel/backend-client.cjs');
const { thoraStatus, launchThora } = require('./thora/bridge.cjs');

const config = loadConfig();
const backend = new BackendClient(config);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0b0b0d',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer/index.html'));
}

ipcMain.handle('nexus:state', async () => ({
  version: app.getVersion(),
  configSource: config.__source,
  backend: await backend.health().catch((error) => ({ ok: false, message: error.message })),
  modules: await backend.modules().catch(() => ({ modules: [] })),
  thora: thoraStatus(config)
}));
ipcMain.handle('nexus:thora-launch', () => launchThora(config));
ipcMain.handle('nexus:diagnostics', async () => ({
  appVersion: app.getVersion(), electron: process.versions.electron, node: process.versions.node, platform: process.platform, arch: process.arch,
  backend: await backend.health().catch((error) => ({ ok: false, message: error.message }))
}));

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
