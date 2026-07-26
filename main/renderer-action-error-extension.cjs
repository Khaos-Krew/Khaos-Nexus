'use strict';

const path = require('node:path');
const electron = require('electron');
const { RendererActionErrorService } = require('./services/renderer-action-error-service.cjs');
const { isExpectedAccessDenial } = require('../shared/renderer-action-errors.cjs');

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
      syncRetainedErrors();
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

function syncRetainedErrors(state = null) {
  if (!refs.applicationMonitor?.captureRetainedErrors || !refs.service) return { skipped: true, reason: 'monitor-not-ready' };
  try {
    return refs.applicationMonitor.captureRetainedErrors((state || refs.service.getState()).entries, { source: 'renderer-action' });
  } catch (error) {
    refs.logger?.warn?.('Application Monitor could not import retained UI errors.', { message: error.message });
    return { skipped: true, reason: error.message };
  }
}

function ensureService() {
  if (refs.service || !refs.configStore || !refs.logger) return refs.service;
  refs.service = new RendererActionErrorService({
    dataDirectory: path.dirname(refs.configStore.configPath),
    configStore: refs.configStore,
    logger: refs.logger
  });
  refs.service.on('state', (state) => {
    broadcast();
    syncRetainedErrors(state);
  });
  setImmediate(registerIpc);
  setImmediate(syncRetainedErrors);
  return refs.service;
}

function broadcast() {
  if (!refs.service) return;
  const state = refs.service.getState();
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('renderer-errors:update', state);
  }
}

function record(payload) {
  if (isExpectedAccessDenial(payload)) return { ignored: true, reason: 'expected-access-denial' };
  const service = ensureService();
  if (!service) return null;
  return service.record(payload || {});
}

function registerIpc() {
  if (ipcInstalled || !refs.service) return;
  ipcInstalled = true;

  electron.ipcMain.on('renderer-action:error', (_event, payload) => {
    try { record(payload); }
    catch (error) { refs.logger?.error?.('Failed to retain a renderer action error.', { message: error.message }); }
  });

  // Reading and copying redacted local diagnostics must work before Discord sign-in.
  // Otherwise the diagnostic panel creates its own authorization failure during startup.
  electron.ipcMain.handle('renderer-errors:get', () => refs.service.getState());

  electron.ipcMain.handle('renderer-errors:clear', () => {
    assertAccess('owner', 'Clear UI action errors');
    refs.logger?.warn?.('Local UI action error history cleared.', { actorRole: accessRole() });
    return refs.service.clear();
  });

  electron.ipcMain.handle('renderer-errors:copy-latest', () => {
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
        syncRetainedErrors();
      } else setTimeout(wait, 100);
    };
    wait();
  }).catch((error) => console.error('[Khaos Nexus] Renderer action error reporting failed to initialize.', error));
}

module.exports = { install, refs, ensureService, record, syncRetainedErrors };
