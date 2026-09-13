'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ActionStore } = require('../src/sentinel-v2/action-store.cjs');

function actionRow(status = 'running') {
  return { action_id: 'action_abc123', capability: 'economy.purchase.execute', source: 'sentinel-v2-nexus-economy', actor: 'discord-user:123', subject: 'discord-user:123', destructive: false, status, requested_at: new Date('2026-09-12T12:00:00Z'), completed_at: null, idempotency_key: 'shop_order_123', correlation_id: 'discord_request_123', request: { payload: { fulfillment: 'rewards-ascended-item' } }, result: null };
}

function attemptRow() {
  return { attempt_id: 9, action_id: 'action_abc123', attempt: 1, started_at: new Date('2026-09-12T12:00:01Z'), finished_at: null, status: 'running', error: null };
}

test('claimRequested atomically transitions only requested work and persists one attempt', async () => {
  const calls = [];
  const database = { enabled: true, withClient: async (fn) => fn({ query: async (sql, params) => {
    calls.push({ sql: String(sql), params });
    if (String(sql).includes('UPDATE sentinel_actions')) return { rows: [actionRow()] };
    if (String(sql).includes('INSERT INTO sentinel_action_attempts')) return { rows: [attemptRow()] };
    return { rows: [] };
  } }) };
  const result = await new ActionStore({ database }).claimRequested('action_abc123', 1);
  assert.equal(result.claimed, true); assert.equal(result.persisted, true); assert.equal(result.status, 'running'); assert.equal(result.action.status, 'running');
  const update = calls.find((call) => call.sql.includes('UPDATE sentinel_actions'));
  assert.match(update.sql, /status = 'requested'/); assert.equal(calls.filter((call) => call.sql === 'BEGIN').length, 1); assert.equal(calls.filter((call) => call.sql === 'COMMIT').length, 1);
});

test('claimRequested loses races safely without inserting an attempt', async () => {
  const calls = [];
  const database = { enabled: true, withClient: async (fn) => fn({ query: async (sql) => {
    calls.push(String(sql));
    if (String(sql).includes('UPDATE sentinel_actions')) return { rows: [] };
    return { rows: [] };
  } }) };
  const result = await new ActionStore({ database }).claimRequested('action_abc123', 1);
  assert.equal(result.claimed, false); assert.equal(result.persisted, true); assert.equal(result.status, 'not-claimed');
  assert.equal(calls.some((sql) => sql.includes('INSERT INTO sentinel_action_attempts')), false); assert.equal(calls.filter((sql) => sql === 'ROLLBACK').length, 1);
});

test('claimRequested fails closed if the attempt row already exists', async () => {
  const calls = [];
  const database = { enabled: true, withClient: async (fn) => fn({ query: async (sql) => {
    calls.push(String(sql));
    if (String(sql).includes('UPDATE sentinel_actions')) return { rows: [actionRow()] };
    if (String(sql).includes('INSERT INTO sentinel_action_attempts')) return { rows: [] };
    return { rows: [] };
  } }) };
  await assert.rejects(() => new ActionStore({ database }).claimRequested('action_abc123', 1), /attempt already exists/);
  assert.equal(calls.filter((sql) => sql === 'ROLLBACK').length, 1);
});
