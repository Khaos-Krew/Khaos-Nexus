'use strict';

const crypto = require('node:crypto');
const { redactText } = require('./redaction.cjs');

const AUDIT_SCHEMA_VERSION = 1;
const SENSITIVE_KEY_PATTERN = /password|token|secret|authorization|cookie|credential|private[_-]?key|rcon/i;
const VALID_OUTCOMES = new Set(['allowed', 'denied', 'requested', 'succeeded', 'failed', 'cancelled']);

function cleanText(value, max = 200, fallback = '') {
  const text = String(value ?? '').replace(/\u0000/g, '').trim();
  return (text || fallback).slice(0, max);
}

function sanitizeAuditValue(value, explicitSecrets = [], depth = 0, seen = new WeakSet()) {
  if (depth > 16) return '[MAX_DEPTH]';
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return redactText(value, explicitSecrets).slice(0, 2000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (Buffer.isBuffer(value)) return { type: 'Buffer', byteLength: value.length };
  if (typeof value !== 'object') return cleanText(value, 2000);
  if (seen.has(value)) return '[CIRCULAR]';

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.slice(0, 100).map((item) => sanitizeAuditValue(item, explicitSecrets, depth + 1, seen));
    }
    const result = {};
    for (const [rawKey, item] of Object.entries(value).slice(0, 100)) {
      const key = cleanText(rawKey, 120, 'field');
      result[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? (item ? '[REDACTED]' : item ?? null)
        : sanitizeAuditValue(item, explicitSecrets, depth + 1, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function normalizeActor(actor = {}) {
  return Object.freeze({
    type: cleanText(actor.type, 60, 'system'),
    id: cleanText(actor.id, 120) || null,
    name: cleanText(actor.name, 120) || null,
    role: cleanText(actor.role, 60) || null
  });
}

function createAuditEvent(input = {}) {
  const outcome = cleanText(input.outcome, 40, 'requested').toLowerCase();
  const event = {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    id: cleanText(input.id, 120) || crypto.randomUUID(),
    time: cleanText(input.time, 80) || new Date().toISOString(),
    source: cleanText(input.source, 80, 'sentinel'),
    category: cleanText(input.category, 80, 'operations'),
    action: cleanText(input.action, 160, 'unknown'),
    outcome: VALID_OUTCOMES.has(outcome) ? outcome : 'failed',
    actor: normalizeActor(input.actor),
    target: sanitizeAuditValue(input.target && typeof input.target === 'object' ? input.target : {}, input.explicitSecrets || []),
    metadata: sanitizeAuditValue(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}, input.explicitSecrets || [])
  };
  return Object.freeze(event);
}

function permissionAuditEvent({ decision, interaction, guildId, explicitSecrets = [], id, time } = {}) {
  return createAuditEvent({
    id,
    time,
    source: 'sentinel-discord',
    category: 'access',
    action: `discord.command.${cleanText(decision?.command, 100, 'unknown')}`,
    outcome: decision?.allowed ? 'allowed' : 'denied',
    actor: {
      type: 'discord-user',
      id: interaction?.user?.id,
      name: interaction?.user?.globalName || interaction?.user?.username,
      role: decision?.principal
    },
    target: {
      guildId: guildId || interaction?.guildId || null,
      channelId: interaction?.channelId || null
    },
    metadata: {
      permissionCode: decision?.code || 'UNKNOWN',
      requiredRole: decision?.requiredRole || null
    },
    explicitSecrets
  });
}

function automationActorRole(role) {
  if (role === 'owner') return 'owner';
  if (role === 'administrator') return 'operator';
  if (role === 'operator') return 'operator';
  return 'viewer';
}

function automationOutcome(outcome) {
  if (outcome === 'denied' || outcome === 'cancelled') return 'blocked';
  if (outcome === 'failed') return 'failed';
  return 'success';
}

function toDiscordAutomationAuditEntry(eventInput = {}) {
  const event = eventInput?.schemaVersion === AUDIT_SCHEMA_VERSION ? eventInput : createAuditEvent(eventInput);
  const targetId = cleanText(event.target?.serverId || event.target?.guildId || event.target?.channelId, 100);
  const targetName = cleanText(event.target?.name || event.target?.serverName, 120, event.action);
  return {
    id: event.id,
    time: event.time,
    category: event.category,
    action: event.action,
    outcome: automationOutcome(event.outcome),
    actorId: cleanText(event.actor?.id, 120),
    actorName: cleanText(event.actor?.name || event.actor?.id, 100, 'Sentinel'),
    actorRole: automationActorRole(event.actor?.role),
    targetType: event.category === 'access' ? 'discord-command' : cleanText(event.category, 50, 'sentinel'),
    targetId,
    targetName,
    summary: cleanText(`${event.action} ${event.outcome}.`, 500),
    details: sanitizeAuditValue({
      auditSchemaVersion: event.schemaVersion,
      auditSource: event.source,
      target: event.target,
      metadata: event.metadata
    })
  };
}

module.exports = {
  AUDIT_SCHEMA_VERSION,
  SENSITIVE_KEY_PATTERN,
  sanitizeAuditValue,
  createAuditEvent,
  permissionAuditEvent,
  toDiscordAutomationAuditEntry
};
