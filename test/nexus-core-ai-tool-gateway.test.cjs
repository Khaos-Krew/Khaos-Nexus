'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FileEventJournal } = require('../shared/nexus-core/event-journal.cjs');
const { FileOperationStore } = require('../shared/nexus-core/operation-store.cjs');
const { CommandGateway } = require('../shared/nexus-core/command-gateway.cjs');
const { AiToolGateway } = require('../shared/nexus-core/ai-tool-gateway.cjs');

const SERVER_SCHEMA = Object.freeze({
  type: 'object',
  required: ['serverId'],
  additionalProperties: false,
  properties: {
    serverId: { type: 'string', minLength: 1, maxLength: 100 }
  }
});

function harness(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-nexus-ai-tools-'));
  let id = 0;
  const journal = new FileEventJournal({ filePath: path.join(root, 'events.ndjson'), fsync: false });
  const operationStore = new FileOperationStore({ directory: path.join(root, 'operations') });
  const commandGateway = new CommandGateway({
    journal,
    operationStore,
    now: () => '2026-08-11T07:20:00.000Z',
    idFactory: () => `command-${++id}`
  });
  const toolGateway = new AiToolGateway({
    commandGateway,
    journal,
    approvalVerifier: options.approvalVerifier,
    now: () => '2026-08-11T07:20:00.000Z',
    idFactory: () => `tool-${++id}`
  });
  return { root, journal, operationStore, commandGateway, toolGateway };
}

function call(overrides = {}) {
  return {
    workerId: overrides.workerId || 'sentinel',
    tool: overrides.tool || 'server.status',
    toolCallId: overrides.toolCallId || 'tool-call-001',
    correlationId: overrides.correlationId || 'corr-ai-001',
    actor: overrides.actor || { kind: 'discord-user', id: '1234' },
    args: overrides.args || { serverId: 'rag-01' },
    approval: overrides.approval || null
  };
}

test('read tools validate typed input, enforce capability, and redact secrets from results', async () => {
  const { toolGateway, journal } = harness();
  toolGateway.register('server.status', {
    mode: 'read',
    inputSchema: SERVER_SCHEMA,
    requiredCapabilities: ['game.server.read'],
    handler: async ({ serverId }) => ({ serverId, status: 'online', token: 'must-not-leak' })
  });

  const result = await toolGateway.invoke(call(), {
    role: 'locked',
    grantedCapabilities: ['game.server.read']
  });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.output.status, 'online');
  assert.equal(result.output.token, '[REDACTED]');
  assert.equal(JSON.stringify(journal.list()).includes('must-not-leak'), false);

  await assert.rejects(
    () => toolGateway.invoke(call({ args: { serverId: 'rag-01', rawCommand: 'DestroyWildDinos' } }), {
      role: 'locked',
      grantedCapabilities: ['game.server.read']
    }),
    (error) => error.code === 'NEXUS_SCHEMA_INVALID'
  );
});

test('proposal tools never require or receive command execution authority', async () => {
  const { toolGateway } = harness();
  toolGateway.register('server.restart-plan', {
    mode: 'propose',
    inputSchema: SERVER_SCHEMA,
    requiredCapabilities: ['game.server.read'],
    handler: async ({ serverId }) => ({ proposal: `Save and restart ${serverId} with a 10 minute warning.` })
  });

  const result = await toolGateway.invoke(call({ tool: 'server.restart-plan' }), {
    role: 'locked',
    grantedCapabilities: ['game.server.read']
  });
  assert.equal(result.mode, 'propose');
  assert.match(result.output.proposal, /10 minute warning/);
});

test('execute tools map to high-level Core actions with stable idempotency instead of raw infrastructure commands', async () => {
  const { commandGateway, toolGateway, operationStore } = harness();
  let executions = 0;
  commandGateway.register('game.server.save', {
    requiredCapabilities: ['game.server.save'],
    execute: async (request) => {
      executions += 1;
      assert.equal(request.source.kind, 'ai-worker');
      assert.equal(request.source.id, 'sentinel');
      assert.deepEqual(request.input, { serverId: 'rag-01' });
      return { saved: true };
    }
  });
  toolGateway.register('server.save', {
    mode: 'execute',
    inputSchema: SERVER_SCHEMA,
    requiredCapabilities: ['game.server.save'],
    toAction: async ({ serverId }) => ({
      action: 'game.server.save',
      scope: { kind: 'server', id: serverId },
      idempotencyKey: `ai-save:${serverId}:maintenance-001`,
      input: { serverId }
    })
  });

  const first = await toolGateway.invoke(call({ tool: 'server.save' }), { role: 'operator' });
  const duplicate = await toolGateway.invoke(call({ tool: 'server.save', toolCallId: 'tool-call-002' }), { role: 'operator' });
  assert.equal(first.status, 'succeeded');
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(executions, 1);
  assert.equal(operationStore.read('ai-save:rag-01:maintenance-001').resultStatus, 'succeeded');
});

test('approval-required tools fail closed without a deterministic approval verifier', async () => {
  const { commandGateway, toolGateway } = harness();
  commandGateway.register('game.server.restart', {
    requiredCapabilities: ['game.server.restart'],
    execute: async () => ({ restarted: true })
  });
  toolGateway.register('server.restart', {
    mode: 'approval-required',
    inputSchema: SERVER_SCHEMA,
    requiredCapabilities: ['game.server.restart'],
    toAction: async ({ serverId }) => ({
      action: 'game.server.restart',
      scope: { kind: 'server', id: serverId },
      idempotencyKey: `ai-restart:${serverId}:maintenance-001`,
      input: { serverId }
    })
  });

  await assert.rejects(
    () => toolGateway.invoke(call({ tool: 'server.restart' }), { role: 'locked' }),
    (error) => error.code === 'NEXUS_AI_TOOL_DENIED'
  );
});

test('verified human approval may grant only the scoped execution subject returned by Core', async () => {
  const approvals = [];
  const { commandGateway, toolGateway, journal } = harness({
    approvalVerifier: async (approval, context) => {
      approvals.push({ approval, context });
      return {
        approved: approval?.approvalId === 'approval-1',
        approvalId: 'approval-1',
        approvedBy: 'owner-1234',
        approvedAt: '2026-08-11T07:19:00Z',
        subject: {
          role: 'locked',
          grantedCapabilities: ['game.server.restart']
        }
      };
    }
  });
  let executions = 0;
  commandGateway.register('game.server.restart', {
    requiredCapabilities: ['game.server.restart'],
    execute: async () => {
      executions += 1;
      return { restarted: true, password: 'never-return-this' };
    }
  });
  toolGateway.register('server.restart', {
    mode: 'approval-required',
    inputSchema: SERVER_SCHEMA,
    requiredCapabilities: ['game.server.restart'],
    toAction: async ({ serverId }) => ({
      action: 'game.server.restart',
      scope: { kind: 'server', id: serverId },
      idempotencyKey: `ai-restart:${serverId}:maintenance-002`,
      input: { serverId }
    })
  });

  const result = await toolGateway.invoke(call({
    tool: 'server.restart',
    approval: { approvalId: 'approval-1' }
  }), { role: 'locked', grantedCapabilities: ['ai.use'] });

  assert.equal(result.status, 'succeeded');
  assert.equal(result.output.restarted, true);
  assert.equal(result.output.password, '[REDACTED]');
  assert.equal(executions, 1);
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].context.tool, 'server.restart');
  assert.equal(JSON.stringify(journal.list()).includes('never-return-this'), false);
});

test('mutating AI tools cannot execute without a stable idempotency key', async () => {
  const { commandGateway, toolGateway } = harness();
  commandGateway.register('game.server.save', {
    requiredCapabilities: ['game.server.save'],
    execute: async () => ({ saved: true })
  });
  toolGateway.register('server.save', {
    mode: 'execute',
    inputSchema: SERVER_SCHEMA,
    requiredCapabilities: ['game.server.save'],
    toAction: async ({ serverId }) => ({
      action: 'game.server.save',
      scope: { kind: 'server', id: serverId },
      input: { serverId }
    })
  });

  await assert.rejects(
    () => toolGateway.invoke(call({ tool: 'server.save' }), { role: 'operator' }),
    (error) => error.code === 'NEXUS_AI_TOOL_IDEMPOTENCY_REQUIRED'
  );
});
