'use strict';

const path = require('node:path');
const { getNexusCoreService } = require('./services/nexus-core-service.cjs');

const refs = {
  configStore: null,
  logger: null,
  core: null
};
let installed = false;

function ensureCore() {
  const configPath = refs.configStore?.configPath;
  if (!configPath) return refs.core;
  refs.core = getNexusCoreService({
    dataDirectory: path.dirname(configPath),
    logger: refs.logger
  });
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
  ensureCore
};
