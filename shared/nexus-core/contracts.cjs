'use strict';

const CONTRACT_VERSION = 1;
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const CAPABILITY_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/;

function fail(message) {
  const error = new TypeError(message);
  error.code = 'NEXUS_CORE_CONTRACT_INVALID';
  throw error;
}

function requiredToken(value, field) {
  const token = String(value || '').trim();
  if (!token || !TOKEN_PATTERN.test(token)) fail(`${field} must be a non-empty stable token.`);
  return token;
}

function optionalToken(value, field) {
  if (value === null || value === undefined || value === '') return null;
  return requiredToken(value, field);
}

function isoTimestamp(value, field) {
  const text = String(value || '').trim();
  const time = Date.parse(text);
  if (!text || !Number.isFinite(time)) fail(`${field} must be a valid ISO timestamp.`);
  return new Date(time).toISOString();
}

function jsonClone(value, path = 'value') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${path} must contain only finite JSON numbers.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => jsonClone(entry, `${path}[${index}]`));
  if (typeof value !== 'object') fail(`${path} must contain only JSON-compatible values.`);

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${path} must contain only plain JSON objects.`);

  const copy = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) fail(`${path}.${key} cannot be undefined.`);
    copy[key] = jsonClone(entry, `${path}.${key}`);
  }
  return copy;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function identity(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${field} is required.`);
  const result = {
    kind: requiredToken(value.kind, `${field}.kind`),
    id: optionalToken(value.id, `${field}.id`)
  };
  if (value.label !== undefined && value.label !== null && value.label !== '') result.label = String(value.label).slice(0, 200);
  return result;
}

function scope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('scope is required.');
  return {
    kind: requiredToken(value.kind, 'scope.kind'),
    id: requiredToken(value.id, 'scope.id')
  };
}

function capabilities(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail('requiredCapabilities must be an array.');
  return [...new Set(value.map((entry) => {
    const capability = String(entry || '').trim();
    if (!CAPABILITY_PATTERN.test(capability)) fail(`Invalid capability: ${capability || '(empty)'}.`);
    return capability;
  }))].sort();
}

function makeEvent(input = {}) {
  const event = {
    schemaVersion: CONTRACT_VERSION,
    eventId: requiredToken(input.eventId, 'eventId'),
    type: requiredToken(input.type, 'type'),
    occurredAt: isoTimestamp(input.occurredAt, 'occurredAt'),
    scope: scope(input.scope),
    actor: identity(input.actor, 'actor'),
    source: identity(input.source, 'source'),
    correlationId: requiredToken(input.correlationId, 'correlationId'),
    causationId: optionalToken(input.causationId, 'causationId'),
    payload: jsonClone(input.payload ?? {}, 'payload')
  };
  return deepFreeze(event);
}

function makeAction(input = {}) {
  const action = {
    schemaVersion: CONTRACT_VERSION,
    operationId: requiredToken(input.operationId, 'operationId'),
    action: requiredToken(input.action, 'action'),
    requestedAt: isoTimestamp(input.requestedAt, 'requestedAt'),
    scope: scope(input.scope),
    actor: identity(input.actor, 'actor'),
    source: identity(input.source, 'source'),
    correlationId: requiredToken(input.correlationId, 'correlationId'),
    idempotencyKey: requiredToken(input.idempotencyKey, 'idempotencyKey'),
    requiredCapabilities: capabilities(input.requiredCapabilities),
    input: jsonClone(input.input ?? {}, 'input')
  };
  return deepFreeze(action);
}

function makeResult(input = {}) {
  const status = String(input.status || '').trim();
  if (!['succeeded', 'failed', 'denied', 'cancelled', 'duplicate'].includes(status)) {
    fail('status must be succeeded, failed, denied, cancelled, or duplicate.');
  }
  const result = {
    schemaVersion: CONTRACT_VERSION,
    operationId: requiredToken(input.operationId, 'operationId'),
    completedAt: isoTimestamp(input.completedAt, 'completedAt'),
    correlationId: requiredToken(input.correlationId, 'correlationId'),
    status,
    output: jsonClone(input.output ?? {}, 'output'),
    error: input.error === null || input.error === undefined ? null : jsonClone(input.error, 'error')
  };
  return deepFreeze(result);
}

module.exports = {
  CONTRACT_VERSION,
  makeEvent,
  makeAction,
  makeResult
};
