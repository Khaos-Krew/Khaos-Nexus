'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getNexusCoreService } = require('../main/services/nexus-core-service.cjs');

test('one Nexus Core service is reused for the same desktop data root', () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-nexus-core-service-'));
  const first = getNexusCoreService({ dataDirectory });
  const second = getNexusCoreService({ dataDirectory: path.resolve(dataDirectory) });
  assert.equal(first, second);
  assert.equal(first.commandGateway, first.gateway);
});

test('different desktop data roots receive isolated Core authorities', () => {
  const first = getNexusCoreService({ dataDirectory: fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-nexus-core-a-')) });
  const second = getNexusCoreService({ dataDirectory: fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-nexus-core-b-')) });
  assert.notEqual(first, second);
  assert.notEqual(first.journal.filePath, second.journal.filePath);
});

test('Core registrations are idempotent at the service boundary', () => {
  const core = getNexusCoreService({ dataDirectory: fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-nexus-core-reg-')) });
  const definition = {
    requiredCapabilities: ['game.server.read'],
    execute: async () => ({ ok: true })
  };
  assert.equal(core.registerAction('test.read', definition), true);
  assert.equal(core.registerAction('test.read', definition), false);
  assert.equal(core.hasAction('test.read'), true);
  assert.equal(core.snapshot().actions, 1);
});

test('journal, context, tools, command execution, and workers share the same Core composition root', async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-nexus-core-shared-'));
  const core = getNexusCoreService({ dataDirectory });

  core.registerContextProvider('server', async (scope) => ({ id: scope.id, online: true }));
  core.registerWorker('sentinel-core-test', {
    allowedScopeKinds: ['server'],
    maxScopes: 1
  });
  core.registerAction('game.server.save', {
    requiredCapabilities: ['game.server.save'],
    execute: async () => ({ saved: true })
  });
  core.registerTool('server.save-test', {
    mode: 'execute',
    inputSchema: {
      type: 'object',
      required: ['serverId'],
      additionalProperties: false,
      properties: { serverId: { type: 'string', minLength: 1, maxLength: 100 } }
    },
    requiredCapabilities: ['game.server.save'],
    toAction: async ({ serverId }) => ({
      action: 'game.server.save',
      scope: { kind: 'server', id: serverId },
      idempotencyKey: `core-service-save:${serverId}`,
      input: { serverId }
    })
  });

  const context = await core.contextBroker.resolve('sentinel-core-test', {
    requestId: 'ctx-core-service-1',
    correlationId: 'corr-core-service',
    scopes: [{ kind: 'server', id: 'rag-01' }]
  });
  assert.equal(context.contexts[0].data.online, true);

  const result = await core.aiToolGateway.invoke({
    workerId: 'sentinel-core-test',
    tool: 'server.save-test',
    toolCallId: 'tool-core-service-1',
    correlationId: 'corr-core-service',
    args: { serverId: 'rag-01' }
  }, { role: 'operator' });
  assert.equal(result.status, 'succeeded');

  const snapshot = core.snapshot();
  assert.equal(snapshot.actions, 1);
  assert.equal(snapshot.tools, 1);
  assert.equal(snapshot.contextProviders, 1);
  assert.equal(snapshot.workers, 1);
  assert.ok(snapshot.journal.records >= 4);
  assert.ok(core.journal.list({ correlationId: 'corr-core-service' }).length >= 4);
});
