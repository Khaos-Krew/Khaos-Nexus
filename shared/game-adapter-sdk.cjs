'use strict';

const crypto = require('node:crypto');
const { redactText, errorFingerprint } = require('./redaction.cjs');

const ADAPTER_SCHEMA_VERSION = 1;
const ROLE_RANK = Object.freeze({ locked: 0, viewer: 1, operator: 2, owner: 3, 'local-admin': 3 });
const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const ADAPTER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,79}$/;
const DEFAULT_TIMEOUT_MS = 15000;
const SENSITIVE_FIELD_PATTERN = /password|token|secret|api[_-]?key|authorization|cookie|credential|session|private[_-]?key|rcon/i;

const CORE_CAPABILITY_DEFINITIONS = Object.freeze({
  status: { requiredRole: 'viewer', destructive: false, timeoutMs: 10000 },
  health: { requiredRole: 'viewer', destructive: false, timeoutMs: 10000 },
  info: { requiredRole: 'viewer', destructive: false, timeoutMs: 10000 },
  players: { requiredRole: 'viewer', destructive: false, timeoutMs: 10000 },
  metrics: { requiredRole: 'viewer', destructive: false, timeoutMs: 10000 },
  settings: { requiredRole: 'viewer', destructive: false, timeoutMs: 10000 },
  announce: { requiredRole: 'operator', destructive: false, timeoutMs: 10000 },
  save: { requiredRole: 'operator', destructive: false, timeoutMs: 30000 },
  backup: { requiredRole: 'operator', destructive: false, timeoutMs: 120000 },
  kick: { requiredRole: 'operator', destructive: true, timeoutMs: 10000 },
  ban: { requiredRole: 'owner', destructive: true, timeoutMs: 10000 },
  unban: { requiredRole: 'owner', destructive: true, timeoutMs: 10000 },
  shutdown: { requiredRole: 'owner', destructive: true, timeoutMs: 30000 },
  restart: { requiredRole: 'owner', destructive: true, timeoutMs: 120000 },
  stop: { requiredRole: 'owner', destructive: true, timeoutMs: 30000 },
  raw: { requiredRole: 'owner', destructive: true, timeoutMs: 15000 },
  'game-data': { requiredRole: 'owner', destructive: false, timeoutMs: 120000 },
  'game-data-summary': { requiredRole: 'viewer', destructive: false, timeoutMs: 120000 },
  logs: { requiredRole: 'operator', destructive: false, timeoutMs: 15000 },
  'config-read': { requiredRole: 'operator', destructive: false, timeoutMs: 10000 },
  'config-write': { requiredRole: 'owner', destructive: true, timeoutMs: 30000 }
});

const ADAPTER_ERROR_CODES = Object.freeze([
  'ADAPTER_UNAVAILABLE', 'CAPABILITY_UNSUPPORTED', 'ACCESS_DENIED', 'AUTH_FAILED', 'CONNECTION_FAILED',
  'TIMEOUT', 'RATE_LIMITED', 'INVALID_REQUEST', 'INVALID_RESPONSE', 'ACTION_REJECTED',
  'SECURITY_POLICY', 'CANCELLED', 'INTERNAL'
]);
const ERROR_CODE_SET = new Set(ADAPTER_ERROR_CODES);

function cleanText(value, max = 200, fallback = '') {
  const text = String(value ?? '').replace(/\u0000/g, '').trim();
  return (text || fallback).slice(0, max);
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

function clockMilliseconds(clock) {
  const value = typeof clock === 'function' ? clock() : Date.now();
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) ? milliseconds : Date.now();
}

function redactAdapterValue(value, explicitSecrets = [], depth = 0, seen = new WeakSet()) {
  if (depth > 32) return '[MAX_DEPTH]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactText(value, explicitSecrets);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (Buffer.isBuffer(value)) return { type: 'Buffer', byteLength: value.length };
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => redactAdapterValue(item, explicitSecrets, depth + 1, seen));
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      const safeKey = cleanText(key, 120, 'field');
      result[safeKey] = SENSITIVE_FIELD_PATTERN.test(key)
        ? (item ? '[REDACTED]' : item)
        : redactAdapterValue(item, explicitSecrets, depth + 1, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function normalizeCapabilityId(value) {
  const id = cleanText(value, 100).toLowerCase();
  if (!CAPABILITY_ID_PATTERN.test(id)) throw new Error(`Invalid game-adapter capability ID: ${value}`);
  return id;
}

function normalizeAdapterId(value) {
  const id = cleanText(value, 80).toLowerCase();
  if (!ADAPTER_ID_PATTERN.test(id)) throw new Error(`Invalid game-adapter ID: ${value}`);
  return id;
}

function roleAtLeast(role, requiredRole) {
  return (ROLE_RANK[role] ?? 0) >= (ROLE_RANK[requiredRole] ?? 0);
}

function normalizeCapabilityDefinition(idInput, input = true) {
  const id = normalizeCapabilityId(idInput);
  const coreDefaults = CORE_CAPABILITY_DEFINITIONS[id] || null;
  const defaults = coreDefaults || { requiredRole: 'viewer', destructive: false, timeoutMs: DEFAULT_TIMEOUT_MS };
  const source = input && typeof input === 'object' ? input : {};
  const supported = input !== false && source.supported !== false;
  const hasRole = Object.prototype.hasOwnProperty.call(source, 'requiredRole');
  const hasDestructive = Object.prototype.hasOwnProperty.call(source, 'destructive');
  if (hasRole && !Object.prototype.hasOwnProperty.call(ROLE_RANK, source.requiredRole)) {
    throw new Error(`Invalid required role for game-adapter capability ${id}: ${source.requiredRole}`);
  }
  if (!coreDefaults && supported && (!hasRole || !hasDestructive)) {
    throw new Error(`Custom game-adapter capability ${id} must declare requiredRole and destructive.`);
  }
  return {
    id,
    supported,
    requiredRole: hasRole ? source.requiredRole : defaults.requiredRole,
    destructive: hasDestructive ? Boolean(source.destructive) : Boolean(defaults.destructive),
    timeoutMs: clamp(source.timeoutMs, 250, 300000, defaults.timeoutMs || DEFAULT_TIMEOUT_MS),
    supportsDryRun: Boolean(source.supportsDryRun),
    description: cleanText(source.description, 500)
  };
}

function normalizeCapabilities(input = {}) {
  const entries = Array.isArray(input) ? input.map((id) => [id, true]) : Object.entries(input && typeof input === 'object' ? input : {});
  const result = {};
  for (const [id, value] of entries) {
    const normalized = normalizeCapabilityDefinition(id, value);
    if (result[normalized.id]) throw new Error(`Duplicate game-adapter capability: ${normalized.id}`);
    result[normalized.id] = Object.freeze(normalized);
  }
  return result;
}

function normalizeCapabilityManifest(input = {}) {
  const adapterId = normalizeAdapterId(input.adapterId || input.id);
  const gameId = cleanText(input.gameId || input.game || 'generic', 60, 'generic').toLowerCase();
  const transport = cleanText(input.transport || 'unknown', 80, 'unknown').toLowerCase();
  const capabilities = normalizeCapabilities(input.capabilities || {});
  return Object.freeze({
    schemaVersion: ADAPTER_SCHEMA_VERSION,
    adapterId,
    gameId,
    displayName: cleanText(input.displayName || input.name, 100, adapterId),
    transport,
    adapterVersion: cleanText(input.adapterVersion || input.version || '1.0.0', 40, '1.0.0'),
    serverVersion: cleanText(input.serverVersion, 80),
    capabilities: Object.freeze(capabilities),
    metadata: Object.freeze(redactAdapterValue(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}))
  });
}

class GameAdapterError extends Error {
  constructor(code, message, options = {}) {
    super(redactText(cleanText(message, 1200, 'Game adapter operation failed.'), options.explicitSecrets || []));
    this.name = 'GameAdapterError';
    this.code = ERROR_CODE_SET.has(code) ? code : 'INTERNAL';
    this.adapterId = cleanText(options.adapterId, 80);
    this.gameId = cleanText(options.gameId, 60);
    this.capability = cleanText(options.capability, 100);
    this.retryable = Boolean(options.retryable);
    this.status = Number.isFinite(Number(options.status)) ? Number(options.status) : null;
    this.details = redactAdapterValue(options.details && typeof options.details === 'object' ? options.details : {}, options.explicitSecrets || []);
    this.id = cleanText(options.id, 40) || errorFingerprint(`${this.code}\n${this.adapterId}\n${this.capability}\n${this.message}`);
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      code: this.code,
      message: this.message,
      adapterId: this.adapterId,
      gameId: this.gameId,
      capability: this.capability,
      retryable: this.retryable,
      status: this.status,
      details: this.details
    };
  }
}

function inferAdapterErrorCode(error) {
  if (ERROR_CODE_SET.has(error?.code)) return error.code;
  const status = Number(error?.status || error?.statusCode);
  const text = String(error?.message || error || '').toLowerCase();
  if (error?.name === 'AbortError' || /aborted|cancelled|canceled/.test(text)) return 'CANCELLED';
  if (status === 401 || status === 403 || /unauthori[sz]ed|authentication|invalid password|access denied/.test(text)) return 'AUTH_FAILED';
  if (status === 429 || /rate limit|too many requests/.test(text)) return 'RATE_LIMITED';
  if (/timed? out|timeout/.test(text)) return 'TIMEOUT';
  if (/unsupported|not available|not implemented/.test(text)) return 'CAPABILITY_UNSUPPORTED';
  if (/connect|econn|socket|network|dns|refused|unreachable/.test(text)) return 'CONNECTION_FAILED';
  if (/invalid request|required|malformed/.test(text)) return 'INVALID_REQUEST';
  return 'INTERNAL';
}

function normalizeAdapterError(error, context = {}) {
  const code = context.code || inferAdapterErrorCode(error);
  const existing = error instanceof GameAdapterError ? error : null;
  return new GameAdapterError(code, error?.message || error || 'Game adapter operation failed.', {
    id: existing?.id,
    adapterId: context.adapterId || existing?.adapterId,
    gameId: context.gameId || existing?.gameId,
    capability: context.capability || existing?.capability,
    retryable: context.retryable ?? existing?.retryable ?? ['CONNECTION_FAILED', 'TIMEOUT', 'RATE_LIMITED', 'ADAPTER_UNAVAILABLE'].includes(code),
    status: error?.status || error?.statusCode || existing?.status,
    details: { ...(existing?.details || {}), ...(context.details || {}) },
    explicitSecrets: context.explicitSecrets
  });
}

function capabilityFromManifest(manifestInput, capabilityInput) {
  const manifest = normalizeCapabilityManifest(manifestInput);
  const capability = normalizeCapabilityId(capabilityInput);
  const definition = manifest.capabilities[capability];
  if (!definition?.supported) {
    throw new GameAdapterError('CAPABILITY_UNSUPPORTED', `${manifest.displayName} does not support ${capability}.`, {
      adapterId: manifest.adapterId, gameId: manifest.gameId, capability
    });
  }
  return { manifest, capability, definition };
}

class BaseGameAdapter {
  constructor({ manifest, operations = {}, logger = null, now = null } = {}) {
    this.manifest = normalizeCapabilityManifest(manifest || {});
    this.operations = { ...operations };
    this.logger = logger;
    this.now = now || (() => Date.now());
  }

  capabilities() {
    return this.manifest;
  }

  supports(capability) {
    try { return Boolean(this.manifest.capabilities[normalizeCapabilityId(capability)]?.supported); }
    catch { return false; }
  }

  async executeCapability(capability, payload = {}, context = {}) {
    const operation = this.operations[capability];
    if (typeof operation !== 'function') {
      throw new GameAdapterError('CAPABILITY_UNSUPPORTED', `${this.manifest.displayName} has no operation handler for ${capability}.`, {
        adapterId: this.manifest.adapterId, gameId: this.manifest.gameId, capability
      });
    }
    return operation(payload, context);
  }
}

function adapterManifest(adapter) {
  const source = typeof adapter?.capabilities === 'function' ? adapter.capabilities() : adapter?.manifest;
  return normalizeCapabilityManifest(source || {});
}

async function withTimeout(operation, timeoutMs, context = {}) {
  const externalSignal = context.signal;
  if (externalSignal?.aborted) throw new GameAdapterError('CANCELLED', 'Game adapter operation was cancelled.');
  const controller = new AbortController();
  const abort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener?.('abort', abort, { once: true });
  let timer;
  let abortListener;
  try {
    const abortPromise = new Promise((_, reject) => {
      abortListener = () => reject(new GameAdapterError('CANCELLED', 'Game adapter operation was cancelled.'));
      controller.signal.addEventListener('abort', abortListener, { once: true });
    });
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      abortPromise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const timeoutError = new GameAdapterError('TIMEOUT', `Game adapter operation timed out after ${timeoutMs} ms.`, { retryable: true });
          reject(timeoutError);
          controller.abort(timeoutError);
        }, timeoutMs);
        timer.unref?.();
      })
    ]);
  } finally {
    clearTimeout(timer);
    if (abortListener) controller.signal.removeEventListener('abort', abortListener);
    externalSignal?.removeEventListener?.('abort', abort);
  }
}

async function executeAdapterOperation(adapter, capabilityInput, payload = {}, context = {}) {
  if (!adapter) throw new GameAdapterError('ADAPTER_UNAVAILABLE', 'No game adapter instance was supplied.');
  const manifest = adapterManifest(adapter);
  const { capability, definition } = capabilityFromManifest(manifest, capabilityInput);
  const role = context.role || 'viewer';
  if (!roleAtLeast(role, definition.requiredRole)) {
    throw new GameAdapterError('ACCESS_DENIED', `${capability} requires ${definition.requiredRole} access.`, {
      adapterId: manifest.adapterId, gameId: manifest.gameId, capability,
      details: { role, requiredRole: definition.requiredRole }
    });
  }
  if (context.dryRun && definition.destructive && !definition.supportsDryRun) {
    throw new GameAdapterError('SECURITY_POLICY', `${capability} does not support dry-run execution.`, {
      adapterId: manifest.adapterId, gameId: manifest.gameId, capability
    });
  }

  const requestId = cleanText(context.requestId, 80) || crypto.randomUUID();
  const startedAtMs = clockMilliseconds(context.now);
  const startedAt = new Date(startedAtMs).toISOString();
  const operationContext = {
    ...context,
    requestId,
    role,
    manifest,
    capability,
    definition,
    startedAt
  };

  try {
    const data = await withTimeout(async (signal) => {
      operationContext.signal = signal;
      if (typeof adapter.executeCapability === 'function') return adapter.executeCapability(capability, payload, operationContext);
      if (typeof adapter[capability] === 'function') return adapter[capability](payload, operationContext);
      throw new GameAdapterError('CAPABILITY_UNSUPPORTED', `${manifest.displayName} has no operation handler for ${capability}.`);
    }, context.timeoutMs ? clamp(context.timeoutMs, 250, 300000, definition.timeoutMs) : definition.timeoutMs, context);
    const finishedAtMs = clockMilliseconds(context.now);
    return {
      ok: true,
      schemaVersion: ADAPTER_SCHEMA_VERSION,
      requestId,
      adapterId: manifest.adapterId,
      gameId: manifest.gameId,
      capability,
      destructive: definition.destructive,
      startedAt,
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: Math.max(0, finishedAtMs - startedAtMs),
      data: redactAdapterValue(data, context.explicitSecrets || [])
    };
  } catch (error) {
    throw normalizeAdapterError(error, {
      adapterId: manifest.adapterId,
      gameId: manifest.gameId,
      capability,
      explicitSecrets: context.explicitSecrets,
      details: { requestId }
    });
  }
}

function normalizeAdapterDefinition(input = {}) {
  const manifest = normalizeCapabilityManifest(input.manifest || input);
  if (typeof input.factory !== 'function') throw new Error(`Game adapter ${manifest.adapterId} requires a factory function.`);
  return Object.freeze({ manifest, factory: input.factory });
}

class GameAdapterRegistry {
  constructor() {
    this.definitions = new Map();
  }

  register(input) {
    const definition = normalizeAdapterDefinition(input);
    if (this.definitions.has(definition.manifest.adapterId)) throw new Error(`Game adapter already registered: ${definition.manifest.adapterId}`);
    this.definitions.set(definition.manifest.adapterId, definition);
    return definition.manifest;
  }

  replace(input) {
    const definition = normalizeAdapterDefinition(input);
    this.definitions.set(definition.manifest.adapterId, definition);
    return definition.manifest;
  }

  unregister(adapterId) {
    return this.definitions.delete(normalizeAdapterId(adapterId));
  }

  has(adapterId) {
    try { return this.definitions.has(normalizeAdapterId(adapterId)); }
    catch { return false; }
  }

  list() {
    return [...this.definitions.values()].map((definition) => definition.manifest);
  }

  create(adapterId, context = {}) {
    const id = normalizeAdapterId(adapterId);
    const definition = this.definitions.get(id);
    if (!definition) throw new GameAdapterError('ADAPTER_UNAVAILABLE', `Game adapter is not registered: ${id}`, { adapterId: id });
    const adapter = definition.factory(context);
    const manifest = adapterManifest(adapter);
    if (manifest.adapterId !== id) throw new Error(`Game adapter factory returned ${manifest.adapterId}; expected ${id}.`);
    return adapter;
  }
}

function normalizeStatusResult(input = {}) {
  const status = ['online', 'offline', 'degraded', 'unknown'].includes(input.status) ? input.status : 'unknown';
  return {
    status,
    serverName: cleanText(input.serverName || input.name, 100, 'Unknown server'),
    version: cleanText(input.version, 80),
    players: Math.max(0, Number(input.players) || 0),
    maxPlayers: Math.max(0, Number(input.maxPlayers) || 0),
    uptimeSeconds: Math.max(0, Number(input.uptimeSeconds) || 0),
    checkedAt: input.checkedAt ? String(input.checkedAt) : new Date().toISOString(),
    metadata: redactAdapterValue(input.metadata && typeof input.metadata === 'object' ? input.metadata : {})
  };
}

function normalizePlayersResult(input = {}) {
  const source = Array.isArray(input) ? input : Array.isArray(input.players) ? input.players : [];
  return {
    players: source.slice(0, 500).map((player) => ({
      id: cleanText(typeof player === 'string' ? '' : player?.id || player?.userId || player?.playerId, 150),
      name: cleanText(typeof player === 'string' ? player : player?.name || player?.accountName, 100, 'Unknown'),
      ping: Number.isFinite(Number(player?.ping)) ? Number(player.ping) : null,
      metadata: redactAdapterValue(player?.metadata && typeof player.metadata === 'object' ? player.metadata : {})
    }))
  };
}

module.exports = {
  ADAPTER_SCHEMA_VERSION,
  ROLE_RANK,
  CORE_CAPABILITY_DEFINITIONS,
  ADAPTER_ERROR_CODES,
  GameAdapterError,
  BaseGameAdapter,
  GameAdapterRegistry,
  redactAdapterValue,
  normalizeCapabilityId,
  normalizeAdapterId,
  normalizeCapabilityDefinition,
  normalizeCapabilityManifest,
  normalizeAdapterDefinition,
  normalizeAdapterError,
  normalizeStatusResult,
  normalizePlayersResult,
  capabilityFromManifest,
  executeAdapterOperation,
  roleAtLeast
};
