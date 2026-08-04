'use strict';

const {
  AI_CORE_HEALTH_PATH,
  AI_CORE_CAPABILITIES_PATH,
  normalizeServiceEndpoint,
  normalizeAiCoreHealth,
  normalizeAiCoreCapabilities,
  unavailableAiCore,
  publicAiCoreBootstrap
} = require('../shared/ai-service-connections.cjs');

const REQUEST_TIMEOUT_MS = 15000;
const MAX_RESPONSE_CHARACTERS = 512000;

function cleanError(error, token = '') {
  const secret = String(token || '');
  const message = String(error?.message || error || 'Nexus AI Core request failed.')
    .split(secret).join('[REDACTED]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 800);
  return {
    code: String(error?.code || 'AI_CORE_REQUEST_FAILED').slice(0, 100),
    status: Number(error?.status || 0) || null,
    message
  };
}

async function jsonGet(connection, pathname, fetchImpl = global.fetch) {
  if (typeof fetchImpl !== 'function') throw Object.assign(new Error('Network requests are unavailable in the Nexus Bot runtime.'), { code: 'AI_CORE_NETWORK_UNAVAILABLE' });
  const endpoint = normalizeServiceEndpoint(connection.endpoint);
  const token = String(connection.serviceToken || '');
  const headers = { accept: 'application/json', 'user-agent': 'Khaos-Nexus-Bot-AI-Core/1' };
  if (token) headers.authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetchImpl(`${endpoint}${pathname}`, { method: 'GET', headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    throw Object.assign(new Error(cleanError(error, token).message), { code: error?.name === 'TimeoutError' ? 'AI_CORE_TIMEOUT' : 'AI_CORE_NETWORK_ERROR' });
  }
  const declaredLength = Number(response.headers?.get?.('content-length') || 0);
  if (declaredLength > MAX_RESPONSE_CHARACTERS) throw Object.assign(new Error('Nexus AI Core returned an oversized response.'), { code: 'AI_CORE_RESPONSE_TOO_LARGE', status: response.status });
  const text = await response.text();
  if (text.length > MAX_RESPONSE_CHARACTERS) throw Object.assign(new Error('Nexus AI Core returned an oversized response.'), { code: 'AI_CORE_RESPONSE_TOO_LARGE', status: response.status });
  let payload;
  try { payload = text ? JSON.parse(text) : {}; }
  catch { throw Object.assign(new Error('Nexus AI Core returned invalid JSON.'), { code: 'AI_CORE_INVALID_JSON', status: response.status }); }
  if (!response.ok) {
    const message = typeof payload?.error === 'string' ? payload.error : payload?.error?.message || `Nexus AI Core returned HTTP ${response.status}.`;
    throw Object.assign(new Error(String(message).slice(0, 800)), { code: payload?.error?.code || 'AI_CORE_HTTP_ERROR', status: response.status });
  }
  return payload;
}

function createAiCoreClient(connection = {}, fetchImpl = global.fetch) {
  const value = connection && typeof connection === 'object' ? connection : {};
  const publicConnection = publicAiCoreBootstrap(value);
  return Object.freeze({
    connection: publicConnection,
    async check() {
      if (!value.enabled) return { ...unavailableAiCore(value.endpoint, 'Nexus AI Core is not linked to the primary bot.'), enabled: false };
      try {
        const health = normalizeAiCoreHealth(await jsonGet(value, AI_CORE_HEALTH_PATH, fetchImpl), value.endpoint);
        const capabilities = normalizeAiCoreCapabilities(await jsonGet(value, AI_CORE_CAPABILITIES_PATH, fetchImpl), value.endpoint);
        return {
          ...health,
          ...capabilities,
          enabled: true,
          linkedToPrimaryBot: true,
          checkedAt: new Date().toISOString(),
          error: ''
        };
      } catch (error) {
        const safe = cleanError(error, value.serviceToken);
        return {
          ...unavailableAiCore(value.endpoint, safe.message),
          enabled: true,
          linkedToPrimaryBot: true,
          code: safe.code,
          status: safe.status
        };
      }
    }
  });
}

module.exports = {
  REQUEST_TIMEOUT_MS,
  MAX_RESPONSE_CHARACTERS,
  cleanError,
  jsonGet,
  createAiCoreClient
};
