'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  registerStartupTask,
  runStartupTasks,
  startupDiagnostics,
  resetStartupCoordinatorForTests
} = require('../src/sentinel/startup-coordinator.cjs');

test.beforeEach(() => resetStartupCoordinatorForTests());

test('startup coordinator rejects duplicate task ids', () => {
  registerStartupTask({ id: 'alpha', owner: 'test', run() {} });
  assert.throws(
    () => registerStartupTask({ id: 'alpha', owner: 'other', run() {} }),
    /duplicate startup task id: alpha/
  );
});

test('startup coordinator runs by priority then registration order', async () => {
  const order = [];
  registerStartupTask({ id: 'late', priority: 200, run() { order.push('late'); } });
  registerStartupTask({ id: 'first-a', priority: 10, run() { order.push('first-a'); } });
  registerStartupTask({ id: 'first-b', priority: 10, run() { order.push('first-b'); } });

  await runStartupTasks(null);
  assert.deepEqual(order, ['first-a', 'first-b', 'late']);
});

test('startup coordinator isolates task failures and does not rerun completed tasks', async () => {
  const calls = [];
  registerStartupTask({
    id: 'broken',
    priority: 10,
    async run() {
      calls.push('broken');
      throw new Error('expected test failure');
    }
  });
  registerStartupTask({ id: 'healthy', priority: 20, run() { calls.push('healthy'); } });

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const first = await runStartupTasks(null);
    const second = await runStartupTasks(null);

    assert.deepEqual(calls, ['broken', 'healthy']);
    assert.equal(first.tasks.find((task) => task.id === 'broken').status, 'failed');
    assert.equal(first.tasks.find((task) => task.id === 'healthy').status, 'complete');
    assert.equal(second.tasks.find((task) => task.id === 'broken').executionCount, 1);
    assert.equal(second.tasks.find((task) => task.id === 'healthy').executionCount, 1);
  } finally {
    console.warn = originalWarn;
  }
});

test('startup diagnostics expose task ownership, execution metrics, errors, and direct listeners', async () => {
  registerStartupTask({ id: 'diagnostic', owner: 'nexus-test', run() {} });
  await runStartupTasks(null);

  const client = new EventEmitter();
  client.on('clientReady', () => {});
  client.on('interactionCreate', () => {});
  client.on('interactionCreate', () => {});

  const snapshot = startupDiagnostics(client);
  assert.equal(snapshot.taskCount, 1);
  assert.equal(snapshot.tasks[0].id, 'diagnostic');
  assert.equal(snapshot.tasks[0].owner, 'nexus-test');
  assert.equal(snapshot.tasks[0].status, 'complete');
  assert.equal(snapshot.tasks[0].executionCount, 1);
  assert.equal(typeof snapshot.tasks[0].lastDurationMs, 'number');
  assert.equal(typeof snapshot.tasks[0].averageDurationMs, 'number');
  assert.equal(snapshot.tasks[0].lastError, null);
  assert.equal(snapshot.directListeners.clientReady, 1);
  assert.equal(snapshot.directListeners.interactionCreate, 2);
});
