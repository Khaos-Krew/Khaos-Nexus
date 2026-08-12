'use strict';

const { normalizeAiCoreSettings } = require('../shared/ai-service-connections.cjs');

const ENV_KEYS = Object.freeze([
  'KHAOS_SENTINEL_AI_PROVIDER',
  'KHAOS_SENTINEL_AI_PROVIDER_FALLBACK',
  'KHAOS_SENTINEL_OLLAMA_MODEL',
  'KHAOS_SENTINEL_OLLAMA_ENDPOINT',
  'KHAOS_SENTINEL_OLLAMA_TIMEOUT_MS',
  'KHAOS_SENTINEL_OLLAMA_MAX_RESPONSE_BYTES',
  'KHAOS_SENTINEL_OLLAMA_RETRIES'
]);
let installed = false;

function clearProviderEnvironment() {
  for (const key of ENV_KEYS) delete process.env[key];
}

function applyProviderEnvironment(input = {}) {
  const settings = normalizeAiCoreSettings(input, input);
  clearProviderEnvironment();
  process.env.KHAOS_SENTINEL_AI_PROVIDER = settings.providerMode;
  if (settings.providerMode === 'ollama-local') {
    process.env.KHAOS_SENTINEL_AI_PROVIDER_FALLBACK = settings.fallbackToDeterministic ? 'deterministic' : 'disabled';
    process.env.KHAOS_SENTINEL_OLLAMA_MODEL = settings.ollamaModel;
    process.env.KHAOS_SENTINEL_OLLAMA_ENDPOINT = settings.ollamaEndpoint;
    // Keep inference inside the existing desktop request budget. Slow/offline local models
    // fail to the deterministic provider instead of making Discord appear disconnected.
    process.env.KHAOS_SENTINEL_OLLAMA_TIMEOUT_MS = '12000';
    process.env.KHAOS_SENTINEL_OLLAMA_MAX_RESPONSE_BYTES = '1000000';
    process.env.KHAOS_SENTINEL_OLLAMA_RETRIES = '0';
  } else {
    process.env.KHAOS_SENTINEL_AI_PROVIDER_FALLBACK = 'disabled';
  }
  return settings;
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosSentinelLocalProvider) return;

  class SentinelLocalProviderConfigStore extends Original {
    constructor(...args) {
      super(...args);
      applyProviderEnvironment(this.getAiCoreSettings?.() || this.config?.aiServices?.core || {});
    }

    setAiCoreSettings(input = {}) {
      const result = super.setAiCoreSettings(input);
      applyProviderEnvironment(result);
      return result;
    }
  }

  Object.defineProperty(SentinelLocalProviderConfigStore, '__khaosSentinelLocalProvider', { value: true });
  target.ConfigStore = SentinelLocalProviderConfigStore;
}

function install() {
  if (installed) return;
  installed = true;
  patchConfigStore();
}

module.exports = {
  ENV_KEYS,
  install,
  applyProviderEnvironment,
  clearProviderEnvironment
};
