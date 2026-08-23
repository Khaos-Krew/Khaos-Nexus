'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron');
const { createBackendApplication } = require('./backend/application.cjs');
const { BackendClient } = require('./sentinel/backend-client.cjs');
const { thoraStatus, launchThora } = require('./thora/bridge.cjs');
const {
  applyPublicSettings,
  collectSecretEnvNames,
  configWarnings,
  ensureUserConfig,
  publicSettings,
  readJson,
  runtimeConfig,
  saveUserConfig
} = require('./desktop/config-store.cjs');
const { SecretVault } = require('./desktop/secret-vault.cjs');

let userDataPath = '';
let templatePath = '';
let configPath = '';
let storedConfig = null;
let activeConfig = null;
let vault = null;
let backendApp = null;
let backendClient = null;
let backendMode = 'starting';
let backendError = '';

function loadStoredConfig() {
  const value = readJson(configPath);
  value.__source = configPath;
  return value;
}

function applyStoredSecrets() {
  const names = collectSecretEnvNames(storedConfig);
  return vault.apply(names);
}

async function stopEmbeddedBackend() {
  if (!backendApp) return;
  try { await backendApp.stop(); }
  catch (error) { console.warn('[Khaos Nexus] backend stop:', error.message); }
  backendApp = null;
}

async function startBackend() {
  await stopEmbeddedBackend();
  applyStoredSecrets();
  activeConfig = runtimeConfig(storedConfig, userDataPath, configPath);
  backendClient = new BackendClient(activeConfig);
  backendError = '';
  backendMode = 'starting';

  try {
    backendApp = createBackendApplication(activeConfig);
    await backendApp.start();
    backendMode = 'embedded';
  } catch (error) {
    backendApp = null;
    if (error?.code === 'EADDRINUSE') {
      const health = await backendClient.health().catch(() => null);
      if (health?.ok) {
        backendMode = 'existing-local';
        backendError = 'Another Nexus Backend is already using the configured port; the desktop is connected to it.';
        return;
      }
    }
    backendMode = 'error';
    backendError = String(error?.message || error);
    console.error('[Khaos Nexus] local backend failed:', error);
  }
}

async function currentState() {
  const backend = backendClient
    ? await backendClient.health().catch((error) => ({ ok: false, message: error.message }))
    : { ok: false, message: backendError || 'Backend is not initialized.' };
  const modules = backendClient && backend?.ok
    ? await backendClient.modules().catch((error) => ({ ok: false, message: error.message, modules: [] }))
    : { ok: false, modules: [] };
  const secretNames = collectSecretEnvNames(storedConfig);
  return {
    version: app.getVersion(),
    packaged: app.isPackaged,
    configSource: configPath,
    dataPath: userDataPath,
    backendMode,
    backendError,
    backend,
    modules,
    settings: publicSettings(storedConfig),
    secrets: vault.statuses(secretNames),
    secretEncryptionAvailable: vault.encryptionAvailable(),
    warnings: configWarnings(storedConfig),
    thora: thoraStatus(activeConfig || storedConfig)
  };
}

async function diagnostics() {
  const state = await currentState();
  return {
    generatedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    packaged: app.isPackaged,
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: process.platform,
    release: require('node:os').release(),
    arch: process.arch,
    backendMode: state.backendMode,
    backendError: state.backendError,
    backend: state.backend,
    modules: (state.modules?.modules || []).map((module) => ({
      id: module.id,
      name: module.name,
      enabled: module.enabled,
      configured: module.configured,
      connected: module.connected,
      providerKind: module.providerKind,
      availableActions: module.availableActions || []
    })),
    warnings: state.warnings,
    secretEncryptionAvailable: state.secretEncryptionAvailable,
    secrets: state.secrets,
    paths: { config: configPath, userData: userDataPath }
  };
}

function registerIpc() {
  ipcMain.handle('nexus:state', () => currentState());
  ipcMain.handle('nexus:diagnostics', () => diagnostics());
  ipcMain.handle('nexus:restart-backend', async () => {
    await startBackend();
    return currentState();
  });
  ipcMain.handle('nexus:save-settings', async (_event, settings) => {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Settings payload is invalid.');
    storedConfig = applyPublicSettings(storedConfig, settings);
    saveUserConfig(configPath, storedConfig);
    storedConfig = loadStoredConfig();
    await startBackend();
    return currentState();
  });
  ipcMain.handle('nexus:set-secret', async (_event, name, value) => {
    const allowed = new Set(collectSecretEnvNames(storedConfig));
    if (!allowed.has(String(name || '').toUpperCase())) throw new Error('That secret key is not used by the current Nexus configuration.');
    vault.set(name, value);
    await startBackend();
    return currentState();
  });
  ipcMain.handle('nexus:clear-secret', async (_event, name) => {
    const allowed = new Set(collectSecretEnvNames(storedConfig));
    if (!allowed.has(String(name || '').toUpperCase())) throw new Error('That secret key is not used by the current Nexus configuration.');
    vault.remove(name);
    await startBackend();
    return currentState();
  });
  ipcMain.handle('nexus:open-data-folder', () => shell.openPath(userDataPath));
  ipcMain.handle('nexus:export-diagnostics', async () => {
    const result = await dialog.showSaveDialog({
      title: 'Export Khaos Nexus diagnostics',
      defaultPath: path.join(app.getPath('documents'), `Khaos-Nexus-Diagnostics-${new Date().toISOString().slice(0, 10)}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { saved: false };
    fs.writeFileSync(result.filePath, `${JSON.stringify(await diagnostics(), null, 2)}\n`, 'utf8');
    return { saved: true, filePath: result.filePath };
  });
  ipcMain.handle('nexus:choose-thora', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose Thora executable',
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'Applications', extensions: ['exe'] }] : []
    });
    if (result.canceled || !result.filePaths?.[0]) return currentState();
    storedConfig.thora ||= {};
    storedConfig.thora.executablePath = result.filePaths[0];
    saveUserConfig(configPath, storedConfig);
    storedConfig = loadStoredConfig();
    activeConfig = runtimeConfig(storedConfig, userDataPath, configPath);
    return currentState();
  });
  ipcMain.handle('nexus:thora-launch', () => launchThora(activeConfig || storedConfig));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1050,
    minHeight: 700,
    backgroundColor: '#09090b',
    title: 'Khaos Nexus',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer/index.html'));
}

async function bootstrap() {
  userDataPath = app.getPath('userData');
  templatePath = path.join(__dirname, '..', 'config.example.json');
  configPath = ensureUserConfig(userDataPath, templatePath);
  storedConfig = loadStoredConfig();
  vault = new SecretVault({ userDataPath, safeStorage });
  registerIpc();
  await startBackend();
  createWindow();
}

app.whenReady().then(bootstrap).catch((error) => {
  console.error('[Khaos Nexus] startup failed:', error);
  dialog.showErrorBox('Khaos Nexus startup failed', String(error?.message || error));
  app.quit();
});
app.on('before-quit', () => backendApp?.scheduler?.stop?.());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
