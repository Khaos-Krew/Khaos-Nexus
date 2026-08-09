'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const { registerRendererBundle } = require('./renderer-asset-loader.cjs');
const {
  mergeProvisioningApps,
  publicProvisioningApps
} = require('../shared/dnd-discord-bot-registry.cjs');

const refs = {
  configStore: null,
  autonomy: null,
  discordAuth: null,
  logger: null
};

let installed = false;
let registered = false;
let registerTimer = null;

function activeRole() {
  try {
    return refs.autonomy?.accessState?.(refs.discordAuth?.getState?.())?.role || 'local-admin';
  } catch {
    return 'local-admin';
  }
}

function assertOwner() {
  if (refs.autonomy?.assertAccess) {
    return refs.autonomy.assertAccess(refs.discordAuth?.getState?.(), 'owner', 'View D&D provisioning bots');
  }
  if (!['owner', 'local-admin'].includes(activeRole())) {
    const error = new Error('Viewing D&D provisioning bots requires Khaos Nexus Owner access.');
    error.code = 'OWNER_ACCESS_REQUIRED';
    throw error;
  }
  return true;
}

function publicConfig(store) {
  try {
    const config = store.getPublicConfig?.() || {};
    return {
      discord: config.discord || store.config?.discord || {},
      hasDiscordToken: Boolean(config.hasDiscordToken || store.secrets?.discordToken)
    };
  } catch {
    return {
      discord: store.config?.discord || {},
      hasDiscordToken: Boolean(store.secrets?.discordToken)
    };
  }
}

function comparable(record = {}) {
  return JSON.stringify({
    id: record.id || '',
    applicationId: record.applicationId || '',
    botUserId: record.botUserId || '',
    name: record.name || '',
    enabled: record.enabled !== false,
    modules: [...(record.modules || [])].sort(),
    guildIds: [...(record.guildIds || [])].sort(),
    legacyNexusBot: Boolean(record.legacyNexusBot)
  });
}

function repairPrimaryBotRecord(store) {
  if (!store?.getDndState) return [];
  const state = store.getDndState();
  const current = Array.isArray(state.registeredApps) ? state.registeredApps : [];
  const merged = mergeProvisioningApps(current, publicConfig(store));
  const desired = merged.find((item) => item.id === 'nexus-bot');
  const existing = current.find((item) => item.id === 'nexus-bot' || item.legacyNexusBot);

  if (desired && comparable(existing) !== comparable(desired) && typeof store.upsertDiscordApp === 'function') {
    store.upsertDiscordApp(desired);
  }

  const refreshed = store.getDndState().registeredApps || merged;
  if (typeof store.getRegisteredAppsPublic === 'function') return store.getRegisteredAppsPublic();
  return publicProvisioningApps(refreshed, (appId) => store.getDiscordAppToken?.(appId) || '');
}

function payload() {
  const apps = repairPrimaryBotRecord(refs.configStore);
  const config = publicConfig(refs.configStore);
  return {
    registeredApps: apps,
    primaryBotConfigured: Boolean(config.hasDiscordToken),
    primaryGuildId: String(config.discord?.guildId || ''),
    source: 'dnd-primary-bot-registry-bridge'
  };
}

function registerHandler() {
  if (registered || !refs.configStore || !refs.autonomy || !refs.discordAuth) return false;
  registered = true;
  electron.ipcMain.handle('dnd-provision:apps', () => {
    assertOwner();
    return payload();
  });
  return true;
}

function scheduleRegister() {
  clearTimeout(registerTimer);
  registerTimer = setTimeout(() => {
    if (!registerHandler()) scheduleRegister();
  }, 100);
  registerTimer.unref?.();
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosDndBotRegistryBridgeCapture) return;
  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
      if (refName === 'configStore') {
        try { repairPrimaryBotRecord(this); }
        catch (error) {
          refs.logger?.warn?.('D&D primary bot registry repair was deferred.', { message: error.message });
        }
      }
      scheduleRegister();
    }
  }
  Object.defineProperty(Captured, '__khaosDndBotRegistryBridgeCapture', { value: true });
  target[exportName] = Captured;
}

function installRendererAsset() {
  registerRendererBundle({
    id: 'dnd-discord-bot-registry-bridge',
    styles: [],
    scripts: [path.join(__dirname, '..', 'renderer', 'dnd-discord-bot-registry-bridge.js')],
    source: 'dnd-discord-bot-registry-bridge-extension.cjs'
  });
}

function install() {
  if (installed) return;
  installed = true;
  captureClass('./services/config-store.cjs', 'ConfigStore', 'configStore');
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  installRendererAsset();
  scheduleRegister();
}

module.exports = {
  install,
  refs,
  comparable,
  repairPrimaryBotRecord,
  payload,
  registerHandler
};
