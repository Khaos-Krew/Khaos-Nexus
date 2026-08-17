'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FileEventJournal } = require('../shared/nexus-core/event-journal.cjs');
const { FileOperationStore } = require('../shared/nexus-core/operation-store.cjs');
const { CommandGateway } = require('../shared/nexus-core/command-gateway.cjs');

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-nexus-gateway-'));
  let id = 0;
  const journal = new FileEventJournal({ filePath: path.join(root, 'events.ndjson'), fsync: false });
  const operationStore = new FileOperationStore({ directory: path.join(root, 'operations') });
  const gateway = new CommandGateway({
    journal,
    operationStore,
    now: () => '2026-08-11T06:20:00.000Z',
    idFactory: () => `test-${++id}`
  });
  return { root, journal, operationStore, gateway };
}

function action(overrides = {}) {
  return {
    operationId: overrides.operationId || 'op-001',
    action: overrides.action || 'game.server.restart',
    requestedAt: '2026-08-11T06:19:00Z',
    scope: overrides.scope || { kind: 'server', id: 'rag-01' },
    actor: overrides.actor || { kind: 'discord-user', id: '1234' },
    source: overrides.source || { kind: 'desktop', id: 'khaos-nexus' },
    correlationId: overrides.correlationId || 'corr-001',
    idempotencyKey: overrides.idempotencyKey || 'restart-rag-01-window-001',
    requiredCapabilities: overrides.requiredCapabilities || [],
    input: overrides.input || { warningMinutes: 10 }
  };
}

test('command gateway authorizes, executes, verifies, and journals a guarded action', async () => {
  const { gateway, journal, operationStore } = harness();
  let executions = 0;
  let verifications = 0;
  gateway.register('game.server.restart', {
    requiredCapabilities: ['game.server.restart'],
    execute: async (request) => {
      executions += 1;
      return { restarted: request.scope.id };
    },
    verify: async (output) => {
      verifications += 1;
      return output.restarted === 'rag-01';
    }
  });

  const result = await gateway.dispatch(action(), { role: 'operator' });
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.output, { restarted: 'rag-01' });
  assert.equal(executions, 1);
  assert.equal(verifications, 1);
  assert.equal(operationStore.read('restart-rag-01-window-001').resultStatus, 'succeeded');
  assert.deepEqual(
    journal.list({ correlationId: 'corr-001' }).map((record) => record.event.type),
    ['core.action.requested', 'core.action.succeeded']
  );
});

test('same idempotency key cannot execute a destructive action twice', async () => {
  const { gateway, journal } = harness();
  let executions = 0;
  gateway.register('game.server.restart', {
    requiredCapabilities: ['game.server.restart'],
    execute: async () => {
      executions += 1;
      return { ok: true };
    }
  });

  const first = await gateway.dispatch(action(), { role: 'operator' });
  const second = await gateway.dispatch(action({ operationId: 'op-002' }), { role: 'operator' });

  assert.equal(first.status, 'succeeded');
  assert.equal(second.status, 'duplicate');
  assert.equal(second.output.originalOperationId, 'op-001');
  assert.equal(second.output.originalResultStatus, 'succeeded');
  assert.equal(executions, 1);
  assert.equal(journal.list({ type: 'core.action.duplicate' }).length, 1);
});

test('capability denial happens before operation acquisition or executor invocation', async () => {
  const { gateway, root, journal } = harness();
  let executions = 0;
  gateway.register('game.server.restart', {
    requiredCapabilities: ['game.server.restart'],
    execute: async () => {
      executions += 1;
      return { ok: true };
    }
  });

  const result = await gateway.dispatch(action(), { role: 'viewer' });
  assert.equal(result.status, 'denied');
  assert.equal(result.error.code, 'NEXUS_CAPABILITY_DENIED');
  assert.equal(executions, 0);
  assert.equal(fs.existsSync(path.join(root, 'operations')), false);
  assert.deepEqual(
    journal.list({ correlationId: 'corr-001' }).map((record) => record.event.type),
    ['core.action.requested', 'core.action.denied']
  );
});

test('runtime deny overrides owner role before execution', async () => {
  const { gateway } = harness();
  let executions = 0;
  gateway.register('game.server.restart', {
    requiredCapabilities: ['game.server.restart'],
    execute: async () => {
      executions += 1;
      return { ok: true };
    }
  });

  const result = await gateway.dispatch(action(), {
    role: 'owner',
    deniedCapabilities: ['game.server.restart']
  });
  assert.equal(result.status, 'denied');
  assert.equal(executions, 0);
});

test('verification failures are completed as failed and remain idempotently blocked', async () => {
  const { gateway, operationStore } = harness();
  let executions = 0;
  gateway.register('game.server.restart', {
    requiredCapabilities: ['game.server.restart'],
    execute: async () => {
      executions += 1;
      return { restarted: false };
    },
    verify: async () => false
  });

  const failed = await gateway.dispatch(action(), { role: 'operator' });
  const duplicate = await gateway.dispatch(action({ operationId: 'op-retry' }), { role: 'operator' });

  assert.equal(failed.status, 'failed');
  assert.equal(failed.error.code, 'NEXUS_ACTION_VERIFICATION_FAILED');
  assert.equal(operationStore.read('restart-rag-01-window-001').resultStatus, 'failed');
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(executions, 1);
});

test('registered executor capability requirements are authoritative even when caller declares none', async () => {
  const { gateway } = harness();
  gateway.register('game.server.restart', {
    requiredCapabilities: ['game.server.restart'],
    execute: async () => ({ ok: true })
  });

  const result = await gateway.dispatch(action({ requiredCapabilities: [] }), { role: 'viewer' });
  assert.equal(result.status, 'denied');
  assert.match(result.error.message, /game\.server\.restart/);
});

test('dynamic executor capability requirements cannot be weakened by the caller', async () => {
  const { gateway, journal } = harness();
  let executions = 0;
  gateway.register('game.server.operation', {
    requiredCapabilities: (request) => request.input.operation === 'save'
      ? ['game.server.save']
      : ['game.server.restart'],
    execute: async () => {
      executions += 1;
      return { ok: true };
    }
  });

  const request = action({
    action: 'game.server.operation',
    requiredCapabilities: [],
    input: { operation: 'save' }
  });
  const denied = await gateway.dispatch(request, { role: 'viewer' });
  assert.equal(denied.status, 'denied');
  assert.equal(executions, 0);
  assert.match(denied.error.message, /game\.server\.save/);

  const requested = journal.list({ type: 'core.action.requested' })[0];
  assert.deepEqual(requested.event.payload.requiredCapabilities, ['game.server.save']);
});
