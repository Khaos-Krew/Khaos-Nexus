'use strict';

const refs = { configStore: null, updateService: null };
let installed = false;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function updatePreference() {
  return Boolean(refs.configStore?.getConfig?.().general?.checkUpdates);
}

function applyPreference() {
  if (!refs.updateService?.configureAutomaticChecks) return null;
  return refs.updateService.configureAutomaticChecks(updatePreference(), CHECK_INTERVAL_MS);
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__nexusSentinelUpdateSettingsPatched) return;

  class SentinelUpdateConfigStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      setImmediate(applyPreference);
    }

    setGeneral(...args) {
      const result = super.setGeneral(...args);
      setImmediate(applyPreference);
      return result;
    }
  }

  Object.defineProperty(SentinelUpdateConfigStore, '__nexusSentinelUpdateSettingsPatched', { value: true });
  target.ConfigStore = SentinelUpdateConfigStore;
}

function patchUpdateService() {
  const target = require('./services/update-service.cjs');
  const Original = target.UpdateService;
  if (!Original || Original.__nexusSentinelUpdateSettingsPatched) return;

  class SentinelUpdateSettingsService extends Original {
    constructor(...args) {
      super(...args);
      refs.updateService = this;
      setImmediate(applyPreference);
    }
  }

  Object.defineProperty(SentinelUpdateSettingsService, '__nexusSentinelUpdateSettingsPatched', { value: true });
  target.UpdateService = SentinelUpdateSettingsService;
}

function install() {
  if (installed) return;
  installed = true;
  patchConfigStore();
  patchUpdateService();
}

module.exports = {
  install,
  patchConfigStore,
  patchUpdateService,
  applyPreference,
  updatePreference,
  CHECK_INTERVAL_MS,
  refs
};
