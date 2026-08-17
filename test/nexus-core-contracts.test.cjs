'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CONTRACT_VERSION,
  makeEvent,
  makeAction,
  makeResult
} = require('../shared/nexus-core/contracts.cjs');

const BASE = Object.freeze({
  scope: { kind: 'server', id: 'rag-01' },
  actor: { kind: 'discord-user', id: '1234567890' },
  source: { kind: 'desktop', id: 'khaos-nexus' },
  correlationId: 'corr-001'
});

test('Nexus Core event envelopes are normalized and deeply immutable', () => {
  const payload = { server: { status: 'online' }, players: ['A', 'B'] };
  const event = makeEvent({
    eventId: 'evt-001',
    type: 'server.status.changed',
    occurredAt: '2026-08-11T06:00:00Z',
    ...BASE,
    payload
  });

  assert.equal(event.schemaVersion, CONTRACT_VERSION);
  assert.equal(event.occurredAt, '2026-08-11T06:00:00.000Z');
  assert.equal(event.causationId, null);
  assert.equal(Object.isFrozen(event), true);
  assert.equal(Object.isFrozen(event.payload.server), true);

  payload.server.status = 'mutated';
  assert.equal(event.payload.server.status, 'online');
  assert.throws(() => { event.payload.players.push('C'); }, TypeError);
});

test('Nexus Core action envelopes require stable operation and idempotency identifiers', () => {
  const action = makeAction({
    operationId: 'op-restart-001',
    action: 'ark.server.restart',
    requestedAt: '2026-08-11T06:01:00Z',
    ...BASE,
    idempotencyKey: 'restart-rag-01-20260811T060100Z',
    requiredCapabilities: ['ark.restart', 'server.write', 'ark.restart'],
    input: { warningMinutes: 10 }
  });

  assert.deepEqual(action.requiredCapabilities, ['ark.restart', 'server.write']);
  assert.equal(action.idempotencyKey, 'restart-rag-01-20260811T060100Z');
  assert.equal(Object.isFrozen(action.input), true);

  assert.throws(() => makeAction({
    action: 'ark.server.restart',
    requestedAt: '2026-08-11T06:01:00Z',
    ...BASE,
    idempotencyKey: 'restart-rag-01-20260811T060100Z'
  }), /operationId/);

  assert.throws(() => makeAction({
    operationId: 'op-restart-002',
    action: 'ark.server.restart',
    requestedAt: '2026-08-11T06:01:00Z',
    ...BASE,
    idempotencyKey: 'restart-rag-01-20260811T060100Z',
    requiredCapabilities: ['ARK RESTART']
  }), /Invalid capability/);
});

test('Nexus Core contracts reject non-JSON or ambiguous payload values', () => {
  assert.throws(() => makeEvent({
    eventId: 'evt-002',
    type: 'test.invalid',
    occurredAt: '2026-08-11T06:02:00Z',
    ...BASE,
    payload: { unsafe: undefined }
  }), /cannot be undefined/);

  assert.throws(() => makeEvent({
    eventId: 'evt-003',
    type: 'test.invalid',
    occurredAt: 'not-a-date',
    ...BASE
  }), /occurredAt/);
});

test('Nexus Core result envelopes preserve the operation correlation chain', () => {
  const result = makeResult({
    operationId: 'op-restart-001',
    completedAt: '2026-08-11T06:03:00Z',
    correlationId: 'corr-001',
    status: 'succeeded',
    output: { verifiedOnline: true }
  });

  assert.equal(result.operationId, 'op-restart-001');
  assert.equal(result.correlationId, 'corr-001');
  assert.equal(result.status, 'succeeded');
  assert.equal(result.error, null);
  assert.equal(Object.isFrozen(result), true);

  assert.throws(() => makeResult({
    operationId: 'op-restart-001',
    completedAt: '2026-08-11T06:03:00Z',
    correlationId: 'corr-001',
    status: 'maybe'
  }), /status must be/);
});
