'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AuditStore } = require('../src/sentinel-v2/audit-store.cjs');
const { ActionStore, serializeError } = require('../src/sentinel-v2/action-store.cjs');

function actionRow(overrides = {}) {
  return {
    action_id: '11111111-1111-4111-8111-111111111111',
    capability: 'ark.restart',
    source: 'test',
    actor: 'owner',
    subject: 'map1',
    destructive: true,
    status: 'approval-required',
    requested_at: new Date('2026-09-09T16:00:00Z'),
    completed_at: null,
    idempotency_key: 'restart-map1-1',
    correlation_id: 'corr-1',
    request: { reason: 'test' },
    result: null,
    ...overrides,
  };
}

test('AuditStore rejects empty audit action', async () => {
  const store = new AuditStore();
  await assert.rejects(() => store.append({}), /audit action is required/);
});

test('AuditStore degrades safely when database is not configured', async () => {
  const store = new AuditStore();
  const result = await store.append({ action: 'sentinel.test', actor: 'owner', details: { ok: true } });
  assert.equal(result.persisted, false);
  assert.equal(result.action, 'sentinel.test');
});

test('ActionStore requires capability and source', async () => {
  const store = new ActionStore();
  await assert.rejects(() => store.request({ source: 'test' }), /capability is required/);
  await assert.rejects(() => store.request({ capability: 'ark.restart' }), /source is required/);
});

test('ActionStore marks destructive offline requests as approval-required and audits them', async () => {
  const audited = [];
  const auditStore = { async append(entry) { audited.push(entry); return { ...entry, persisted: false }; } };
  const store = new ActionStore({ auditStore });
  const result = await store.request({
    actionId: '11111111-1111-4111-8111-111111111111',
    capability: 'ark.restart',
    source: 'test',
    actor: 'owner',
    subject: 'map1',
    destructive: true,
  });
  assert.equal(result.status, 'approval-required');
  assert.equal(result.persisted, false);
  assert.equal(audited.length, 1);
  assert.equal(audited[0].action, 'sentinel.action.requested');
});

test('ActionStore persists a destructive request, pending approval, and audit atomically', async () => {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      queries.push({ sql: String(sql), params });
      if (String(sql).includes('INSERT INTO sentinel_actions')) return { rows: [actionRow()] };
      return { rows: [] };
    },
  };
  const database = {
    enabled: true,
    async withClient(callback) { return callback(client); },
  };
  const store = new ActionStore({ database });
  const result = await store.request({
    actionId: '11111111-1111-4111-8111-111111111111',
    capability: 'ark.restart',
    source: 'test',
    actor: 'owner',
    subject: 'map1',
    destructive: true,
    idempotencyKey: 'restart-map1-1',
    correlationId: 'corr-1',
    request: { reason: 'test' },
  });

  assert.equal(result.persisted, true);
  assert.equal(result.status, 'approval-required');
  assert.ok(queries.some(({ sql }) => sql.includes("INSERT INTO sentinel_approvals")));
  assert.ok(queries.some(({ sql }) => sql.includes('INSERT INTO sentinel_audit_log')));
  assert.equal(queries[0].sql, 'BEGIN');
  assert.equal(queries.at(-1).sql, 'COMMIT');
});

test('serializeError strips Error objects to durable fields', () => {
  const error = Object.assign(new Error('boom'), { code: 'E_TEST' });
  assert.deepEqual(serializeError(error), { name: 'Error', message: 'boom', code: 'E_TEST' });
});
