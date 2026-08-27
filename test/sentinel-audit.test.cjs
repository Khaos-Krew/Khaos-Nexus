'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AUDIT_SCHEMA_VERSION,
  sanitizeAuditValue,
  createAuditEvent,
  permissionAuditEvent,
  toDiscordAutomationAuditEntry
} = require('../shared/sentinel-audit.cjs');

test('audit values redact sensitive keys and explicit secrets recursively', () => {
  const sanitized = sanitizeAuditValue({
    password: 'do-not-log',
    nested: {
      token: 'also-secret',
      message: 'connected with top-secret-value'
    },
    safe: 'visible'
  }, ['top-secret-value']);

  assert.equal(sanitized.password, '[REDACTED]');
  assert.equal(sanitized.nested.token, '[REDACTED]');
  assert.equal(sanitized.safe, 'visible');
  assert.equal(JSON.stringify(sanitized).includes('top-secret-value'), false);
});

test('audit event produces a stable safe envelope', () => {
  const event = createAuditEvent({
    id: 'audit-1',
    time: '2026-08-27T00:00:00.000Z',
    source: 'sentinel-test',
    category: 'operations',
    action: 'server.save',
    outcome: 'succeeded',
    actor: { type: 'discord-user', id: '123', role: 'administrator' },
    target: { server: 'Ragnarok' },
    metadata: { authorization: 'Bearer private', detail: 'safe' }
  });

  assert.equal(event.schemaVersion, AUDIT_SCHEMA_VERSION);
  assert.equal(event.id, 'audit-1');
  assert.equal(event.action, 'server.save');
  assert.equal(event.outcome, 'succeeded');
  assert.equal(event.actor.role, 'administrator');
  assert.equal(event.metadata.authorization, '[REDACTED]');
  assert.equal(event.metadata.detail, 'safe');
  assert.equal(Object.isFrozen(event), true);
});

test('invalid audit outcomes fail closed as failed', () => {
  const event = createAuditEvent({
    id: 'audit-2',
    time: '2026-08-27T00:00:00.000Z',
    action: 'test.action',
    outcome: 'something-unexpected'
  });
  assert.equal(event.outcome, 'failed');
});

test('permission audit events contain access context without permission-policy secrets', () => {
  const event = permissionAuditEvent({
    id: 'audit-3',
    time: '2026-08-27T00:00:00.000Z',
    interaction: {
      user: { id: '555', username: 'Operator' },
      guildId: '777',
      channelId: '999'
    },
    decision: {
      command: 'rcon',
      allowed: false,
      principal: 'administrator',
      requiredRole: 'owner',
      code: 'ACCESS_DENIED'
    }
  });

  assert.equal(event.category, 'access');
  assert.equal(event.action, 'discord.command.rcon');
  assert.equal(event.outcome, 'denied');
  assert.deepEqual(event.actor, { type: 'discord-user', id: '555', name: 'Operator', role: 'administrator' });
  assert.deepEqual(event.target, { guildId: '777', channelId: '999' });
  assert.deepEqual(event.metadata, { permissionCode: 'ACCESS_DENIED', requiredRole: 'owner' });
});

test('structured audit events bridge into the existing Discord automation audit contract', () => {
  const event = permissionAuditEvent({
    id: 'audit-4',
    time: '2026-08-27T00:00:00.000Z',
    interaction: {
      user: { id: '555', username: 'Operator' },
      guildId: '777',
      channelId: '999'
    },
    decision: {
      command: 'forcestop',
      allowed: false,
      principal: 'administrator',
      requiredRole: 'owner',
      code: 'ACCESS_DENIED'
    }
  });
  const bridged = toDiscordAutomationAuditEntry(event);

  assert.equal(bridged.id, 'audit-4');
  assert.equal(bridged.category, 'access');
  assert.equal(bridged.action, 'discord.command.forcestop');
  assert.equal(bridged.outcome, 'blocked');
  assert.equal(bridged.actorId, '555');
  assert.equal(bridged.actorName, 'Operator');
  assert.equal(bridged.actorRole, 'operator');
  assert.equal(bridged.targetType, 'discord-command');
  assert.equal(bridged.targetId, '777');
  assert.equal(bridged.details.metadata.requiredRole, 'owner');
});
