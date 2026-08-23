'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron');
const { createBackendApplication } = require('./backend/application.cjs');
const { BackendClient } = require('./sentinel/backend-client.cjs');
const { providerSecretNames } = require('./shared/provider-sync.cjs');
const { thoraStatus, launchThora } = require('./thora/bridge.cjs');
const { StagedUpdater } = require('./updater/service.cjs');
const { SentinalAdminClient } = require('./desktop/sentinal-admin-client.cjs');
const { pairRequest } = require('./desktop/sentinal-pairing.cjs');
const { OwnerTestService } = require('./desktop/owner-test-service.cjs');
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
const { available: discordOAuthAvailable, linkDiscordWithOAuth } = require('./desktop/discord-account-link.cjs');
const { SecretVault } = require('./desktop/secret-vault.cjs');

let userDataPath = '';
let templatePath = '';
let configPath = '';
let storedConfig = null;
let activeConfig = null;
let vault = null;
let backendApp = null;
let backendClient = null;
let sentinalAdmin = null;
let ownerTest = null;
let updater = null;
let backendMode = 'starting';
let backendError = '';
let updateAutoCheckStarted = false;

function loadStoredConfig() {
  const value = readJson(configPath);
  value.__source = configPath;
  return value;
}

function applyStoredSecrets() {
  const names = collectSecretEnvNames(storedConfig);
  return vault.apply(names);
}

function configureUpdater() {
  if (!updater) return;
  updater.configure({
    enabled: storedConfig.updates?.enabled !== false,
    channel: storedConfig.updates?.channel || 'owner-test',
    autoDownload: storedConfig.updates?.autoDownload !== false
  });
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
  sentinalAdmin = new SentinalAdminClient(activeConfig);
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
  const backendPromise = backendClient
    ? backendClient.health().catch((error) => ({ ok: false, message: error.message }))
    : Promise.resolve({ ok: false, message: backendError || 'Backend is not initialized.' });
  const sentinalPromise = sentinalAdmin?.configured()
    ? sentinalAdmin.health()
    : Promise.resolve({ ok: false, code: 'SENTINAL_ADMIN_NOT_CONFIGURED', message: 'Nexus Sentinal admin URL is not configured.' });
  const [backend, sentinal] = await Promise.all([backendPromise, sentinalPromise]);
  const modules = backendClient && backend?.ok
    ? await backendClient.modules().catch((error) => ({ ok: false, message: error.message, modules: [] }))
    : { ok: false, modules: [] };
  const accounts = backendClient && backend?.ok
    ? await backendClient.accounts().catch((error) => ({ ok: false, message: error.message, accounts: [] }))
    : { ok: false, accounts: [] };
  const secretNames = collectSecretEnvNames(storedConfig);
  return {
    version: app.getVersion(),
    packaged: app.isPackaged,
    configSource: configPath,
    dataPath: userDataPath,
    backendMode,
    backendError,
    backend,
    sentinal,
    modules,
    accounts,
    discordOAuthReady: discordOAuthAvailable(activeConfig || storedConfig),
    settings: publicSettings(storedConfig),
    secrets: vault.statuses(secretNames),
    secretEncryptionAvailable: vault.encryptionAvailable(),
    warnings: configWarnings(storedConfig),
    thora: thoraStatus(activeConfig || storedConfig),
    updater: updater?.status?.() || null
  };
}

async function startupHealth() {
  const state = await currentState();
  const modules = state.modules?.modules || [];
  const enabledModules = modules.filter((module) => module.enabled !== false);
  const configuredModules = enabledModules.filter((module) => module.configured).length;
  const thoraEnabled = state.settings?.thora?.enabled === true;
  const sentinalConfigured = sentinalAdmin?.configured?.() === true;
  const items = [
    { id: 'backend', label: 'Local Backend', state: state.backend?.ok ? 'ready' : 'failed', detail: state.backend?.ok ? state.backendMode : state.backendError || state.backend?.message || 'Offline' },
    { id: 'accounts', label: 'Accounts & Access', state: state.accounts?.ok ? 'ready' : state.backend?.ok ? 'warning' : 'waiting', detail: state.accounts?.ok ? `${(state.accounts.accounts || []).length} linked` : 'Waiting for backend' },
    { id: 'sentinal', label: 'Nexus Sentinal', state: !sentinalConfigured ? 'skipped' : state.sentinal?.discordReady || state.sentinal?.sentinal?.discordReady ? 'ready' : state.sentinal?.ok ? 'warning' : 'warning', detail: !sentinalConfigured ? 'Admin endpoint not configured' : state.sentinal?.sentinal?.guild?.name || state.sentinal?.message || 'Checking Discord service' },
    { id: 'updater', label: 'Updater', state: state.updater ? 'ready' : 'warning', detail: state.updater ? `${state.updater.channel || 'owner-test'} • ${state.updater.phase || 'idle'}` : 'Unavailable' },
    { id: 'thora', label: 'Thora', state: !thoraEnabled ? 'skipped' : state.thora?.executableExists ? 'ready' : 'warning', detail: !thoraEnabled ? 'Private integration disabled' : state.thora?.executableExists ? 'Private runtime available' : 'Runtime not found' },
    { id: 'modules', label: 'Game Providers', state: enabledModules.length === 0 ? 'skipped' : configuredModules === enabledModules.length ? 'ready' : 'warning', detail: `${configuredModules}/${enabledModules.length} configured` }
  ];
  return { ok: Boolean(state.backend?.ok), ready: Boolean(state.backend?.ok), items };
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
    sentinal: state.sentinal,
    updater: state.updater,
    accounts: (state.accounts?.accounts || []).map((account) => ({
      id: account.id,
      role: account.role,
      displayName: account.displayName,
      discordUserId: account.discord?.id || ''
    })),
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

function rememberLinkedOwner(account) {
  const discordId = String(account?.discord?.id || '');
  if (!discordId || !['owner', 'co-owner'].includes(account?.role)) return;
  storedConfig.discord ||= {};
  storedConfig.discord.ownerUserIds ||= [];
  if (!storedConfig.discord.ownerUserIds.includes(discordId)) {
    storedConfig.discord.ownerUserIds.push(discordId);
    saveUserConfig(configPath, storedConfig);
    storedConfig = loadStoredConfig();
    activeConfig = runtimeConfig(storedConfig, userDataPath, configPath);
  }
}

function requireSentinalAdmin() {
  if (!sentinalAdmin) throw new Error('Nexus Sentinal admin client is unavailable.');
  return sentinalAdmin;
}

function requireOwnerTest() {
  if (!ownerTest) throw new Error('Owner Test Center is unavailable.');
  return ownerTest;
}

function protectedProviderSecrets() {
  const secrets = {};
  for (const name of providerSecretNames(storedConfig || {})) {
    const value = String(process.env[name] || vault?.decrypt?.(name) || '');
    if (value) secrets[name] = value;
  }
  return secrets;
}

async function syncHostedProviders() {
  const admin = requireSentinalAdmin();
  const remote = await admin.providerConfig();
  if (remote?.ok === false) throw new Error(remote.message || remote.code || 'Hosted provider configuration is unavailable.');
  const secrets = protectedProviderSecrets();
  const approved = new Set(providerSecretNames(storedConfig || {}));
  const configuredRemote = (remote.configuredSecrets || []).map((item) => String(item?.name || '').toUpperCase()).filter((name) => approved.has(name));
  const clearSecrets = configuredRemote.filter((name) => !secrets[name]);
  const result = await admin.configureProviders(storedConfig.modules || {}, secrets, clearSecrets);
  if (result?.ok === false) throw new Error(result.message || result.code || 'Hosted provider synchronization failed.');
  return result;
}

function registerIpc() {
  ipcMain.handle('nexus:state', () => currentState());
  ipcMain.handle('nexus:startup-health', () => startupHealth());
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
    configureUpdater();
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
  ipcMain.handle('nexus:create-account-link-code', async (_event, role) => {
    if (!backendClient) throw new Error('Nexus Backend is unavailable.');
    const result = await backendClient.createPairingCode(role || 'co-owner');
    if (!result.ok) throw new Error(result.message || 'Could not create account link code.');
    return result.pairing;
  });
  ipcMain.handle('nexus:link-discord-oauth', async (_event, role) => {
    if (!backendClient) throw new Error('Nexus Backend is unavailable.');
    applyStoredSecrets();
    activeConfig = runtimeConfig(storedConfig, userDataPath, configPath);
    const result = await linkDiscordWithOAuth({
      config: activeConfig,
      backendClient,
      role: role || 'co-owner',
      openExternal: (url) => shell.openExternal(url)
    });
    rememberLinkedOwner(result.account);
    return currentState();
  });
  ipcMain.handle('nexus:remove-account', async (_event, accountId) => {
    if (!backendClient) throw new Error('Nexus Backend is unavailable.');
    const result = await backendClient.removeAccount(accountId);
    if (!result.ok) throw new Error(result.message || 'Could not remove Nexus account.');
    return currentState();
  });
  ipcMain.handle('nexus:validate-providers', async (_event, moduleId) => {
    if (!backendClient) throw new Error('Nexus Backend is unavailable.');
    return backendClient.validateProviders(String(moduleId || ''));
  });

  ipcMain.handle('nexus:sentinal-pair', async (_event, url, code) => {
    const paired = await pairRequest(String(url || ''), String(code || ''));
    const tokenEnv = String(storedConfig.discord?.sentinalAdminTokenEnv || 'NEXUS_SENTINAL_ADMIN_TOKEN').toUpperCase();
    const allowed = new Set(collectSecretEnvNames(storedConfig));
    if (!allowed.has(tokenEnv)) throw new Error('The Sentinal admin credential slot is not available in this Nexus configuration.');
    vault.set(tokenEnv, paired.token);
    storedConfig.discord ||= {};
    storedConfig.discord.sentinalAdminUrl = paired.baseUrl;
    saveUserConfig(configPath, storedConfig);
    storedConfig = loadStoredConfig();
    await startBackend();
    return currentState();
  });
  ipcMain.handle('nexus:sentinal-status', () => requireSentinalAdmin().status());
  ipcMain.handle('nexus:sentinal-permissions', () => requireSentinalAdmin().permissions());
  ipcMain.handle('nexus:sentinal-commands', () => requireSentinalAdmin().commands());
  ipcMain.handle('nexus:sentinal-channels', (_event, moduleId) => requireSentinalAdmin().channels(String(moduleId || '')));
  ipcMain.handle('nexus:sentinal-roles', () => requireSentinalAdmin().roles());
  ipcMain.handle('nexus:sentinal-scan', () => requireSentinalAdmin().scan());
  ipcMain.handle('nexus:sentinal-sync-commands', () => requireSentinalAdmin().syncCommands());
  ipcMain.handle('nexus:sentinal-reconcile-channels', (_event, moduleId) => requireSentinalAdmin().reconcileChannels(String(moduleId || '')));
  ipcMain.handle('nexus:sentinal-refresh-consoles', (_event, moduleId) => requireSentinalAdmin().refreshConsoles(String(moduleId || '')));
  ipcMain.handle('nexus:sentinal-reconcile-roles', () => requireSentinalAdmin().reconcileRoles());
  ipcMain.handle('nexus:sentinal-provider-config', () => requireSentinalAdmin().providerConfig());
  ipcMain.handle('nexus:sentinal-sync-providers', () => syncHostedProviders());
  ipcMain.handle('nexus:sentinal-validate-provider', (_event, moduleId) => requireSentinalAdmin().validateHostedProvider(String(moduleId || '')));
  ipcMain.handle('nexus:sentinal-repair', () => requireSentinalAdmin().repair());

  ipcMain.handle('nexus:owner-test', () => requireOwnerTest().snapshot());
  ipcMain.handle('nexus:owner-test-feedback', (_event, version, itemId, status, note) => requireOwnerTest().setFeedback(version, itemId, status, note));

  ipcMain.handle('nexus:update-status', () => updater?.status() || { phase: 'idle', enabled: false, currentVersion: app.getVersion() });
  ipcMain.handle('nexus:update-check', () => {
    if (!updater) throw new Error('Nexus updater is unavailable.');
    return updater.check();
  });
  ipcMain.handle('nexus:update-prepare', () => {
    if (!updater) throw new Error('Nexus updater is unavailable.');
    return updater.prepare();
  });
  ipcMain.handle('nexus:update-restart', () => {
    if (!updater) throw new Error('Nexus updater is unavailable.');
    const result = updater.beginApply({ pid: process.pid });
    setTimeout(() => app.quit(), 450);
    return result;
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

function startAutomaticUpdateCheck() {
  if (updateAutoCheckStarted || !updater || !app.isPackaged) return;
  updateAutoCheckStarted = true;
  setTimeout(() => {
    updater.autoCheck().catch((error) => console.warn('[Khaos Nexus] update check:', error.message));
  }, 2500);
}

async function confirmHealthyPostUpdate() {
  if (!updater || !process.argv.includes('--nexus-post-update')) return false;
  if (backendMode === 'error' || !backendClient) {
    console.error('[Khaos Nexus] refusing post-update startup confirmation because the local backend did not start.');
    return false;
  }
  const health = await backendClient.health().catch((error) => ({ ok: false, message: error.message }));
  if (!health?.ok) {
    console.error('[Khaos Nexus] refusing post-update startup confirmation because backend health failed:', health?.message || 'unknown error');
    return false;
  }
  try {
    return updater.confirmPostUpdateFromArgs(process.argv);
  } catch (error) {
    console.warn('[Khaos Nexus] update startup confirmation:', error.message);
    return false;
  }
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
  win.webContents.once('did-finish-load', async () => {
    await confirmHealthyPostUpdate();
    startAutomaticUpdateCheck();
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer/index.html'));
  return win;
}

async function bootstrap() {
  userDataPath = app.getPath('userData');
  templatePath = path.join(__dirname, '..', 'config.example.json');
  configPath = ensureUserConfig(userDataPath, templatePath);
  storedConfig = loadStoredConfig();
  vault = new SecretVault({ userDataPath, safeStorage });
  updater = new StagedUpdater({
    currentVersion: app.getVersion(),
    userDataPath,
    installDir: path.dirname(process.execPath),
    executableName: path.basename(process.execPath),
    resourcesPath: process.resourcesPath,
    enabled: storedConfig.updates?.enabled !== false,
    channel: storedConfig.updates?.channel || 'owner-test',
    autoDownload: storedConfig.updates?.autoDownload !== false,
    isPackaged: app.isPackaged
  });
  ownerTest = new OwnerTestService({ currentVersion: app.getVersion(), userDataPath });
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