'use strict';

const { ensureMapProposalState } = require('../shared/dnd-ai-maps.cjs');

let installed = false;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function captureAiMapState(state = {}) {
  return {
    aiMapProposals: Array.isArray(state.aiMapProposals) ? clone(state.aiMapProposals) : []
  };
}

function restoreAiMapState(state, custom) {
  if (!state || !custom) return state;
  state.aiMapProposals = clone(custom.aiMapProposals || []);
  ensureMapProposalState(state);
  return state;
}

function sanitizeAiMapsForExternal(state) {
  if (!state || typeof state !== 'object') return state;
  const safe = clone(state);
  delete safe.aiMapProposals;
  return safe;
}

function install() {
  if (installed) return;
  installed = true;
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosDndAiMapPersistence) return;

  class DndAiMapPersistenceStore extends Original {
    getDndState() {
      const privateState = captureAiMapState(this.config?.dnd || {});
      const normalized = super.getDndState();
      restoreAiMapState(normalized, privateState);
      restoreAiMapState(this.config.dnd, privateState);
      this.saveConfig();
      return clone(normalized);
    }

    mutateDnd(mutator) {
      const before = captureAiMapState(this.config?.dnd || {});
      let after = before;
      const result = super.mutateDnd((state) => {
        restoreAiMapState(state, before);
        const outcome = mutator(state);
        after = captureAiMapState(state);
        return outcome;
      });
      restoreAiMapState(this.config.dnd, after);
      this.saveConfig();
      return result;
    }

    getPublicConfig() {
      const config = super.getPublicConfig();
      if (config.dnd) config.dnd = sanitizeAiMapsForExternal(config.dnd);
      return config;
    }

    exportSafeConfig() {
      return this.getPublicConfig();
    }

    getRuntimeBootstrap() {
      const bootstrap = super.getRuntimeBootstrap();
      if (bootstrap?.config?.dnd) bootstrap.config.dnd = sanitizeAiMapsForExternal(bootstrap.config.dnd);
      return bootstrap;
    }

    getRegisteredBotBootstraps() {
      return super.getRegisteredBotBootstraps().map((bootstrap) => {
        const value = clone(bootstrap);
        if (value?.config?.dnd) value.config.dnd = sanitizeAiMapsForExternal(value.config.dnd);
        return value;
      });
    }
  }

  Object.defineProperty(DndAiMapPersistenceStore, '__khaosDndAiMapPersistence', { value: true });
  target.ConfigStore = DndAiMapPersistenceStore;
}

module.exports = {
  install,
  captureAiMapState,
  restoreAiMapState,
  sanitizeAiMapsForExternal
};
