'use strict';

const { Client, Events } = require('discord.js');

const INSTALLED = Symbol.for('khaos.nexus.startup.coordinator.installed');
const BOUND = Symbol.for('khaos.nexus.startup.coordinator.bound');
const TASKS = Symbol.for('khaos.nexus.startup.coordinator.tasks');

function store() {
  if (!globalThis[TASKS]) globalThis[TASKS] = new Map();
  return globalThis[TASKS];
}

function registerStartupTask({ id, owner = 'sentinal', priority = 100, run }) {
  const key = String(id || '').trim();
  if (!key) throw new Error('startup task id is required');
  if (typeof run !== 'function') throw new TypeError(`startup task ${key} requires run()`);
  const tasks = store();
  if (tasks.has(key)) throw new Error(`duplicate startup task id: ${key}`);
  const task = {
    id: key,
    owner: String(owner || 'sentinal'),
    priority: Number.isFinite(Number(priority)) ? Number(priority) : 100,
    order: tasks.size,
    registeredAt: new Date().toISOString(),
    executionCount: 0,
    lastDurationMs: null,
    totalDurationMs: 0,
    lastError: null,
    status: 'registered',
    run
  };
  tasks.set(key, task);
  return task;
}

async function runStartupTasks(client) {
  const tasks = [...store().values()].sort((a, b) => a.priority - b.priority || a.order - b.order);
  for (const task of tasks) {
    if (task.executionCount > 0 || task.status === 'running') continue;
    task.status = 'running';
    const started = Date.now();
    try {
      await task.run(client);
      task.lastError = null;
      task.status = 'complete';
    } catch (error) {
      task.lastError = String(error?.message || error).slice(0, 500);
      task.status = 'failed';
      console.warn(`[Nexus Sentinal] startup task ${task.id} failed: ${task.lastError}`);
    } finally {
      task.executionCount += 1;
      task.lastDurationMs = Math.max(0, Date.now() - started);
      task.totalDurationMs += task.lastDurationMs;
    }
  }
  return startupDiagnostics();
}

function startupDiagnostics(client = null) {
  const tasks = [...store().values()].map((task) => ({
    id: task.id,
    owner: task.owner,
    priority: task.priority,
    status: task.status,
    registeredAt: task.registeredAt,
    executionCount: task.executionCount,
    lastDurationMs: task.lastDurationMs,
    averageDurationMs: task.executionCount ? Math.round(task.totalDurationMs / task.executionCount) : null,
    lastError: task.lastError
  }));
  const directListeners = client && typeof client.eventNames === 'function'
    ? Object.fromEntries(client.eventNames().map((event) => [String(event), client.listenerCount(event)]))
    : {};
  return { taskCount: tasks.length, tasks, directListeners };
}

function installStartupCoordinator() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function nexusStartupCoordinatorLogin(...args) {
    if (!this[BOUND]) {
      this[BOUND] = true;
      this.once(Events.ClientReady, () => {
        void runStartupTasks(this).then((snapshot) => {
          const failed = snapshot.tasks.filter((task) => task.status === 'failed').length;
          console.log(`[Nexus Sentinal] startup coordinator: tasks=${snapshot.taskCount} failed=${failed}`);
        }).catch((error) => console.warn(`[Nexus Sentinal] startup coordinator unavailable: ${String(error?.message || error).slice(0, 300)}`));
      });
    }
    const loginResult = originalLogin.apply(this, args);
    console.log(`[Nexus Sentinal] startup listener registry: directClientReady=${this.listenerCount(Events.ClientReady)} coordinatedTasks=${store().size}`);
    return loginResult;
  };
}

function resetStartupCoordinatorForTests() {
  globalThis[TASKS] = new Map();
}

installStartupCoordinator();

module.exports = {
  installStartupCoordinator,
  registerStartupTask,
  runStartupTasks,
  startupDiagnostics,
  resetStartupCoordinatorForTests
};
