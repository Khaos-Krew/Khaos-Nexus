'use strict';

let installed = false;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function removePrivateAiServiceState(config) {
  if (!config || typeof config !== 'object') return config;
  const safe = clone(config);
  if (safe.aiServices) {
    delete safe.aiServices.audit;
    if (!safe.aiServices.core) delete safe.aiServices;
  }
  return safe;
}

function removeAllAiServiceState(config) {
  if (!config || typeof config !== 'object') return config;
  const safe = clone(config);
  delete safe.aiServices;
  return safe;
}

function install() {
  if (installed) return;
  installed = true;
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosAiServicesPrivacy) return;

  class AiServicesPrivacyStore extends Original {
    getPublicConfig() {
      return removePrivateAiServiceState(super.getPublicConfig());
    }

    exportSafeConfig() {
      return this.getPublicConfig();
    }

    getRuntimeBootstrap() {
      const bootstrap = super.getRuntimeBootstrap();
      if (bootstrap?.config) bootstrap.config = removeAllAiServiceState(bootstrap.config);
      return bootstrap;
    }

    getRegisteredBotBootstraps(...args) {
      const values = typeof super.getRegisteredBotBootstraps === 'function' ? super.getRegisteredBotBootstraps(...args) : [];
      return values.map((bootstrap) => {
        const value = clone(bootstrap);
        delete value.aiCore;
        if (value.config) value.config = removeAllAiServiceState(value.config);
        return value;
      });
    }
  }

  Object.defineProperty(AiServicesPrivacyStore, '__khaosAiServicesPrivacy', { value: true });
  target.ConfigStore = AiServicesPrivacyStore;
}

module.exports = {
  install,
  removePrivateAiServiceState,
  removeAllAiServiceState
};
