'use strict';

const electron = require('electron');
const {
  applyAppModulePreferences,
  setAppDndPreference,
  toPublicDndConfig,
  isOwnerRole
} = require('../shared/dnd-app-policy.cjs');

const refs = { configStore: null, supervisor: null, autonomy: null, discordAuth: null };
let installed = false;
let registered = false;

function currentRole() {
  try {
    return refs.autonomy?.accessState?.(refs.discordAuth?.getState?.())?.role || 'locked';
  } catch {
    return 'locked';
  }
}

function assertOwner(action) {
  const role = currentRole();
  if (!isOwnerRole(role)) {
    const error = new Error(`${action} requires Khaos Nexus Owner access.`);
    error.code = 'OWNER_ACCESS_REQUIRED';
    throw error;
  }
  return role;
}

function patchIpcRegistration() {
  const ipc = electron.ipcMain;
  if (ipc.__khaosDndOwnerGuard) return;
  const originalHandle = ipc.handle.bind(ipc);
  ipc.handle = function guardedDndHandle(channel, listener) {
    if (channel === 'dnd:get') {
      return originalHandle(channel, async (...args) => {
        assertOwner('Open the D&D campaign workspace');
        return listener(...args);
      });
    }
    return originalHandle(channel, listener);
  };
  Object.defineProperty(ipc, '__khaosDndOwnerGuard', { value: true });
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosDndAppPolicyPatched) return;

  class DndAppPolicyConfigStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      scheduleRegister();
    }

    getDndState() {
      return applyAppModulePreferences(super.getDndState());
    }

    getPublicConfig() {
      const config = super.getPublicConfig();
      const state = this.getDndState();
      config.dnd = toPublicDndConfig(state, this.getRegisteredAppsPublic());
      return config;
    }

    setDndAppEnabled(appId, enabled) {
      if (!this.config?.dnd?.registeredApps?.some((app) => app.id === appId)) {
        const error = new Error('Registered Discord app not found.');
        error.code = 'DISCORD_APP_NOT_FOUND';
        throw error;
      }
      setAppDndPreference(this.config.dnd, appId, enabled);
      this.saveConfig();
      return this.getRegisteredAppsPublic().find((app) => app.id === appId);
    }

    getRuntimeBootstrap() {
      const result = super.getRuntimeBootstrap();
      const state = this.getDndState();
      const app = state.registeredApps.find((item) => item.id === 'nexus-bot') || state.registeredApps.find((item) => item.legacyNexusBot);
      const existing = result.config.moduleRuntime?.['dnd-workspace'];
      const appEnabled = app ? app.dndEnabled !== false : false;
      result.config.dnd = state;
      result.config.moduleRuntime ||= {};
      result.config.moduleRuntime['dnd-workspace'] = {
        ...(existing || {}),
        effectiveEnabled: (existing ? existing.effectiveEnabled !== false : true) && appEnabled,
        reason: appEnabled ? existing?.reason || 'enabled' : 'app-disabled'
      };
      return result;
    }

    getRegisteredBotBootstraps() {
      return super.getRegisteredBotBootstraps().map((bootstrap) => {
        const state = this.getDndState();
        bootstrap.config.dnd = state;
        bootstrap.config.moduleRuntime ||= {};
        const existing = bootstrap.config.moduleRuntime['dnd-workspace'];
        bootstrap.config.moduleRuntime['dnd-workspace'] = {
          ...(existing || {}),
          effectiveEnabled: existing ? existing.effectiveEnabled !== false : true,
          reason: existing?.reason || 'enabled'
        };
        return bootstrap;
      });
    }
  }

  Object.defineProperty(DndAppPolicyConfigStore, '__khaosDndAppPolicyPatched', { value: true });
  target.ConfigStore = DndAppPolicyConfigStore;
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosDndAccessCapturePatched) return;
  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
      scheduleRegister();
    }
  }
  Object.defineProperty(Captured, '__khaosDndAccessCapturePatched', { value: true });
  target[exportName] = Captured;
}

function registerHandlers() {
  if (registered || !refs.configStore || !refs.supervisor || !refs.autonomy || !refs.discordAuth) return false;
  registered = true;
  electron.ipcMain.handle('dnd:app-module-toggle', (_event, input = {}) => {
    assertOwner('Enable or disable D&D for a registered Discord app');
    const app = refs.configStore.setDndAppEnabled(String(input.appId || ''), Boolean(input.enabled));
    refs.configStore.appendDndAudit?.({
      action: 'discord-app.dnd-module-changed',
      outcome: 'success',
      appId: app.id,
      targetId: app.id,
      actorId: String(refs.discordAuth.getState?.().user?.id || 'local-owner'),
      metadata: { enabled: app.dndEnabled }
    });
    refs.supervisor.pushDndConfig?.();
    return {
      app,
      registeredApps: refs.configStore.getRegisteredAppsPublic(),
      state: refs.configStore.getDndState()
    };
  });
  return true;
}

function scheduleRegister() {
  setTimeout(() => {
    if (!registerHandlers()) scheduleRegister();
  }, 100).unref?.();
}

function install() {
  if (installed) return;
  installed = true;
  patchIpcRegistration();
  patchConfigStore();
  captureClass('./services/bot-supervisor.cjs', 'BotSupervisor', 'supervisor');
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  scheduleRegister();
}

module.exports = { install, assertOwner, currentRole };
