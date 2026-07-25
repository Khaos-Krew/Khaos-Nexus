'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  normalizeSchedule,
  normalizeSchedulerConfig,
  nextOccurrence,
  relevantOccurrence,
  dueWarning,
  warningText
} = require('../shared/server-scheduler.cjs');
const { ServerSchedulerService } = require('../main/services/server-scheduler-service.cjs');
const { legacyCommand } = require('../bot/server-client.cjs');

function tempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-scheduler-'));
}

function fakeStore(schedule, server, settings = {}) {
  let config = normalizeSchedulerConfig({
    settings: { pollSeconds: 10, missedRunGraceMinutes: 10, historyLimit: 50, ...settings },
    schedules: [schedule]
  });
  return {
    getSchedulerConfig: () => JSON.parse(JSON.stringify(config)),
    getRuntimeBootstrap: () => ({ config: { servers: [server] } }),
    patchSchedulerSchedule: (id, patch) => {
      const index = config.schedules.findIndex((item) => item.id === id);
      config.schedules[index] = normalizeSchedule({ ...config.schedules[index], ...patch, id });
      return config.schedules[index];
    }
  };
}

function baseSchedule(overrides = {}) {
  return normalizeSchedule({
    id: 'daily-restart',
    name: 'Daily Restart',
    serverIds: ['server-1'],
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    hour: 6,
    minute: 0,
    action: 'restart',
    warningMinutes: [30, 15, 5, 1],
    saveDelaySeconds: 0,
    restartTimeoutMinutes: 2,
    ...overrides
  });
}

const server = {
  id: 'server-1',
  name: 'Nexus Server',
  game: 'ark',
  host: '127.0.0.1',
  port: 27020,
  enabled: true,
  password: 'protected'
};

test('schedule normalization and next occurrence use local weekly time', () => {
  const schedule = baseSchedule({ daysOfWeek: [1, 3, 5], hour: 6, minute: 30 });
  const from = new Date(2026, 6, 27, 7, 0, 0); // Monday after the scheduled time.
  const next = nextOccurrence(schedule, from);
  assert.equal(next.getDay(), 3);
  assert.equal(next.getHours(), 6);
  assert.equal(next.getMinutes(), 30);
  assert.deepEqual(schedule.warningMinutes, [30, 15, 5, 1]);
});

test('warning selection sends only the closest due warning after a late startup', () => {
  const schedule = baseSchedule();
  const target = new Date(2026, 6, 25, 6, 0, 0);
  const now = new Date(2026, 6, 25, 5, 57, 0);
  const occurrence = relevantOccurrence(schedule, now, 10);
  assert.equal(occurrence.target.getTime(), target.getTime());
  assert.equal(dueWarning(schedule, { warningsSent: [] }, now, target), 5);
  assert.match(warningText(schedule, 5), /5 minute/);
});

test('ARK host-managed restart uses DoExit after SaveWorld', () => {
  assert.equal(legacyCommand({ game: 'ark' }, 'save'), 'SaveWorld');
  assert.equal(legacyCommand({ game: 'ark' }, 'shutdown', '0 Maintenance'), 'DoExit');
});

test('restart workflow saves, shuts down, observes offline, and verifies return online', async () => {
  const schedule = baseSchedule();
  const store = fakeStore(schedule, server);
  const calls = [];
  let statusChecks = 0;
  const notifications = [];
  const service = new ServerSchedulerService({
    dataDirectory: tempDirectory(),
    configStore: store,
    logger: { info() {}, warn() {}, error() {} },
    autonomy: { notify: async (...args) => { notifications.push(args); return { sent: true }; } },
    connectionFactory: () => ({
      action: async (action, payload) => {
        calls.push({ action, payload });
        if (action === 'status') {
          statusChecks += 1;
          if (statusChecks === 1) throw new Error('offline');
          return 'online';
        }
        return `${action} complete`;
      }
    }),
    sleep: async () => {}
  });

  const run = service.runNow(schedule.id, { countdownSeconds: 0 });
  await service.runPromises.get(run.id);
  const history = service.getState().history[0];
  assert.equal(history.outcome, 'success');
  assert.match(history.summary, /restart verified/i);
  assert.deepEqual(calls.slice(0, 3).map((item) => item.action), ['save', 'announce', 'shutdown']);
  assert.ok(calls.filter((item) => item.action === 'status').length >= 2);
  assert.ok(notifications.some((entry) => /success/i.test(entry[0])));
});

test('failed world save prevents unsafe shutdown', async () => {
  const schedule = baseSchedule();
  const store = fakeStore(schedule, server);
  const calls = [];
  const service = new ServerSchedulerService({
    dataDirectory: tempDirectory(),
    configStore: store,
    logger: { info() {}, warn() {}, error() {} },
    autonomy: { notify: async () => ({ skipped: true }) },
    connectionFactory: () => ({
      action: async (action) => {
        calls.push(action);
        if (action === 'save') throw new Error('save failed');
        return 'ok';
      }
    }),
    sleep: async () => {}
  });

  const run = service.runNow(schedule.id, { countdownSeconds: 0 });
  await service.runPromises.get(run.id);
  const history = service.getState().history[0];
  assert.equal(history.outcome, 'failed');
  assert.match(history.summary, /shutdown was cancelled/i);
  assert.equal(calls.includes('shutdown'), false);
});

test('scheduler tick records a single late warning without message bursts', async () => {
  const now = new Date(2026, 6, 25, 5, 57, 0).getTime();
  const schedule = baseSchedule();
  const store = fakeStore(schedule, server);
  const messages = [];
  const service = new ServerSchedulerService({
    dataDirectory: tempDirectory(),
    configStore: store,
    logger: { info() {}, warn() {}, error() {} },
    autonomy: { notify: async () => ({ sent: true }) },
    connectionFactory: () => ({ action: async (action, payload) => { if (action === 'announce') messages.push(payload.message); return 'ok'; } }),
    now: () => now,
    sleep: async () => {}
  });

  await service.tick();
  assert.equal(messages.length, 1);
  assert.match(messages[0], /5 minute/);
  const occurrence = Object.values(service.runtime.occurrences)[0];
  assert.deepEqual(occurrence.warningsSent, [30, 15, 5]);
});

test('scheduler extension and renderer expose protected operations and history', () => {
  const root = path.join(__dirname, '..');
  const extension = fs.readFileSync(path.join(root, 'main/server-scheduler-extension.cjs'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'renderer/server-scheduler.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'main/preload.cjs'), 'utf8');
  assert.match(extension, /assertAccess\('owner'/);
  assert.match(extension, /assertAccess\('operator'/);
  assert.match(extension, /server-scheduler:run-now/);
  assert.match(renderer, /Host-managed restart/);
  assert.match(renderer, /Execution History/);
  assert.match(renderer, /Save before shutdown/);
  assert.match(preload, /onServerScheduler/);
});
