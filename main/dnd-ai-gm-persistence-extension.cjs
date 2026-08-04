'use strict';

const { ensureAiGmState } = require('../shared/dnd-ai-gm.cjs');

let installed = false;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function captureAiGmState(state = {}) {
  return {
    aiGmBindings: Array.isArray(state.aiGmBindings) ? clone(state.aiGmBindings) : [],
    aiGmSessions: Array.isArray(state.aiGmSessions) ? clone(state.aiGmSessions) : [],
    aiGmTurns: Array.isArray(state.aiGmTurns) ? clone(state.aiGmTurns) : []
  };
}

function restoreAiGmState(state, privateState) {
  if (!state || !privateState) return state;
  state.aiGmBindings = clone(privateState.aiGmBindings || []);
  state.aiGmSessions = clone(privateState.aiGmSessions || []);
  state.aiGmTurns = clone(privateState.aiGmTurns || []);
  ensureAiGmState(state);
  return state;
}

function sanitizeAiGmForExternal(state) {
  if (!state || typeof state !== 'object') return state;
  const safe = clone(state);
  delete safe.aiGmBindings;
  delete safe.aiGmSessions;
  delete safe.aiGmTurns;
  return safe;
}

function install() {
  if (installed) return;
  installed = true;
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosDndAiGmPersistence) return;

  class DndAiGmPersistenceStore extends Original {
    getDndState() {
      const privateState = captureAiGmState(this.config?.dnd || {});
      const normalized = super.getDndState();
      restoreAiGmState(normalized, privateState);
      restoreAiGmState(this.config.dnd, privateState);
      this.saveConfig();
      return clone(normalized);
    }

    mutateDnd(mutator) {
      const before = captureAiGmState(this.config?.dnd || {});
      let after = before;
      const result = super.mutateDnd((state) => {
        restoreAiGmState(state, before);
        const outcome = mutator(state);
        after = captureAiGmState(state);
        return outcome;
      });
      restoreAiGmState(this.config.dnd, after);
      this.saveConfig();
      return result;
    }

    getPublicConfig() {
      const config = super.getPublicConfig();
      if (config.dnd) config.dnd = sanitizeAiGmForExternal(config.dnd);
      return config;
    }

    exportSafeConfig() {
      return this.getPublicConfig();
    }

    getRuntimeBootstrap() {
      const bootstrap = super.getRuntimeBootstrap();
      if (bootstrap?.config?.dnd) bootstrap.config.dnd = sanitizeAiGmForExternal(bootstrap.config.dnd);
      return bootstrap;
    }

    getRegisteredBotBootstraps() {
      return super.getRegisteredBotBootstraps().map((bootstrap) => {
        const value = clone(bootstrap);
        if (value?.config?.dnd) value.config.dnd = sanitizeAiGmForExternal(value.config.dnd);
        return value;
      });
    }
  }

  Object.defineProperty(DndAiGmPersistenceStore, '__khaosDndAiGmPersistence', { value: true });
  target.ConfigStore = DndAiGmPersistenceStore;
}

module.exports = {
  install,
  captureAiGmState,
  restoreAiGmState,
  sanitizeAiGmForExternal
};
