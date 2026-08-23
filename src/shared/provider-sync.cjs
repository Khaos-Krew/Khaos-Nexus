'use strict';

const { MODULES } = require('../backend/modules/catalog.cjs');

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function safeText(value, max = 500) { return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max); }
function safeBoolean(value, fallback = false) { return typeof value === 'boolean' ? value : fallback; }
function safeInteger(value, fallback = 0, min = 0, max = 65535) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}
function safeProtocol(value, fallback = '') {
  const v = safeText(value, 12).toLowerCase();
  return ['http', 'https', 'ws', 'wss'].includes(v) ? v : fallback;
}
function safeList(value, maxItems = 100, maxLength = 120) {
  const source = Array.isArray(value) ? value : [];
  return source.map((item) => safeText(item, maxLength)).filter(Boolean).slice(0, maxItems);
}
function safeBaseUrl(value, fallback = '') {
  const raw = safeText(value, 500);
  if (!raw) return fallback;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return fallback;
    url.username = '';
    url.password = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch { return fallback; }
}

function sanitizeServer(input = {}, template = {}) {
  return {
    ...clone(template),
    name: safeText(input.name, 80) || template.name || 'Server',
    host: safeText(input.host, 255),
    port: safeInteger(input.port, Number(template.port || 0)),
    passwordEnv: String(template.passwordEnv || ''),
    restartOnExit: safeBoolean(input.restartOnExit, Boolean(template.restartOnExit)),
    restartCommand: String(template.restartCommand || ''),
    backupPath: safeText(input.backupPath, 1000),
    ...(Object.prototype.hasOwnProperty.call(template, 'mods') ? { mods: safeList(input.mods, 200, 120) } : {}),
    ...(Object.prototype.hasOwnProperty.call(template, 'modpack') ? { modpack: safeText(input.modpack, 160) } : {})
  };
}

function sanitizeConnection(input = {}, template = {}) {
  const next = clone(template || {});
  if (Array.isArray(template.servers)) {
    const incoming = Array.isArray(input.servers) ? input.servers : [];
    next.servers = template.servers.map((server, index) => sanitizeServer(incoming[index] || {}, server));
    return next;
  }
  if (Object.prototype.hasOwnProperty.call(template, 'host')) next.host = safeText(input.host, 255);
  if (Object.prototype.hasOwnProperty.call(template, 'port')) next.port = safeInteger(input.port, Number(template.port || 0));
  if (Object.prototype.hasOwnProperty.call(template, 'protocol')) next.protocol = safeProtocol(input.protocol, template.protocol || 'http');
  if (Object.prototype.hasOwnProperty.call(template, 'apiPath')) {
    const apiPath = safeText(input.apiPath, 180);
    next.apiPath = apiPath.startsWith('/') ? apiPath : template.apiPath || '/';
  }
  if (Object.prototype.hasOwnProperty.call(template, 'username')) next.username = safeText(input.username, 120);
  if (Object.prototype.hasOwnProperty.call(template, 'passwordEnv')) next.passwordEnv = String(template.passwordEnv || '');
  if (Object.prototype.hasOwnProperty.call(template, 'restartViaShutdown')) next.restartViaShutdown = safeBoolean(input.restartViaShutdown, Boolean(template.restartViaShutdown));
  if (Object.prototype.hasOwnProperty.call(template, 'backupPath')) next.backupPath = safeText(input.backupPath, 1000);
  if (Object.prototype.hasOwnProperty.call(template, 'tlsFingerprint')) next.tlsFingerprint = safeText(input.tlsFingerprint, 200);
  return next;
}

function sanitizeProvider(input = {}, template = {}, module = null) {
  const next = clone(template || {});
  if (!template || typeof template !== 'object') return next;
  if (Object.prototype.hasOwnProperty.call(template, 'type')) {
    const incomingType = safeText(input.type, 20).toLowerCase();
    next.type = ['http', ''].includes(incomingType) ? incomingType : String(template.type || '');
  }
  if (Object.prototype.hasOwnProperty.call(template, 'baseUrl')) next.baseUrl = safeBaseUrl(input.baseUrl, template.baseUrl || '');
  if (Object.prototype.hasOwnProperty.call(template, 'tokenEnv')) next.tokenEnv = String(template.tokenEnv || '');
  if (Object.prototype.hasOwnProperty.call(template, 'actions')) {
    const allowed = new Set((module?.capabilities || []).map((item) => item.id));
    next.actions = safeList(input.actions, 100, 80).map((item) => item.toLowerCase()).filter((item) => allowed.has(item));
  }
  return next;
}

function sanitizeProviderModules(input = {}, templateConfig = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const result = {};
  for (const module of MODULES) {
    const template = templateConfig.modules?.[module.id];
    if (!template) continue;
    const incoming = source[module.id] && typeof source[module.id] === 'object' ? source[module.id] : {};
    const next = clone(template);
    next.enabled = safeBoolean(incoming.enabled, template.enabled !== false);
    if (Object.prototype.hasOwnProperty.call(template, 'platform')) next.platform = safeText(incoming.platform, 20).toLowerCase() || template.platform || 'pc';
    if (Object.prototype.hasOwnProperty.call(template, 'marketPlatform')) next.marketPlatform = safeText(incoming.marketPlatform, 20).toLowerCase() || template.marketPlatform || 'pc';
    if (template.connection) next.connection = sanitizeConnection(incoming.connection || {}, template.connection);
    if (template.provider) next.provider = sanitizeProvider(incoming.provider || {}, template.provider, module);
    result[module.id] = next;
  }
  return result;
}

function mergeProviderModules(config = {}, providerModules = {}) {
  const next = clone(config);
  next.modules ||= {};
  for (const [moduleId, moduleConfig] of Object.entries(providerModules || {})) {
    if (!next.modules[moduleId]) continue;
    next.modules[moduleId] = { ...next.modules[moduleId], ...clone(moduleConfig), channelId: next.modules[moduleId].channelId || '' };
  }
  return next;
}

function providerSecretNames(config = {}) {
  const names = new Set();
  const add = (value) => {
    const name = String(value || '').trim().toUpperCase();
    if (/^NEXUS_[A-Z0-9_]+$/.test(name)) names.add(name);
  };
  for (const moduleConfig of Object.values(config.modules || {})) {
    add(moduleConfig?.provider?.tokenEnv);
    add(moduleConfig?.connection?.passwordEnv);
    for (const server of moduleConfig?.connection?.servers || []) add(server?.passwordEnv);
  }
  return [...names].sort();
}

module.exports = {
  mergeProviderModules,
  providerSecretNames,
  safeBaseUrl,
  sanitizeConnection,
  sanitizeProviderModules,
  sanitizeServer
};
