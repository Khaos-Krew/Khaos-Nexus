'use strict';

const electron = require('electron');
const { DiscordObservabilityService } = require('./services/discord-observability-service.cjs');
const { normalizeDiscordObservability } = require('../shared/discord-observability.cjs');

const refs = {
  configStore: null,
  logger: null,
  supervisor: null,
  updateService: null,
  discordAuth: null,
  autonomy: null,
  applicationMonitor: null,
  service: null
};
let installed = false;
let initialized = false;

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosObservabilityPatched) return;

  class ObservabilityConfigStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      const normalized = normalizeDiscordObservability(this.config.discordObservability || {});
      if (JSON.stringify(this.config.discordObservability || {}) !== JSON.stringify(normalized)) {
        this.config.discordObservability = normalized;
        this.saveConfig();
      }
    }

    getDiscordObservability() {
      return normalizeDiscordObservability(this.config.discordObservability || {});
    }

    setDiscordObservability(input) {
      this.config.discordObservability = normalizeDiscordObservability(input || {});
      this.saveConfig();
      return this.getDiscordObservability();
    }
  }

  Object.defineProperty(ObservabilityConfigStore, '__khaosObservabilityPatched', { value: true });
  target.ConfigStore = ObservabilityConfigStore;
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosObservabilityCaptured) return;

  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
      scheduleInitialize();
    }
  }

  Object.defineProperty(Captured, '__khaosObservabilityCaptured', { value: true });
  target[exportName] = Captured;
}

function activeAccess() {
  try {
    return refs.autonomy?.accessState?.(refs.discordAuth?.getState?.()) || {
      role: 'local-admin', canView: true, canOperate: true, canOwn: true
    };
  } catch {
    return { role: 'local-admin', canView: true, canOperate: true, canOwn: true };
  }
}

function assertAccess(role, action) {
  if (refs.autonomy?.assertAccess) return refs.autonomy.assertAccess(refs.discordAuth?.getState?.(), role, action);
  const access = activeAccess();
  const rank = { locked: 0, viewer: 1, operator: 2, owner: 3, 'local-admin': 3 };
  if ((rank[access.role] || 0) < (rank[role] || 0)) throw new Error(`${action} requires ${role} access.`);
  return true;
}

function stateProvider() {
  const publicConfig = refs.configStore?.getPublicConfig?.() || {};
  const autonomyState = refs.autonomy?.getState?.(refs.discordAuth?.getState?.()) || null;
  return {
    app: {
      version: electron.app.getVersion(),
      userDataPath: electron.app.getPath('userData')
    },
    config: publicConfig,
    bot: refs.supervisor?.getState?.() || {},
    update: refs.updateService?.getState?.() || {},
    applicationMonitor: refs.applicationMonitor?.getState?.() || null,
    autonomy: autonomyState,
    serverHealth: autonomyState?.serverHealth || {}
  };
}

function pushState() {
  const payload = refs.service?.getState?.();
  if (!payload) return;
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('discord-observability:state', payload);
  }
}

function registerIpc() {
  if (registerIpc.done || !refs.service) return;
  registerIpc.done = true;

  electron.ipcMain.handle('discord-observability:get', () => {
    assertAccess('viewer', 'View Discord observability');
    return refs.service.getState();
  });
  electron.ipcMain.handle('discord-observability:list-channels', (_event, guildId) => {
    assertAccess('viewer', 'Load Discord observability channels');
    return refs.service.listChannels(guildId);
  });
  electron.ipcMain.handle('discord-observability:save', (_event, config) => {
    assertAccess('owner', 'Change Discord observability routing');
    const saved = refs.service.saveConfig(config);
    refs.logger?.info?.('Discord observability routing saved.', {
      enabled: saved.enabled,
      releases: saved.routes.releases.enabled,
      errors: saved.routes.errors.enabled,
      heartbeat: saved.routes.heartbeat.enabled,
      health: saved.routes.health.enabled
    });
    pushState();
    return refs.service.getState();
  });
  electron.ipcMain.handle('discord-observability:test', async (_event, type) => {
    assertAccess('operator', 'Test a Discord observability route');
    const result = await refs.service.testRoute(String(type || ''));
    pushState();
    return result;
  });
  electron.ipcMain.handle('discord-observability:heartbeat', async (_event, options = {}) => {
    assertAccess('operator', 'Refresh the Discord heartbeat panel');
    const result = await refs.service.refreshHeartbeat({ force: true, recreate: Boolean(options.recreate) });
    pushState();
    return result;
  });
  electron.ipcMain.handle('discord-observability:clear-history', () => {
    assertAccess('owner', 'Clear Discord observability delivery history');
    const state = refs.service.clearHistory();
    pushState();
    return state;
  });
}

function initialize() {
  if (initialized || !refs.configStore || !refs.logger || !refs.supervisor || !refs.updateService || !refs.discordAuth || !refs.autonomy) return false;
  initialized = true;
  refs.service = new DiscordObservabilityService({
    configStore: refs.configStore,
    logger: refs.logger,
    stateProvider
  });

  refs.supervisor.on('state', (state) => {
    refs.service.handleSupervisorState(state).finally(pushState);
  });
  refs.updateService.on('state', (state) => {
    refs.service.handleUpdateState(state).finally(pushState);
  });
  refs.applicationMonitor?.on?.('state', pushState);

  registerIpc();
  setTimeout(() => refs.service.refreshHeartbeat().catch(() => {}), 10000).unref?.();
  electron.app.on('before-quit', () => refs.service?.stop?.());
  return true;
}

function scheduleInitialize() {
  if (initialized) return;
  setImmediate(() => {
    if (initialize()) return;
    setTimeout(scheduleInitialize, 100).unref?.();
  });
}

function patchBrowserLoader() {
  const prototype = electron.BrowserWindow?.prototype;
  if (!prototype || prototype.__khaosObservabilityUiPatched) return;
  const original = prototype.loadFile;
  prototype.loadFile = function patchedLoadFile(...args) {
    this.webContents.once('did-finish-load', () => {
      this.webContents.executeJavaScript(`(() => {
        if (!document.querySelector('link[href="discord-observability.css"]')) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = 'discord-observability.css';
          document.head.appendChild(link);
        }
        if (!document.querySelector('script[src="discord-observability.js"]')) {
          const script = document.createElement('script');
          script.src = 'discord-observability.js';
          script.defer = true;
          document.body.appendChild(script);
        }
      })();`).catch(() => {});
    });
    return original.apply(this, args);
  };
  Object.defineProperty(prototype, '__khaosObservabilityUiPatched', { value: true });
}

function install() {
  if (installed) return;
  installed = true;
  patchConfigStore();
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  captureClass('./services/bot-supervisor.cjs', 'BotSupervisor', 'supervisor');
  captureClass('./services/update-service.cjs', 'UpdateService', 'updateService');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/application-monitor.cjs', 'ApplicationMonitor', 'applicationMonitor');
  patchBrowserLoader();
  electron.app.whenReady().then(scheduleInitialize);
}

module.exports = { install, refs, stateProvider };
