'use strict';

const path = require('node:path');
const electron = require('electron');
const { RendererActionErrorService } = require('./services/renderer-action-error-service.cjs');

const refs = {
  configStore: null,
  logger: null,
  supervisor: null,
  applicationMonitor: null,
  autonomy: null,
  discordAuth: null,
  service: null
};
let installed = false;
let ipcInstalled = false;

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosRendererActionErrorsPatched) return;
  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
      ensureService();
    }
  }
  Object.defineProperty(Captured, '__khaosRendererActionErrorsPatched', { value: true });
  target[exportName] = Captured;
}

function accessRole() {
  try { return refs.autonomy?.accessState?.(refs.discordAuth?.getState?.())?.role || 'local-admin'; }
  catch { return 'local-admin'; }
}

function assertAccess(minimumRole, action) {
  if (refs.autonomy?.assertAccess) return refs.autonomy.assertAccess(refs.discordAuth?.getState?.(), minimumRole, action);
  const rank = { locked: 0, viewer: 1, operator: 2, owner: 3, 'local-admin': 4 };
  if ((rank[accessRole()] || 0) < (rank[minimumRole] || 0)) throw new Error(`${action} requires ${minimumRole} access.`);
  return true;
}

function ensureService() {
  if (refs.service || !refs.configStore || !refs.logger) return refs.service;
  refs.service = new RendererActionErrorService({
    dataDirectory: path.dirname(refs.configStore.configPath),
    configStore: refs.configStore,
    logger: refs.logger
  });
  refs.service.on('state', broadcast);
  setImmediate(registerIpc);
  return refs.service;
}

function broadcast() {
  if (!refs.service) return;
  const state = refs.service.getState();
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('renderer-errors:update', state);
  }
}

function reportToApplicationMonitor(entry, duplicateWithinMinute) {
  if (duplicateWithinMinute || !refs.applicationMonitor) return;
  const action = entry.operation || entry.channel || 'UI action';
  const error = new Error(`${action} failed on ${entry.view}: ${entry.message}`);
  if (entry.stack) error.stack = entry.stack;
  refs.applicationMonitor.capture(error, { source: `renderer-action:${entry.channel || entry.source}` }).catch((captureError) => {
    refs.logger?.warn?.('Application Monitor could not process a UI action error.', {
      errorId: entry.id,
      message: captureError.message
    });
  });
}

function record(payload) {
  const service = ensureService();
  if (!service) return null;
  const result = service.record(payload || {});
  reportToApplicationMonitor(result.entry, result.duplicateWithinMinute);
  return result;
}

function registerIpc() {
  if (ipcInstalled || !refs.service) return;
  ipcInstalled = true;

  electron.ipcMain.on('renderer-action:error', (_event, payload) => {
    try { record(payload); }
    catch (error) { refs.logger?.error?.('Failed to retain a renderer action error.', { message: error.message }); }
  });

  electron.ipcMain.handle('renderer-errors:get', () => {
    assertAccess('viewer', 'View UI action errors');
    return refs.service.getState();
  });

  electron.ipcMain.handle('renderer-errors:clear', () => {
    assertAccess('owner', 'Clear UI action errors');
    refs.logger?.warn?.('Local UI action error history cleared.', { actorRole: accessRole() });
    return refs.service.clear();
  });

  electron.ipcMain.handle('renderer-errors:copy-latest', () => {
    assertAccess('viewer', 'Copy the latest UI action error');
    const text = refs.service.latestText();
    electron.clipboard.writeText(text);
    return { copied: true };
  });
}

function install() {
  if (installed) return;
  installed = true;
  captureClass('./services/config-store.cjs', 'ConfigStore', 'configStore');
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  captureClass('./services/bot-supervisor.cjs', 'BotSupervisor', 'supervisor');
  captureClass('./services/application-monitor.cjs', 'ApplicationMonitor', 'applicationMonitor');
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  electron.app.whenReady().then(() => {
    const wait = () => {
      if (refs.configStore && refs.logger) {
        ensureService();
        registerIpc();
      } else setTimeout(wait, 100);
    };
    wait();
  }).catch((error) => console.error('[Khaos Nexus] Renderer action error reporting failed to initialize.', error));
}

module.exports = { install, refs, ensureService, record };
