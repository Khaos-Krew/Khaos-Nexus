'use strict';

const DND_AI_REPOSITORY = 'Khaos-Krew/Khaos-Nexus-AI';
const AI_CORE_REPOSITORY = 'Khaos-Krew/Khaos-Nexus-AI-Core';
const AI_CORE_SNAPSHOT = '181f6cb25e1ccc46344b8ac7fd82437918a4a4b0';
const DEFAULT_AI_CORE_ENDPOINT = 'http://127.0.0.1:8790';
const AI_CORE_HEALTH_PATH = '/health';
const AI_CORE_CAPABILITIES_PATH = '/api/v1/capabilities';
const AI_CORE_PROVIDER_STATUS_PATH = '/api/v1/provider/status';
const AI_CORE_SERVICE = 'khaos-nexus-ai-core';
const AI_CORE_TARGET = 'nexus-ai-core';

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function cleanText(value, max = 500) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function serviceError(message, code, field) {
  return Object.assign(new Error(message), { code, ...(field ? { field } : {}) });
}

function isLoopbackHostname(hostname) {
  const value = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return value === 'localhost' || value === '127.0.0.1' || value === '::1';
}

function normalizeServiceEndpoint(value, fallback = DEFAULT_AI_CORE_ENDPOINT) {
  let url;
  try {
    url = new URL(String(value || fallback).trim());
  } catch {
    throw serviceError('AI service endpoint must be a valid URL.', 'AI_SERVICE_ENDPOINT_INVALID', 'endpoint');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw serviceError('AI service endpoint must use HTTP or HTTPS.', 'AI_SERVICE_PROTOCOL_INVALID', 'endpoint');
  }
  if (url.username || url.password) {
    throw serviceError('AI service credentials must not be embedded in the endpoint URL.', 'AI_SERVICE_ENDPOINT_CREDENTIALS_FORBIDDEN', 'endpoint');
  }
  if (url.search || url.hash) {
    throw serviceError('AI service endpoint must not contain a query string or fragment.', 'AI_SERVICE_ENDPOINT_SUFFIX_FORBIDDEN', 'endpoint');
  }
  if (url.pathname && url.pathname !== '/') {
    throw serviceError('AI service endpoint must use the service origin without an API path.', 'AI_SERVICE_ENDPOINT_PATH_FORBIDDEN', 'endpoint');
  }
  if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) {
    throw serviceError('Remote AI services require HTTPS. HTTP is allowed only for a local loopback service.', 'AI_SERVICE_HTTPS_REQUIRED', 'endpoint');
  }
  return url.origin;
}

function normalizeServiceToken(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (token.length < 8 || token.length > 500 || /\s/.test(token)) {
    throw serviceError('AI service token must be 8–500 characters without spaces.', 'AI_SERVICE_TOKEN_INVALID', 'serviceToken');
  }
  return token;
}

function normalizeAiCoreSettings(input = {}, current = {}) {
  for (const field of ['apiKey', 'openAiKey', 'openaiApiKey', 'providerKey', 'providerEndpoint', 'providerBaseUrl', 'model']) {
    if (Object.prototype.hasOwnProperty.call(input, field) && cleanText(input[field], 20)) {
      throw serviceError('AI provider credentials, provider endpoints, and models are configured only in Nexus AI Core.', 'AI_CORE_PROVIDER_SETTINGS_SERVER_OWNED', field);
    }
  }
  return {
    enabled: Object.prototype.hasOwnProperty.call(input, 'enabled') ? Boolean(input.enabled) : Boolean(current.enabled),
    linkToPrimaryBot: Object.prototype.hasOwnProperty.call(input, 'linkToPrimaryBot') ? Boolean(input.linkToPrimaryBot) : Boolean(current.linkToPrimaryBot),
    endpoint: normalizeServiceEndpoint(input.endpoint || current.endpoint || DEFAULT_AI_CORE_ENDPOINT),
    updatedAt: cleanText(input.updatedAt || current.updatedAt || new Date().toISOString(), 40)
  };
}

function assertAiCoreIdentity(payload, endpoint) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw serviceError('Nexus AI Core returned an invalid JSON object.', 'AI_CORE_RESPONSE_INVALID');
  }
  if (payload.service !== AI_CORE_SERVICE || payload.targetService !== AI_CORE_TARGET) {
    throw serviceError(`The service at ${endpoint} is not the expected Nexus AI Core runtime.`, 'AI_CORE_IDENTITY_MISMATCH');
  }
}

function normalizeProviderStatus(value = {}) {
  return {
    name: cleanText(value.name || value.provider, 100),
    model: cleanText(value.model, 160),
    ready: value.ready !== false,
    store: value.store === true,
    toolsAllowed: value.toolsAllowed === true,
    fallback: {
      enabled: Boolean(value.fallback?.enabled),
      name: cleanText(value.fallback?.name, 100),
      model: cleanText(value.fallback?.model, 160)
    },
    circuit: {
      state: cleanText(value.circuit?.state || 'unavailable', 40),
      openUntil: cleanText(value.circuit?.openUntil, 60)
    }
  };
}

function normalizeAiCoreHealth(payload, endpoint) {
  assertAiCoreIdentity(payload, endpoint);
  if (payload.status !== 'ok') throw serviceError('Nexus AI Core did not report a healthy status.', 'AI_CORE_UNHEALTHY');
  const isolation = payload.isolation || {};
  if (isolation.directAiToAiCallsAllowed !== false) {
    throw serviceError('Nexus AI Core did not confirm direct AI-to-AI isolation.', 'AI_CORE_ISOLATION_UNCONFIRMED');
  }
  return {
    reachable: true,
    endpoint: normalizeServiceEndpoint(endpoint),
    checkedAt: new Date().toISOString(),
    service: payload.service,
    targetService: payload.targetService,
    apiVersion: cleanText(payload.apiVersion, 20),
    version: cleanText(payload.version, 50),
    provider: cleanText(payload.provider, 100),
    model: cleanText(payload.model, 160),
    providerStatus: normalizeProviderStatus(payload.providerStatus || {}),
    updateMonitorAvailable: Boolean(payload.updateMonitor?.available),
    schedulerOwnedExternally: payload.updateMonitor?.schedulerOwnedExternally === true,
    directAiToAiCallsAllowed: false,
    executionAuthority: cleanText(isolation.executionAuthority, 200),
    error: ''
  };
}

function normalizeAiCoreCapabilities(payload, endpoint) {
  assertAiCoreIdentity(payload, endpoint);
  const capabilities = [...new Set((Array.isArray(payload.capabilities) ? payload.capabilities : [])
    .map((item) => cleanText(item, 120))
    .filter(Boolean))].sort();
  if (!capabilities.length || capabilities.some((item) => item.startsWith('dnd.')) || capabilities.some((item) => !item.startsWith('nexus.'))) {
    throw serviceError('Nexus AI Core returned an invalid or cross-domain capability list.', 'AI_CORE_CAPABILITIES_INVALID');
  }
  const rejectedNamespaces = (Array.isArray(payload.rejectedNamespaces) ? payload.rejectedNamespaces : []).map((item) => cleanText(item, 80));
  if (!rejectedNamespaces.includes('dnd.*')) {
    throw serviceError('Nexus AI Core did not confirm rejection of the D&D namespace.', 'AI_CORE_DND_ISOLATION_UNCONFIRMED');
  }
  if (payload.directServiceForwarding !== false || payload.directDiscordConnection !== false || payload.directExecution !== false) {
    throw serviceError('Nexus AI Core did not confirm advisory-only operation.', 'AI_CORE_AUTHORITY_BOUNDARY_UNCONFIRMED');
  }
  return {
    apiVersion: cleanText(payload.apiVersion, 20),
    capabilities,
    providerStatus: normalizeProviderStatus(payload.providerStatus || {}),
    rejectedNamespaces,
    directServiceForwarding: false,
    directDiscordConnection: false,
    directExecution: false
  };
}

function unavailableAiCore(endpoint, error = 'Connection has not been checked yet.') {
  const value = typeof error === 'string' ? error : cleanText(error?.message || error, 800);
  return {
    reachable: false,
    endpoint: normalizeServiceEndpoint(endpoint || DEFAULT_AI_CORE_ENDPOINT),
    checkedAt: new Date().toISOString(),
    service: AI_CORE_SERVICE,
    targetService: AI_CORE_TARGET,
    apiVersion: '',
    version: '',
    provider: '',
    model: '',
    providerStatus: normalizeProviderStatus({ ready: false }),
    updateMonitorAvailable: false,
    schedulerOwnedExternally: true,
    directAiToAiCallsAllowed: false,
    executionAuthority: 'Khaos Nexus desktop and Nexus Bot',
    capabilities: [],
    rejectedNamespaces: ['dnd.*'],
    directServiceForwarding: false,
    directDiscordConnection: false,
    directExecution: false,
    error: value || 'Nexus AI Core is unavailable.'
  };
}

function aiCoreBootstrap(settings, serviceToken) {
  const normalized = normalizeAiCoreSettings(settings || {});
  if (!normalized.enabled || !normalized.linkToPrimaryBot) return null;
  return {
    enabled: true,
    endpoint: normalized.endpoint,
    serviceToken: normalizeServiceToken(serviceToken),
    repository: AI_CORE_REPOSITORY,
    snapshot: AI_CORE_SNAPSHOT,
    targetService: AI_CORE_TARGET,
    healthPath: AI_CORE_HEALTH_PATH,
    capabilitiesPath: AI_CORE_CAPABILITIES_PATH,
    policy: {
      dndNamespaceAllowed: false,
      directServiceForwarding: false,
      directDiscordConnection: false,
      directExecution: false,
      providerCredentialsAccepted: false,
      desktopAndBotAuthoritative: true
    }
  };
}

function publicAiCoreBootstrap(value) {
  if (!value) return null;
  const safe = clone(value);
  delete safe.serviceToken;
  safe.hasServiceToken = Boolean(value.serviceToken);
  return safe;
}

module.exports = {
  DND_AI_REPOSITORY,
  AI_CORE_REPOSITORY,
  AI_CORE_SNAPSHOT,
  DEFAULT_AI_CORE_ENDPOINT,
  AI_CORE_HEALTH_PATH,
  AI_CORE_CAPABILITIES_PATH,
  AI_CORE_PROVIDER_STATUS_PATH,
  AI_CORE_SERVICE,
  AI_CORE_TARGET,
  clone,
  cleanText,
  isLoopbackHostname,
  normalizeServiceEndpoint,
  normalizeServiceToken,
  normalizeAiCoreSettings,
  normalizeAiCoreHealth,
  normalizeAiCoreCapabilities,
  unavailableAiCore,
  aiCoreBootstrap,
  publicAiCoreBootstrap
};
