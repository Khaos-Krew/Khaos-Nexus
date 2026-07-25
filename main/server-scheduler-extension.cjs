'use strict';

const path = require('node:path');
const electron = require('electron');
const { normalizeSchedule, normalizeSchedulerConfig } = require('../shared/server-scheduler.cjs');
const { ServerSchedulerService } = require('./services/server-scheduler-service.cjs');

const refs = {
  configStore: null,
  logger: null,
  autonomy: null,
  discordAuth: null,
  service: null
};
let installed = false;
let ipcInstalled = false;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function promoteCatalog() {
  try {
    const { MODULE_CATALOG, MIGRATION_STEPS } = require('../shared/module-catalog.cjs');
    const module = MODULE_CATALOG.find((item) => item.id === 'server-scheduler');
    if (module) Object.assign(module, {
      stage: 'live',
      launchView: 'scheduler',
      description: 'Recurring world saves and host-managed restart workflows with warning sequences, cancellation, verification, Discord reporting and execution history.',
      features: ['Recurring weekly schedules', 'Configurable restart warnings', 'Save-before-shutdown protection', 'Host-managed restart verification', 'Manual runs and cancellation', 'Execution history and Discord reports']
    });
    return MIGRATION_STEPS?.map((step) => step.id) || [];
  } catch {
    return [];
  }
}

function ensureSchedulerConfig(store) {
  const normalized = normalizeSchedulerConfig(store.config.serverScheduler || {});
  const changed = JSON.stringify(store.config.serverScheduler || null) !== JSON.stringify(normalized);
  store.config.serverScheduler = normalized;
  const stepIds = promoteCatalog();
  const migration = store.config.general?.moduleMigration?.['server-scheduler'];
  if (migration && stepIds.length) {
    migration.enabled = true;
    migration.completedSteps = stepIds;
    migration.updatedAt = new Date().toISOString();
  }
  if (changed) store.saveConfig();
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosServerSchedulerPatched) return;

  class SchedulerConfigStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      ensureSchedulerConfig(this);
      ensureService();
    }

    getSchedulerConfig() {
      ensureSchedulerConfig(this);
      return clone(this.config.serverScheduler);
    }

    upsertSchedulerSchedule(input) {
      ensureSchedulerConfig(this);
      const schedule = normalizeSchedule(input);
      const schedules = this.config.serverScheduler.schedules;
      const index = schedules.findIndex((item) => item.id === schedule.id);
      if (index >= 0) schedules[index] = schedule;
      else schedules.push(schedule);
      this.config.serverScheduler = normalizeSchedulerConfig(this.config.serverScheduler);
      this.saveConfig();
      return clone(schedule);
    }

    patchSchedulerSchedule(id, patch = {}) {
      ensureSchedulerConfig(this);
      const index = this.config.serverScheduler.schedules.findIndex((item) => item.id === id);
      if (index < 0) throw new Error('The selected server schedule was not found.');
      const schedule = normalizeSchedule({ ...this.config.serverScheduler.schedules[index], ...patch, id });
      this.config.serverScheduler.schedules[index] = schedule;
      this.saveConfig();
      return clone(schedule);
    }

    removeSchedulerSchedule(id) {
      ensureSchedulerConfig(this);
      this.config.serverScheduler.schedules = this.config.serverScheduler.schedules.filter((item) => item.id !== id);
      this.saveConfig();
      return this.getSchedulerConfig();
    }

    setSchedulerSettings(input = {}) {
      ensureSchedulerConfig(this);
      this.config.serverScheduler = normalizeSchedulerConfig({
        ...this.config.serverScheduler,
        settings: { ...this.config.serverScheduler.settings, ...input }
      });
      this.saveConfig();
      return this.getSchedulerConfig();
    }
  }

  Object.defineProperty(SchedulerConfigStore, '__khaosServerSchedulerPatched', { value: true });
  target.ConfigStore = SchedulerConfigStore;
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosSchedulerCapturePatched) return;

  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
      ensureService();
    }
  }

  Object.defineProperty(Captured, '__khaosSchedulerCapturePatched', { value: true });
  target[exportName] = Captured;
}

function accessRole() {
  try { return refs.autonomy?.accessState?.(refs.discordAuth?.getState?.())?.role || 'local-admin'; }
  catch { return 'local-admin'; }
}

function assertAccess(minimumRole, action) {
  if (refs.autonomy?.assertAccess) return refs.autonomy.assertAccess(refs.discordAuth?.getState?.(), minimumRole, action);
  const ranks = { locked: 0, viewer: 1, operator: 2, owner: 3, 'local-admin': 4 };
  if ((ranks[accessRole()] || 0) < (ranks[minimumRole] || 0)) throw new Error(`${action} requires ${minimumRole} access.`);
  return true;
}

function ensureService() {
  if (refs.service || !refs.configStore || !refs.logger || !refs.autonomy) return refs.service;
  refs.service = new ServerSchedulerService({
    dataDirectory: path.dirname(refs.configStore.configPath),
    configStore: refs.configStore,
    logger: refs.logger,
    autonomy: refs.autonomy
  });
  refs.service.on('state', broadcast);
  refs.service.start();
  setImmediate(registerIpc);
  return refs.service;
}

function publicServers() {
  return (refs.configStore?.getPublicConfig?.().servers || []).map((server) => ({
    id: server.id,
    name: server.name,
    game: server.game,
    enabled: server.enabled !== false,
    connectionType: server.connectionType || (server.game === 'palworld' ? 'rest' : 'rcon'),
    hasPassword: Boolean(server.hasPassword)
  }));
}

function payload() {
  const scheduler = ensureService();
  const notificationSettings = refs.autonomy?.getSettings?.() || {};
  return {
    role: accessRole(),
    servers: publicServers(),
    discordReporting: {
      enabled: Boolean(notificationSettings.discordNotificationsEnabled),
      channelId: notificationSettings.notificationChannelId || ''
    },
    ...(scheduler?.getState?.() || { config: normalizeSchedulerConfig({}), history: [], activeRuns: [], nextRuns: {} })
  };
}

function broadcast() {
  if (!refs.configStore || !refs.service) return;
  const state = payload();
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('server-scheduler:update', state);
  }
}

function audit(action, outcome, target, summary) {
  const auth = refs.discordAuth?.getState?.() || {};
  refs.configStore?.appendDiscordAudit?.({
    category: 'server-scheduler',
    action,
    outcome,
    targetType: 'server-schedule',
    targetId: target?.id || '',
    targetName: target?.name || '',
    summary: String(summary || '').slice(0, 500),
    actorId: auth.user?.id || '',
    actorName: auth.user?.globalName || auth.user?.username || 'Local operator',
    actorRole: accessRole(),
    time: new Date().toISOString()
  });
}

function scheduleHasActiveRun(id) {
  return refs.service?.getState?.().activeRuns.some((run) => run.scheduleId === id);
}

function registerIpc() {
  if (ipcInstalled || !refs.service) return;
  ipcInstalled = true;

  electron.ipcMain.handle('server-scheduler:get', () => {
    assertAccess('viewer', 'View server schedules');
    return payload();
  });

  electron.ipcMain.handle('server-scheduler:save', (_event, input) => {
    assertAccess('owner', 'Create or change server schedules');
    const schedule = normalizeSchedule(input);
    if (schedule.enabled && !schedule.serverIds.length) throw new Error('Select at least one enabled game server before enabling this schedule.');
    const saved = refs.configStore.upsertSchedulerSchedule(schedule);
    audit('server-scheduler.saved', 'success', saved, `${saved.action} schedule saved for ${saved.serverIds.length} server(s).`);
    broadcast();
    return payload();
  });

  electron.ipcMain.handle('server-scheduler:settings', (_event, input) => {
    assertAccess('owner', 'Change server scheduler settings');
    refs.configStore.setSchedulerSettings(input || {});
    audit('server-scheduler.settings', 'success', null, 'Server scheduler settings updated.');
    broadcast();
    return payload();
  });

  electron.ipcMain.handle('server-scheduler:remove', (_event, id) => {
    assertAccess('owner', 'Remove server schedules');
    const schedule = refs.configStore.getSchedulerConfig().schedules.find((item) => item.id === id);
    if (!schedule) throw new Error('The selected server schedule was not found.');
    if (scheduleHasActiveRun(id)) throw new Error('Cancel the active workflow before removing this schedule.');
    refs.configStore.removeSchedulerSchedule(id);
    audit('server-scheduler.removed', 'success', schedule, 'Server schedule removed.');
    broadcast();
    return payload();
  });

  electron.ipcMain.handle('server-scheduler:run-now', (_event, input) => {
    assertAccess('operator', 'Run server maintenance schedules');
    const schedule = refs.configStore.getSchedulerConfig().schedules.find((item) => item.id === input?.id);
    if (!schedule) throw new Error('The selected server schedule was not found.');
    const run = refs.service.runNow(schedule.id, { countdownSeconds: input?.countdownSeconds });
    audit('server-scheduler.run-now', 'success', schedule, `Manual ${schedule.action} workflow started.`);
    broadcast();
    return { run, state: payload() };
  });

  electron.ipcMain.handle('server-scheduler:cancel', (_event, runId) => {
    assertAccess('operator', 'Cancel server maintenance schedules');
    const run = refs.service.cancelRun(runId);
    audit('server-scheduler.cancelled', 'success', { id: run.scheduleId, name: run.scheduleName }, run.shutdownSent ? 'Restart monitoring cancelled after shutdown.' : 'Workflow cancellation requested before shutdown.');
    broadcast();
    return payload();
  });

  electron.ipcMain.handle('server-scheduler:test-discord', async (_event, id) => {
    assertAccess('operator', 'Test server scheduler Discord reporting');
    const schedule = refs.configStore.getSchedulerConfig().schedules.find((item) => item.id === id);
    if (!schedule) throw new Error('Save this schedule before testing Discord reporting.');
    const result = await refs.service.testDiscord(id);
    audit('server-scheduler.test-discord', result?.sent || result?.skipped ? 'success' : 'failed', schedule, result?.sent ? 'Scheduler Discord test delivered.' : `Scheduler Discord test skipped: ${result?.reason || result?.error || 'unknown'}.`);
    return { result, state: payload() };
  });

  electron.ipcMain.handle('server-scheduler:clear-history', () => {
    assertAccess('owner', 'Clear server scheduler history');
    refs.service.clearHistory();
    audit('server-scheduler.history-cleared', 'success', null, 'Server scheduler execution history cleared.');
    return payload();
  });
}

function patchBrowserLoader() {
  const prototype = electron.BrowserWindow?.prototype;
  if (!prototype || prototype.__khaosServerSchedulerUiPatched) return;
  const original = prototype.loadFile;
  prototype.loadFile = function patchedLoadFile(...args) {
    this.webContents.once('did-finish-load', () => {
      if (this.isDestroyed() || this.webContents.isDestroyed()) return;
      this.webContents.executeJavaScript(`(() => {
        if (!document.querySelector('link[href="server-scheduler.css"]')) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = 'server-scheduler.css';
          document.head.appendChild(link);
        }
        if (!document.querySelector('script[src="server-scheduler.js"]')) {
          const script = document.createElement('script');
          script.src = 'server-scheduler.js';
          script.defer = true;
          document.body.appendChild(script);
        }
      })();`).catch((error) => refs.logger?.warn?.('Server scheduler renderer bootstrap failed.', { message: error.message }));
    });
    return original.apply(this, args);
  };
  Object.defineProperty(prototype, '__khaosServerSchedulerUiPatched', { value: true });
}

function install() {
  if (installed) return;
  installed = true;
  promoteCatalog();
  patchConfigStore();
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  patchBrowserLoader();
  electron.app.whenReady().then(() => {
    const wait = () => {
      if (refs.configStore && refs.logger && refs.autonomy) {
        ensureService();
        registerIpc();
      } else setTimeout(wait, 100);
    };
    wait();
  }).catch((error) => console.error('[Khaos Nexus] Server scheduler initialization failed.', error));
  electron.app.on('before-quit', () => refs.service?.destroy?.());
}

module.exports = { install, refs, ensureSchedulerConfig, promoteCatalog };
