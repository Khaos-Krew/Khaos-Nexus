'use strict';

const path = require('node:path');
const fs = require('node:fs');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  dialog,
  shell,
  clipboard
} = require('electron');
const { ConfigStore } = require('./services/config-store.cjs');
const { AppLogger } = require('./services/logger.cjs');
const { BotSupervisor } = require('./services/bot-supervisor.cjs');
const { createDiagnosticReport, reportAsMarkdown } = require('./services/diagnostics.cjs');
const { UpdateService } = require('./services/update-service.cjs');
const { SourceRcon } = require('../bot/rcon.cjs');
const { errorFingerprint } = require('../shared/redaction.cjs');

let windowRef = null;
let tray = null;
let quitting = false;
let configStore;
let logger;
let supervisor;
let updateService;

function iconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar', 'assets', 'icon.png')
    : path.join(__dirname, '..', 'assets', 'icon.png');
}

function send(channel, payload) {
  if (windowRef && !windowRef.isDestroyed()) windowRef.webContents.send(channel, payload);
}

function fullState() {
  return {
    app: {
      version: app.getVersion(),
      userDataPath: app.getPath('userData'),
      secureStorageAvailable: require('electron').safeStorage.isEncryptionAvailable()
    },
    config: configStore.getPublicConfig(),
    bot: supervisor.getState(),
    update: updateService.getState()
  };
}

function showWindow() {
  if (!windowRef || windowRef.isDestroyed()) createWindow();
  else { windowRef.show(); windowRef.focus(); }
}

function createWindow() {
  windowRef = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 980,
    minHeight: 650,
    backgroundColor: '#08090d',
    icon: iconPath(),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  windowRef.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  windowRef.once('ready-to-show', () => windowRef.show());
  windowRef.on('close', (event) => {
    if (!quitting && configStore.getConfig().general.minimizeToTray) {
      event.preventDefault();
      windowRef.hide();
    } else if (!quitting) {
      quitting = true;
    }
  });
  windowRef.on('closed', () => { windowRef = null; });
}

function createTray() {
  const image = nativeImage.createFromPath(iconPath()).resize({ width: 20, height: 20 });
  tray = new Tray(image);
  tray.setToolTip('Khaos Nexus Bot Manager');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Manager', click: () => showWindow() },
    { type: 'separator' },
    { label: 'Start Bot', click: () => { try { supervisor.start(); } catch {} } },
    { label: 'Restart Bot', click: () => supervisor.restart() },
    { label: 'Stop Bot', click: () => supervisor.stop() },
    { type: 'separator' },
    { label: 'Exit', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('double-click', () => showWindow());
}

function applyLoginSetting(enabled) {
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled), path: process.execPath });
}

function createReport() {
  return createDiagnosticReport({
    appVersion: app.getVersion(),
    config: configStore.exportSafeConfig(),
    supervisorState: supervisor.getState(),
    logs: logger.recent(100),
    secretValues: configStore.getSecretValues()
  });
}

function registerIpc() {
  ipcMain.handle('app:get-state', () => fullState());
  ipcMain.handle('bot:start', () => supervisor.start());
  ipcMain.handle('bot:stop', () => supervisor.stop());
  ipcMain.handle('bot:restart', () => supervisor.restart());

  ipcMain.handle('config:save-discord', (_event, payload) => {
    configStore.setDiscord(payload);
    send('state:update', fullState());
    return configStore.getPublicConfig();
  });

  ipcMain.handle('secret:set-discord-token', (_event, token) => {
    configStore.setDiscordToken(token);
    logger.info(token ? 'Discord token saved in protected storage.' : 'Discord token removed.');
    send('state:update', fullState());
    return { hasDiscordToken: Boolean(token) };
  });

  ipcMain.handle('config:save-general', (_event, payload) => {
    configStore.setGeneral(payload);
    applyLoginSetting(configStore.getConfig().general.startWithWindows);
    send('state:update', fullState());
    return configStore.getPublicConfig();
  });

  ipcMain.handle('server:save', (_event, payload) => {
    const id = configStore.upsertServer(payload.server, payload.password);
    logger.info('Game server configuration saved.', { id, name: payload.server.name, game: payload.server.game });
    send('state:update', fullState());
    return { id, config: configStore.getPublicConfig() };
  });

  ipcMain.handle('server:remove', (_event, id) => {
    configStore.removeServer(id);
    logger.warn('Game server configuration removed.', { id });
    send('state:update', fullState());
    return configStore.getPublicConfig();
  });

  ipcMain.handle('server:test', async (_event, id) => {
    const runtime = configStore.getRuntimeBootstrap();
    const server = runtime.config.servers.find((item) => item.id === id);
    if (!server) throw new Error('Server configuration was not found.');
    if (!server.password) throw new Error('Save the RCON password before testing.');
    const command = server.game === 'palworld' ? 'Info' : server.game === 'ark' ? 'ListPlayers' : (server.statusCommand || 'status');
    const result = await new SourceRcon(server).execute(command);
    logger.info('RCON connection test succeeded.', { id, name: server.name });
    return { result: result || 'Connected successfully.' };
  });

  ipcMain.handle('logs:get', (_event, limit) => logger.recent(limit || 500));
  ipcMain.handle('logs:clear', () => { logger.clear(); return true; });

  ipcMain.handle('diagnostics:export', async () => {
    const report = createReport();
    const defaultPath = path.join(app.getPath('documents'), `khaos-nexus-diagnostics-${Date.now()}.json`);
    const result = await dialog.showSaveDialog(windowRef, {
      title: 'Export redacted diagnostics',
      defaultPath,
      filters: [{ name: 'JSON diagnostics', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, JSON.stringify(report, null, 2), 'utf8');
    logger.info('Redacted diagnostics exported.', { filePath: result.filePath });
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle('backup:export', async () => {
    const defaultPath = path.join(app.getPath('documents'), `khaos-nexus-backup-${new Date().toISOString().slice(0, 10)}.knbackup`);
    const result = await dialog.showSaveDialog(windowRef, {
      title: 'Export Khaos Nexus backup',
      defaultPath,
      filters: [{ name: 'Khaos Nexus backup', extensions: ['knbackup'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const payload = configStore.createBackupPayload(app.getVersion());
    fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
    logger.info('Configuration backup exported.', { filePath: result.filePath });
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle('backup:import', async () => {
    const result = await dialog.showOpenDialog(windowRef, {
      title: 'Restore Khaos Nexus backup',
      properties: ['openFile'],
      filters: [{ name: 'Khaos Nexus backup', extensions: ['knbackup'] }]
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const payload = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
    const restored = configStore.restoreBackupPayload(payload);
    applyLoginSetting(restored.general.startWithWindows);
    logger.warn('Configuration backup restored. Restart the bot to apply restored settings.', { filePath: result.filePaths[0] });
    send('state:update', fullState());
    return { canceled: false, config: restored };
  });

  ipcMain.handle('diagnostics:report', async () => {
    const report = createReport();
    const markdown = reportAsMarkdown(report);
    clipboard.writeText(markdown);
    const errorId = report.runtime.lastError?.id || 'manual-report';
    const repo = configStore.getConfig().monitor.reportRepository;
    const title = `[Error ${errorId}] ${report.runtime.lastError?.message || 'Bot Manager problem'}`.slice(0, 180);
    const url = `https://github.com/${repo}/issues/new?labels=bug,automated-report&title=${encodeURIComponent(title)}&body=${encodeURIComponent(markdown)}`;
    await shell.openExternal(url);
    logger.info('Opened a prefilled GitHub error report and copied the redacted report to the clipboard.', { errorId });
    return { errorId, copied: true };
  });

  ipcMain.handle('app:open-data-folder', () => shell.openPath(app.getPath('userData')));
  ipcMain.handle('update:check', () => updateService.check());
  ipcMain.handle('update:download', () => updateService.download());
  ipcMain.handle('update:install', () => { updateService.install(); return true; });
}

app.whenReady().then(() => {
  const userData = app.getPath('userData');
  configStore = new ConfigStore(userData);
  logger = new AppLogger(path.join(userData, 'logs'), () => configStore.getSecretValues());
  supervisor = new BotSupervisor({ configStore, logger });
  updateService = new UpdateService(logger);
  app.setAppUserModelId('com.khaosnexus.botmanager');

  logger.on('entry', (entry) => send('log:entry', entry));
  logger.on('cleared', () => send('log:entry', { cleared: true }));
  supervisor.on('state', () => send('state:update', fullState()));
  updateService.on('state', (state) => send('update:state', state));

  registerIpc();
  createWindow();
  createTray();
  applyLoginSetting(configStore.getConfig().general.startWithWindows);
  logger.info('Khaos Nexus Bot Manager started.', { version: app.getVersion() });

  const config = configStore.getConfig();
  if (config.general.autoStartBot && configStore.getPublicConfig().hasDiscordToken) {
    setTimeout(() => {
      try { supervisor.start(); } catch (error) { logger.error(error.message); }
    }, 1200);
  }
  if (config.general.checkUpdates) setTimeout(() => updateService.check().catch(() => {}), 5000);
});

app.on('activate', () => showWindow());

app.on('before-quit', () => {
  quitting = true;
  supervisor?.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && quitting) app.quit();
});

process.on('uncaughtException', (error) => {
  const id = errorFingerprint(error);
  supervisor?.recordError(error);
  logger?.fatal(`Manager uncaught exception [${id}]: ${error.stack || error.message}`);
  dialog.showErrorBox('Khaos Nexus Bot Manager', `A manager error occurred. Error ID: ${id}`);
});

process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  const id = errorFingerprint(error);
  supervisor?.recordError(error);
  logger?.error(`Manager unhandled rejection [${id}]: ${error.stack || error.message}`);
});
