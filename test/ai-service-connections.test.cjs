'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AI_CORE_SNAPSHOT,
  DEFAULT_AI_CORE_ENDPOINT,
  DEFAULT_OLLAMA_ENDPOINT,
  AI_CORE_PROVIDER_MODES,
  redactServiceSecret,
  normalizeServiceEndpoint,
  normalizeOllamaEndpoint,
  normalizeOllamaModel,
  normalizeServiceToken,
  sanitizeAiServiceBackupSecrets,
  normalizeAiCoreSettings,
  normalizeProviderStatus,
  normalizeAiCoreHealth,
  normalizeAiCoreCapabilities,
  aiCoreBootstrap,
  publicAiCoreBootstrap
} = require('../shared/ai-service-connections.cjs');
const {
  removePrivateAiServiceState,
  removeAllAiServiceState
} = require('../main/ai-services-privacy-extension.cjs');

test('AI service endpoint policy permits loopback HTTP and requires remote HTTPS', () => {
  assert.equal(normalizeServiceEndpoint('http://127.0.0.1:8790/'), DEFAULT_AI_CORE_ENDPOINT);
  assert.equal(normalizeServiceEndpoint('http://localhost:8790'), 'http://localhost:8790');
  assert.equal(normalizeServiceEndpoint('https://ai.example.com'), 'https://ai.example.com');
  assert.throws(() => normalizeServiceEndpoint('http://ai.example.com'), /require HTTPS/i);
  assert.throws(() => normalizeServiceEndpoint('https://ai.example.com/api/v1'), /without an API path/i);
  assert.throws(() => normalizeServiceEndpoint('https://token@ai.example.com'), /must not be embedded/i);
  assert.throws(() => normalizeServiceEndpoint('https://ai.example.com?key=value'), /query string/i);
});

test('local Ollama endpoint is loopback-only and model names are bounded', () => {
  assert.equal(normalizeOllamaEndpoint('http://127.0.0.1:11434/'), DEFAULT_OLLAMA_ENDPOINT);
  assert.equal(normalizeOllamaEndpoint('http://localhost:11434'), 'http://localhost:11434');
  assert.throws(() => normalizeOllamaEndpoint('http://192.168.1.25:11434'), /loopback/i);
  assert.throws(() => normalizeOllamaEndpoint('https://127.0.0.1:11434'), /loopback/i);
  assert.equal(normalizeOllamaModel('qwen3:4b'), 'qwen3:4b');
  assert.throws(() => normalizeOllamaModel('model with spaces'), /invalid/i);
});

test('service tokens and AI Core settings permit only zero-cost local provider modes', () => {
  assert.equal(normalizeServiceToken('abcdefgh'), 'abcdefgh');
  assert.throws(() => normalizeServiceToken('short'), /8–500/);
  assert.throws(() => normalizeServiceToken('contains spaces'), /without spaces/);
  assert.deepEqual(AI_CORE_PROVIDER_MODES, ['deterministic-local', 'ollama-local']);

  const deterministic = normalizeAiCoreSettings({ enabled: true, linkToPrimaryBot: true, endpoint: DEFAULT_AI_CORE_ENDPOINT });
  assert.equal(deterministic.providerMode, 'deterministic-local');
  assert.equal(deterministic.fallbackToDeterministic, true);

  const local = normalizeAiCoreSettings({
    enabled: true,
    linkToPrimaryBot: true,
    endpoint: DEFAULT_AI_CORE_ENDPOINT,
    providerMode: 'ollama-local',
    ollamaModel: 'qwen3:4b',
    ollamaEndpoint: DEFAULT_OLLAMA_ENDPOINT,
    fallbackToDeterministic: true
  });
  assert.equal(local.providerMode, 'ollama-local');
  assert.equal(local.ollamaModel, 'qwen3:4b');
  assert.equal(local.ollamaEndpoint, DEFAULT_OLLAMA_ENDPOINT);
  assert.throws(() => normalizeAiCoreSettings({ providerMode: 'ollama-local', ollamaModel: '' }), /model before enabling/i);
  assert.throws(() => normalizeAiCoreSettings({ providerMode: 'openai-responses' }), /Deterministic Local or Local LLM/i);
  assert.throws(() => normalizeAiCoreSettings({ openaiApiKey: 'secret-value' }), /server-owned/i);
  assert.throws(() => normalizeAiCoreSettings({ model: 'provider-model' }), /server-owned/i);
});

test('error redaction preserves tokenless messages and removes configured tokens', () => {
  assert.equal(redactServiceSecret('Connection refused at loopback.', ''), 'Connection refused at loopback.');
  assert.equal(redactServiceSecret('Authorization abcdefgh was rejected.', 'abcdefgh'), 'Authorization [REDACTED] was rejected.');
  assert.equal(redactServiceSecret('line one\nline two', '', 100), 'line one line two');
});

test('backup sanitization preserves both AI service secret exclusions', () => {
  const sanitized = sanitizeAiServiceBackupSecrets({
    discordToken: 'discord-secret',
    dndAiServiceToken: 'dnd-service-secret',
    dndCoDmOpenAiKey: 'legacy-provider-secret',
    aiCoreServiceToken: 'core-service-secret',
    pterodactylApiKey: 'unrelated-secret'
  });
  assert.equal(sanitized.discordToken, 'discord-secret');
  assert.equal(sanitized.pterodactylApiKey, 'unrelated-secret');
  assert.equal('dndAiServiceToken' in sanitized, false);
  assert.equal('dndCoDmOpenAiKey' in sanitized, false);
  assert.equal('aiCoreServiceToken' in sanitized, false);
});

test('provider status projection keeps only safe operational metadata', () => {
  const provider = normalizeProviderStatus({
    name: 'ollama-local',
    model: 'qwen3:4b',
    ready: true,
    store: false,
    toolsAllowed: false,
    endpoint: 'http://127.0.0.1:11434',
    fallback: { enabled: true, name: 'deterministic-local', model: 'deterministic-local' },
    circuit: { state: 'closed', openUntil: null },
    telemetry: { requestPrompts: ['private'] }
  });
  assert.deepEqual(provider, {
    name: 'ollama-local',
    model: 'qwen3:4b',
    ready: true,
    store: false,
    toolsAllowed: false,
    fallback: { enabled: true, name: 'deterministic-local', model: 'deterministic-local' },
    circuit: { state: 'closed', openUntil: '' }
  });
  assert.equal('endpoint' in provider, false);
  assert.equal('telemetry' in provider, false);
});

test('AI Core health and capabilities require exact identity and advisory isolation', () => {
  const health = normalizeAiCoreHealth({
    status: 'ok',
    service: 'khaos-nexus-ai-core',
    apiVersion: '1',
    version: '0.7.0',
    targetService: 'nexus-ai-core',
    provider: 'ollama-local',
    model: 'qwen3:4b',
    providerStatus: { name: 'ollama-local', model: 'qwen3:4b', ready: true, store: false, toolsAllowed: false },
    updateMonitor: { available: true, schedulerOwnedExternally: true },
    isolation: { directAiToAiCallsAllowed: false, executionAuthority: 'Khaos Nexus desktop and Nexus Bot' }
  }, DEFAULT_AI_CORE_ENDPOINT);
  assert.equal(health.reachable, true);
  assert.equal(health.directAiToAiCallsAllowed, false);
  assert.equal(health.providerStatus.name, 'ollama-local');
  assert.equal(health.providerStatus.store, false);
  assert.equal(health.providerStatus.toolsAllowed, false);

  const capabilities = normalizeAiCoreCapabilities({
    service: 'khaos-nexus-ai-core',
    targetService: 'nexus-ai-core',
    apiVersion: '1',
    capabilities: ['nexus.help', 'nexus.update.poll', 'nexus.discord.assist'],
    providerStatus: { ready: true },
    rejectedNamespaces: ['dnd.*'],
    directServiceForwarding: false,
    directDiscordConnection: false,
    directExecution: false
  }, DEFAULT_AI_CORE_ENDPOINT);
  assert.deepEqual(capabilities.capabilities, ['nexus.discord.assist', 'nexus.help', 'nexus.update.poll']);
  assert.equal(capabilities.directExecution, false);

  assert.throws(() => normalizeAiCoreCapabilities({
    service: 'khaos-nexus-ai-core', targetService: 'nexus-ai-core', capabilities: ['dnd.gm'], rejectedNamespaces: ['dnd.*'], directServiceForwarding: false, directDiscordConnection: false, directExecution: false
  }, DEFAULT_AI_CORE_ENDPOINT), /cross-domain capability/i);
  assert.throws(() => normalizeAiCoreCapabilities({
    service: 'khaos-nexus-ai-core', targetService: 'nexus-ai-core', capabilities: ['nexus.help'], rejectedNamespaces: [], directServiceForwarding: false, directDiscordConnection: false, directExecution: false
  }, DEFAULT_AI_CORE_ENDPOINT), /rejection of the D&D namespace/i);
});

test('only an explicitly enabled primary-bot link receives the bounded AI Core bootstrap', () => {
  assert.equal(aiCoreBootstrap({ enabled: false, linkToPrimaryBot: true, endpoint: DEFAULT_AI_CORE_ENDPOINT }, 'abcdefgh'), null);
  assert.equal(aiCoreBootstrap({ enabled: true, linkToPrimaryBot: false, endpoint: DEFAULT_AI_CORE_ENDPOINT }, 'abcdefgh'), null);
  const bootstrap = aiCoreBootstrap({ enabled: true, linkToPrimaryBot: true, endpoint: DEFAULT_AI_CORE_ENDPOINT }, 'abcdefgh');
  assert.equal(bootstrap.snapshot, AI_CORE_SNAPSHOT);
  assert.equal(bootstrap.targetService, 'nexus-ai-core');
  assert.equal(bootstrap.serviceToken, 'abcdefgh');
  assert.equal(bootstrap.policy.dndNamespaceAllowed, false);
  assert.equal(bootstrap.policy.directExecution, false);
  const publicValue = publicAiCoreBootstrap(bootstrap);
  assert.equal(publicValue.hasServiceToken, true);
  assert.equal('serviceToken' in publicValue, false);
});

test('private AI connection audit and all secondary-bot AI metadata are removed from projections', () => {
  const config = {
    general: {},
    aiServices: {
      core: { enabled: true, endpoint: DEFAULT_AI_CORE_ENDPOINT },
      audit: [{ actorId: 'private-discord-id', action: 'core.settings-saved' }]
    }
  };
  const publicConfig = removePrivateAiServiceState(config);
  assert.equal(publicConfig.aiServices.core.enabled, true);
  assert.equal('audit' in publicConfig.aiServices, false);
  const botConfig = removeAllAiServiceState(config);
  assert.equal('aiServices' in botConfig, false);
});
