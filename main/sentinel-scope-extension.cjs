'use strict';

const path = require('node:path');
const { registerRendererBundle } = require('./renderer-asset-loader.cjs');
const { catalog } = require('../shared/module-registry.cjs');

const ACTIVE_MODULES = new Set([
  'discord-runtime',
  'game-server-control',
  'palworld-operations',
  'operator-console',
  'application-monitor',
  'backup-update-center',
  'players-console',
  'server-status-panels',
  'embed-studio',
  'role-menus',
  'color-roles',
  'discord-organization',
  'discord-audit-logging',
  'discord-observability',
  'palworld-companion',
  'admin-command-center'
]);

let installed = false;

function isActiveModule(id) {
  return ACTIVE_MODULES.has(String(id || ''));
}

function enforceDeferredModules(store) {
  if (!store?.config?.general) return false;
  store.config.general.moduleOverrides ||= {};
  let changed = false;
  const now = new Date().toISOString();
  for (const module of catalog()) {
    if (isActiveModule(module.id)) continue;
    const current = store.config.general.moduleOverrides[module.id];
    if (!current || current.enabled !== false) {
      store.config.general.moduleOverrides[module.id] = { enabled: false, updatedAt: now };
      changed = true;
    }
  }
  return changed;
}

function onlyPalworldServers(servers) {
  return (Array.isArray(servers) ? servers : []).filter((server) => String(server?.game || '').toLowerCase() === 'palworld');
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__nexusSentinelScopePatched) return;

  class SentinelConfigStore extends Original {
    constructor(...args) {
      super(...args);
      if (enforceDeferredModules(this)) this.saveConfig();
    }

    saveConfig(...args) {
      enforceDeferredModules(this);
      return super.saveConfig(...args);
    }

    getPublicConfig(...args) {
      const config = super.getPublicConfig(...args);
      config.servers = onlyPalworldServers(config.servers);
      config.productScope = 'discord-palworld';
      config.primaryBotName = 'Nexus Sentinel';
      return config;
    }

    getRuntimeBootstrap(...args) {
      const runtime = super.getRuntimeBootstrap(...args);
      runtime.config.servers = onlyPalworldServers(runtime.config.servers);
      runtime.config.productScope = 'discord-palworld';
      runtime.config.primaryBotName = 'Nexus Sentinel';
      return runtime;
    }

    upsertServer(server, password) {
      const requestedGame = String(server?.game || 'palworld').toLowerCase();
      if (requestedGame !== 'palworld') {
        const error = new Error('Nexus Sentinel test scope accepts Palworld servers only. Other game modules are preserved for later but currently disabled.');
        error.code = 'SENTINEL_PALWORLD_ONLY';
        throw error;
      }
      return super.upsertServer({ ...server, game: 'palworld' }, password);
    }

    getModuleStates(...args) {
      const states = typeof super.getModuleStates === 'function' ? super.getModuleStates(...args) : {};
      for (const [id, state] of Object.entries(states || {})) {
        if (!isActiveModule(id)) state.enabled = false;
      }
      return states;
    }

    setModuleState(id, patch = {}) {
      if (!isActiveModule(id) && patch?.enabled === true) {
        const error = new Error('That module is deferred in the current Nexus Sentinel test scope. Only Discord and Palworld modules can be enabled right now.');
        error.code = 'SENTINEL_MODULE_DEFERRED';
        throw error;
      }
      return super.setModuleState(id, patch);
    }

    setModuleBulkMode(mode) {
      const result = super.setModuleBulkMode(mode);
      if (enforceDeferredModules(this)) super.saveConfig();
      return this.getModuleStates?.() || result;
    }
  }

  Object.defineProperty(SentinelConfigStore, '__nexusSentinelScopePatched', { value: true });
  target.ConfigStore = SentinelConfigStore;
}

function installRendererAssets() {
  registerRendererBundle({
    id: 'nexus-sentinel-scope',
    styles: [path.join(__dirname, '..', 'renderer', 'sentinel-scope.css')],
    scripts: [path.join(__dirname, '..', 'renderer', 'sentinel-scope.js')],
    source: 'sentinel-scope-extension.cjs'
  });
}

function install() {
  if (installed) return;
  installed = true;
  patchConfigStore();
  installRendererAssets();
}

module.exports = {
  install,
  patchConfigStore,
  enforceDeferredModules,
  onlyPalworldServers,
  isActiveModule,
  ACTIVE_MODULES
};