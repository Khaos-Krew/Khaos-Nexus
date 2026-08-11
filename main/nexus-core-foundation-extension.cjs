'use strict';

const path = require('node:path');
const { getNexusCoreService } = require('./services/nexus-core-service.cjs');

const refs = {
  configStore: null,
  logger: null,
  core: null
};
let installed = false;

function registerCoreBoundaries(core) {
  if (!core) return;

  core.registerWorker('nexus-sentinel', {
    allowedScopeKinds: ['server', 'module', 'user'],
    deniedScopeKinds: ['campaign', 'dnd-session'],
    maxScopes: 8
  });
  core.registerWorker('veyra', {
    allowedScopeKinds: ['campaign', 'dnd-session', 'user'],
    deniedScopeKinds: ['server', 'module', 'hosted-server'],
    maxScopes: 8
  });

  core.registerContextProvider('server', async (scope) => {
    const config = refs.configStore?.getPublicConfig?.() || {};
    const server = (config.servers || []).find((item) => String(item.id) === String(scope.id));
    if (!server) return { found: false, id: scope.id };
    return {
      found: true,
      id: server.id,
      name: server.name,
      game: server.game,
      enabled: server.enabled !== false,
      connectionType: server.connectionType || (server.game === 'palworld' ? 'rest' : 'rcon'),
      configured: Boolean(server.hasPassword)
    };
  });

  core.registerContextProvider('module', async (scope) => {
    const config = refs.configStore?.getPublicConfig?.() || {};
    const migration = config.general?.moduleMigration?.[scope.id] || null;
    return migration
      ? {
          found: true,
          id: scope.id,
          enabled: migration.enabled !== false,
          completedSteps: Array.isArray(migration.completedSteps) ? migration.completedSteps.slice(0, 20) : [],
          updatedAt: migration.updatedAt || null
        }
      : { found: false, id: scope.id };
  });

  core.registerContextProvider('user', async (scope) => {
    const config = refs.configStore?.getPublicConfig?.() || {};
    const id = String(scope.id);
    const ownerId = String(config.discord?.ownerUserId || '');
    const operators = Array.isArray(config.discord?.operatorUserIds) ? config.discord.operatorUserIds.map(String) : [];
    return {
      id,
      role: id && id === ownerId ? 'owner' : operators.includes(id) ? 'operator' : 'viewer'
    };
  });
}

function ensureCore() {
  const configPath = refs.configStore?.configPath;
  if (!configPath) return refs.core;
  refs.core = getNexusCoreService({
    dataDirectory: path.dirname(configPath),
    logger: refs.logger
  });
  registerCoreBoundaries(refs.core);
  return refs.core;
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosNexusCoreFoundationPatched) return;

  class NexusCoreConfigStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      ensureCore();
    }

    getPublicConfig() {
      const config = super.getPublicConfig();
      const core = ensureCore();
      config.nexusCore = core?.publicSnapshot?.() || {
        schemaVersion: 1,
        status: 'starting',
        journal: { records: 0, scopes: 0, lastSequence: 0 },
        registry: { actions: 0, tools: 0, contextProviders: 0, workers: 0 },
        workers: []
      };
      return config;
    }
  }

  Object.defineProperty(NexusCoreConfigStore, '__khaosNexusCoreFoundationPatched', { value: true });
  target.ConfigStore = NexusCoreConfigStore;
}

function patchLogger() {
  const target = require('./services/logger.cjs');
  const Original = target.AppLogger;
  if (!Original || Original.__khaosNexusCoreFoundationPatched) return;

  class NexusCoreLogger extends Original {
    constructor(...args) {
      super(...args);
      refs.logger = this;
      ensureCore();
    }
  }

  Object.defineProperty(NexusCoreLogger, '__khaosNexusCoreFoundationPatched', { value: true });
  target.AppLogger = NexusCoreLogger;
}

function install() {
  if (installed) return;
  installed = true;
  patchConfigStore();
  patchLogger();
}

module.exports = {
  install,
  refs,
  ensureCore,
  registerCoreBoundaries
};
