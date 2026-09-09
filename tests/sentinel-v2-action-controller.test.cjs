'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ActionGate, ActionController } = require('../src/sentinel-v2/actions.cjs');

function createStore({ approvalPersisted = true } = {}) {
  const calls = [];
  return {
    calls,
    async request(input) {
      calls.push(['request', input]);
      return {
        actionId: input.actionId || 'action-1',
        capability: input.capability,
        source: input.source,
        destructive: Boolean(input.destructive),
        status: input.destructive ? 'approval-required' : 'requested',
        persisted: true,
      };
    },
    async startAttempt(actionId, attempt) {
      calls.push(['startAttempt', actionId, attempt]);
      return { actionId, attempt, status: 'running', persisted: true };
    },
    async complete(actionId, input) {
      calls.push(['complete', actionId, input]);
      return {
        actionId,
        capability: 'discord.role.write',
        destructive: false,
        status: input.status,
        result: input.result,
        persisted: true,
      };
    },
    async decideApproval(actionId, input) {
      calls.push(['decideApproval', actionId, input]);
      return {
        actionId,
        status: input.approved ? 'approved' : 'denied',
        persisted: approvalPersisted,
      };
    },
  };
}

test('blocked authorization is durably marked blocked and handler never runs', async () => {
  const store = createStore();
  const controller = new ActionController({ gate: new ActionGate(), store });
  let executed = false;

  const result = await controller.submit({
    capability: 'discord.role.write',
    source: 'test',
  }, async () => { executed = true; });

  assert.equal(result.ok, false);
  assert.equal(result.executed, false);
  assert.equal(result.authorization.reason, 'mutations-disabled');
  assert.equal(executed, false);
  assert.ok(store.calls.some(([name, , input]) => name === 'complete' && input.status === 'blocked'));
  assert.equal(store.calls.some(([name]) => name === 'startAttempt'), false);
});

test('allowlisted non-destructive action executes through durable attempt lifecycle', async () => {
  const store = createStore();
  const gate = new ActionGate({ mutationEnabled: true, dryRun: false, allow: ['discord.role.write'] });
  const controller = new ActionController({ gate, store });

  const result = await controller.submit({
    capability: 'discord.role.write',
    source: 'test',
  }, async () => ({ changed: true }));

  assert.equal(result.ok, true);
  assert.equal(result.executed, true);
  assert.deepEqual(result.result, { changed: true });
  assert.ok(store.calls.some(([name]) => name === 'startAttempt'));
  assert.ok(store.calls.some(([name, , input]) => name === 'complete' && input.status === 'succeeded'));
});

test('destructive action requires durable approval before execution', async () => {
  const store = createStore();
  const gate = new ActionGate({ mutationEnabled: true, dryRun: false, allow: ['ark.restart'] });
  const controller = new ActionController({ gate, store });
  let executions = 0;

  const pending = await controller.submit({
    actionId: 'restart-1',
    capability: 'ark.restart',
    source: 'test',
    destructive: true,
  }, async () => { executions += 1; });

  assert.equal(pending.executed, false);
  assert.equal(pending.authorization.reason, 'approval-required');
  assert.equal(executions, 0);

  const approved = await controller.approveAndExecute(pending.action, { actor: 'owner', reason: 'maintenance' }, async () => {
    executions += 1;
    return { restarted: true };
  });

  assert.equal(approved.ok, true);
  assert.equal(approved.executed, true);
  assert.equal(approved.authorization.reason, 'authorized');
  assert.equal(executions, 1);
});

test('destructive action does not execute when approval cannot be durably recorded', async () => {
  const store = createStore({ approvalPersisted: false });
  const gate = new ActionGate({ mutationEnabled: true, dryRun: false, allow: ['ark.restart'] });
  const controller = new ActionController({ gate, store });
  const action = { actionId: 'restart-2', capability: 'ark.restart', destructive: true };
  let executed = false;

  const result = await controller.approveAndExecute(action, { actor: 'owner' }, async () => { executed = true; });

  assert.equal(result.ok, false);
  assert.equal(result.authorization.reason, 'approval-not-durable');
  assert.equal(executed, false);
  assert.equal(store.calls.some(([name]) => name === 'startAttempt'), false);
});

test('action allowlist blocks capabilities that were not explicitly enabled', async () => {
  const store = createStore();
  const gate = new ActionGate({ mutationEnabled: true, dryRun: false, allow: ['discord.role.write'] });
  const controller = new ActionController({ gate, store });

  const result = await controller.submit({ capability: 'ark.restart', source: 'test' });
  assert.equal(result.authorization.reason, 'not-allowlisted');
  assert.equal(result.action.status, 'blocked');
});
