'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  ENV_KEYS,
  applyProviderEnvironment,
  clearProviderEnvironment
} = require('../main/sentinel-local-provider-extension.cjs');
const { AGENTS } = require('../main/ai-runtime-contract.cjs');
const { AI_CORE_LOCAL_PROVIDER_OVERLAY } = require('../scripts/build-bundled-ai-runtimes.cjs');

function restoreEnvironment(snapshot) {
  clearProviderEnvironment();
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test('Sentinel defaults to deterministic local without provider credentials', () => {
  const snapshot = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    const settings = applyProviderEnvironment({ enabled: true, providerMode: 'deterministic-local' });
    assert.equal(settings.providerMode, 'deterministic-local');
    assert.equal(process.env.KHAOS_SENTINEL_AI_PROVIDER, 'deterministic-local');
    assert.equal(process.env.KHAOS_SENTINEL_AI_PROVIDER_FALLBACK, 'disabled');
    assert.equal(process.env.KHAOS_SENTINEL_OLLAMA_MODEL, undefined);
    assert.equal(AGENTS.core.env.AI_PROVIDER, 'deterministic-local');
    assert.equal(AGENTS.core.env.OLLAMA_MODEL, '');
  } finally {
    restoreEnvironment(snapshot);
  }
});

test('Sentinel local LLM bridge exposes only bounded loopback Ollama configuration', () => {
  const snapshot = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    const settings = applyProviderEnvironment({
      enabled: true,
      providerMode: 'ollama-local',
      ollamaModel: 'qwen3:4b',
      ollamaEndpoint: 'http://127.0.0.1:11434',
      fallbackToDeterministic: true
    });
    assert.equal(settings.providerMode, 'ollama-local');
    assert.equal(AGENTS.core.env.AI_PROVIDER, 'ollama-local');
    assert.equal(AGENTS.core.env.AI_PROVIDER_FALLBACK, 'deterministic');
    assert.equal(AGENTS.core.env.OLLAMA_MODEL, 'qwen3:4b');
    assert.equal(AGENTS.core.env.OLLAMA_ENDPOINT, 'http://127.0.0.1:11434');
    assert.equal(AGENTS.core.env.OLLAMA_RETRIES, '0');
    assert.throws(() => applyProviderEnvironment({
      providerMode: 'ollama-local',
      ollamaModel: 'qwen3:4b',
      ollamaEndpoint: 'http://192.168.1.25:11434'
    }), /loopback/i);
  } finally {
    restoreEnvironment(snapshot);
  }
});

test('Sentinel provider bridge rejects paid provider selection and arbitrary provider credentials', () => {
  assert.throws(() => applyProviderEnvironment({ providerMode: 'openai-responses' }), /Deterministic Local or Local LLM/i);
  assert.throws(() => applyProviderEnvironment({ providerMode: 'deterministic-local', openaiApiKey: 'secret-value' }), /server-owned/i);
});

test('bundled AI runtime overlay contains only the local provider implementation seam', () => {
  assert.equal(AI_CORE_LOCAL_PROVIDER_OVERLAY.id, 'nexus-local-ollama-provider');
  const root = path.resolve(__dirname, '..', AI_CORE_LOCAL_PROVIDER_OVERLAY.directory);
  assert.equal(fs.existsSync(path.join(root, 'src', 'ollama-provider.js')), true);
  assert.equal(fs.existsSync(path.join(root, 'src', 'provider-factory.js')), true);
  const factory = fs.readFileSync(path.join(root, 'src', 'provider-factory.js'), 'utf8');
  assert.match(factory, /selected === "ollama-local"/);
  assert.match(factory, /new OllamaLocalProvider/);
  assert.doesNotMatch(factory, /OLLAMA_API_KEY/);
});
