'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DeadLetterStore,
  ProviderCircuitBreaker,
  ProviderResilience,
  serializeProviderError,
} = require('../src/sentinel-v2/provider-resilience.cjs');

test('provider circuit opens at threshold and blocks calls during cooldown', () => {
  let now = 1000;
  const breaker = new ProviderCircuitBreaker({ failureThreshold: 2, cooldownMs: 5000, clock: () => now });
  assert.equal(breaker.beforeCall('ark.sftp').allowed, true);
  assert.equal(breaker.failure('ark.sftp', new Error('one')).status, 'closed');
  assert.equal(breaker.failure('ark.sftp', new Error('two')).status, 'open');
  const blocked = breaker.beforeCall('ark.sftp');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, 'circuit-open');

  now += 5000;
  const probe = breaker.beforeCall('ark.sftp');
  assert.equal(probe.allowed, true);
  assert.equal(probe.reason, 'half-open-probe');
  assert.equal(breaker.beforeCall('ark.sftp').reason, 'half-open-probe-in-flight');
});

test('successful half-open probe closes and resets provider circuit', () => {
  let now = 0;
  const breaker = new ProviderCircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, clock: () => now });
  breaker.failure('ark.rcon', new Error('down'));
  now = 1000;
  assert.equal(breaker.beforeCall('ark.rcon').reason, 'half-open-probe');
  const state = breaker.success('ark.rcon');
  assert.equal(state.status, 'closed');
  assert.equal(state.failures, 0);
});

test('provider resilience quarantines the failure that opens a circuit', async () => {
  const quarantined = [];
  const resilience = new ProviderResilience({
    breaker: new ProviderCircuitBreaker({ failureThreshold: 2, cooldownMs: 10000 }),
    deadLetters: { async quarantine(input) { quarantined.push(input); return { ...input, persisted: false }; } },
  });

  const first = await resilience.execute({ provider: 'ark.sftp', operation: 'read-config', subject: 'gen1', run: async () => { throw new Error('fail-1'); } });
  assert.equal(first.ok, false);
  assert.equal(first.circuit.status, 'closed');
  assert.equal(quarantined.length, 0);

  const second = await resilience.execute({ provider: 'ark.sftp', operation: 'read-config', subject: 'gen1', correlationId: 'corr-2', run: async () => { throw new Error('fail-2'); } });
  assert.equal(second.ok, false);
  assert.equal(second.circuit.status, 'open');
  assert.equal(quarantined.length, 1);
  assert.equal(quarantined[0].attempts, 2);
  assert.equal(quarantined[0].correlationId, 'corr-2');
});

test('provider resilience returns an explicit blocked result without invoking provider', async () => {
  let called = false;
  const breaker = new ProviderCircuitBreaker({ failureThreshold: 1, cooldownMs: 60000 });
  breaker.failure('ark.api', new Error('down'));
  const resilience = new ProviderResilience({ breaker });
  const result = await resilience.execute({ provider: 'ark.api', operation: 'health', run: async () => { called = true; } });
  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
  assert.equal(result.error.code, 'SENTINEL_PROVIDER_CIRCUIT_OPEN');
  assert.equal(called, false);
});

test('dead-letter store degrades safely when Postgres is unavailable', async () => {
  const store = new DeadLetterStore();
  const result = await store.quarantine({ provider: 'ark.sftp', operation: 'read-config', error: Object.assign(new Error('boom'), { code: 'E_TEST' }) });
  assert.equal(result.persisted, false);
  assert.equal(result.status, 'quarantined');
  assert.deepEqual(result.error, { name: 'Error', message: 'boom', code: 'E_TEST' });
});

test('dead-letter acknowledgement is transactional and audit-recorded', async () => {
  const calls = [];
  const row = {
    dead_letter_id: 42,
    provider: 'ark.sftp',
    operation: 'read-config',
    subject: 'gen1',
    status: 'acknowledged',
    attempts: 3,
    correlation_id: 'corr-42',
    payload: {},
    error: { message: 'down' },
    first_failed_at: new Date('2026-09-09T20:00:00Z'),
    last_failed_at: new Date('2026-09-09T20:10:00Z'),
    resolved_at: new Date('2026-09-09T20:15:00Z'),
    resolved_by: 'owner',
    resolution_note: 'provider maintenance acknowledged',
  };
  const client = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes('UPDATE sentinel_dead_letters')) return { rows: [row] };
      return { rows: [] };
    },
  };
  const database = {
    enabled: true,
    async withClient(callback) { return callback(client); },
  };
  const store = new DeadLetterStore({ database });
  const result = await store.acknowledge(42, { actor: 'owner', reason: 'provider maintenance acknowledged' });

  assert.equal(result.status, 'acknowledged');
  assert.equal(result.resolvedBy, 'owner');
  assert.equal(calls[0].sql, 'BEGIN');
  assert.ok(calls.some(({ sql }) => sql.includes("sentinel.dead_letter.acknowledged")));
  assert.equal(calls.at(-1).sql, 'COMMIT');
});

test('dead-letter acknowledgement rejects already-resolved records without audit mutation', async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(String(sql));
      if (String(sql).includes('UPDATE sentinel_dead_letters')) return { rows: [] };
      if (String(sql).includes('SELECT status FROM sentinel_dead_letters')) return { rows: [{ status: 'acknowledged' }] };
      return { rows: [] };
    },
  };
  const database = { enabled: true, async withClient(callback) { return callback(client); } };
  const store = new DeadLetterStore({ database });

  await assert.rejects(
    () => store.acknowledge(42, { actor: 'owner', reason: 'duplicate' }),
    (error) => error.code === 'SENTINEL_DEAD_LETTER_NOT_QUARANTINED'
  );
  assert.ok(calls.includes('ROLLBACK'));
  assert.equal(calls.some((sql) => sql.includes("sentinel.dead_letter.acknowledged")), false);
});

test('provider error serialization excludes arbitrary error fields', () => {
  const error = Object.assign(new Error('boom'), { code: 'E_TEST', secret: 'do-not-store' });
  assert.deepEqual(serializeProviderError(error), { name: 'Error', message: 'boom', code: 'E_TEST' });
});
