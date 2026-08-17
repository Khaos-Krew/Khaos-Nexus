'use strict';

const crypto = require('node:crypto');

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'secret',
  'apikey',
  'authorization',
  'cookie',
  'credential',
  'credentials',
  'privatekey',
  'rconpassword',
  'discordtoken',
  'githubtoken',
  'openaiapikey'
]);

function contextError(message, code = 'NEXUS_CONTEXT_INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function cleanToken(value, field) {
  const text = String(value || '').trim();
  if (!text || text.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(text)) {
    throw contextError(`${field} must be a stable token.`);
  }
  return text;
}

function sanitizeContext(value, trail = 'context') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw contextError(`${trail} contains a non-finite number.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => sanitizeContext(entry, `${trail}[${index}]`));
  if (!value || typeof value !== 'object') throw contextError(`${trail} must contain only JSON-compatible values.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw contextError(`${trail} must contain only plain objects.`);

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) throw contextError(`${trail}.${key} cannot be undefined.`);
    if (SENSITIVE_KEYS.has(normalizeKey(key))) {
      output[key] = '[REDACTED]';
      continue;
    }
    output[key] = sanitizeContext(entry, `${trail}.${key}`);
  }
  return output;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeScope(scope, index = 0) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) throw contextError(`scopes[${index}] is required.`);
  return Object.freeze({
    kind: cleanToken(scope.kind, `scopes[${index}].kind`),
    id: cleanToken(scope.id, `scopes[${index}].id`)
  });
}

class ContextBroker {
  constructor(options = {}) {
    this.journal = options.journal || null;
    this.now = options.now || (() => new Date().toISOString());
    this.idFactory = options.idFactory || (() => crypto.randomUUID());
    this.providers = new Map();
    this.workers = new Map();
  }

  registerProvider(scopeKind, provider) {
    const kind = cleanToken(scopeKind, 'scopeKind');
    if (typeof provider !== 'function') throw contextError(`${kind} provider must be a function.`);
    if (this.providers.has(kind)) throw contextError(`Context provider ${kind} is already registered.`, 'NEXUS_CONTEXT_PROVIDER_EXISTS');
    this.providers.set(kind, provider);
    return this;
  }

  registerWorker(workerId, policy = {}) {
    const id = cleanToken(workerId, 'workerId');
    if (this.workers.has(id)) throw contextError(`Context policy for ${id} already exists.`, 'NEXUS_CONTEXT_WORKER_EXISTS');
    const allowed = [...new Set((policy.allowedScopeKinds || []).map((kind) => cleanToken(kind, 'allowedScopeKinds')))].sort();
    const denied = [...new Set((policy.deniedScopeKinds || []).map((kind) => cleanToken(kind, 'deniedScopeKinds')))].sort();
    const maxScopes = Math.max(1, Math.min(32, Number(policy.maxScopes || 8)));
    this.workers.set(id, Object.freeze({
      allowedScopeKinds: Object.freeze(allowed),
      deniedScopeKinds: Object.freeze(denied),
      maxScopes
    }));
    return this;
  }

  audit(type, workerId, request, scopes, payload = {}) {
    if (!this.journal?.append) return null;
    const requestId = cleanToken(request.requestId || request.correlationId || `ctx-${this.idFactory()}`, 'requestId');
    const correlationId = cleanToken(request.correlationId || requestId, 'correlationId');
    return this.journal.append({
      eventId: `evt-${this.idFactory()}`,
      type,
      occurredAt: this.now(),
      scope: { kind: 'context-request', id: requestId },
      actor: request.actor || { kind: 'system', id: 'nexus-core' },
      source: { kind: 'worker', id: workerId },
      correlationId,
      causationId: requestId,
      payload: {
        workerId,
        scopes: scopes.map((scope) => ({ kind: scope.kind, id: scope.id })),
        ...payload
      }
    });
  }

  deny(workerId, request, scopes, reason, detail) {
    this.audit('core.context.denied', workerId, request, scopes, { reason, detail: String(detail || '').slice(0, 500) });
    throw contextError(String(detail || 'Context request denied.'), 'NEXUS_CONTEXT_DENIED');
  }

  async resolve(workerIdInput, request = {}) {
    const workerId = cleanToken(workerIdInput, 'workerId');
    const policy = this.workers.get(workerId);
    if (!policy) throw contextError(`No context policy is registered for ${workerId}.`, 'NEXUS_CONTEXT_WORKER_UNKNOWN');

    const rawScopes = Array.isArray(request.scopes) ? request.scopes : [];
    if (!rawScopes.length) this.deny(workerId, request, [], 'empty-scope', 'At least one context scope is required.');
    const scopes = rawScopes.map(normalizeScope);
    const unique = new Map(scopes.map((scope) => [`${scope.kind}:${scope.id}`, scope]));
    const requestedScopes = [...unique.values()];
    if (requestedScopes.length > policy.maxScopes) {
      this.deny(workerId, request, requestedScopes, 'scope-limit', `Context request exceeds the ${policy.maxScopes}-scope limit.`);
    }

    const allowed = new Set(policy.allowedScopeKinds);
    const denied = new Set(policy.deniedScopeKinds);
    for (const scope of requestedScopes) {
      if (denied.has(scope.kind) || !allowed.has(scope.kind)) {
        this.deny(workerId, request, requestedScopes, 'scope-not-authorized', `${workerId} is not authorized for ${scope.kind} context.`);
      }
      if (!this.providers.has(scope.kind)) {
        this.deny(workerId, request, requestedScopes, 'provider-unavailable', `No context provider is registered for ${scope.kind}.`);
      }
    }

    const resolved = [];
    for (const scope of requestedScopes) {
      const raw = await this.providers.get(scope.kind)(scope, {
        workerId,
        requestId: request.requestId || null,
        correlationId: request.correlationId || request.requestId || null
      });
      resolved.push(Object.freeze({
        scope,
        data: deepFreeze(sanitizeContext(raw ?? {}, `${scope.kind}:${scope.id}`))
      }));
    }

    this.audit('core.context.granted', workerId, request, requestedScopes, { count: resolved.length });
    return deepFreeze({
      workerId,
      requestId: String(request.requestId || ''),
      correlationId: String(request.correlationId || request.requestId || ''),
      contexts: resolved
    });
  }
}

module.exports = {
  ContextBroker,
  sanitizeContext,
  SENSITIVE_KEYS
};
