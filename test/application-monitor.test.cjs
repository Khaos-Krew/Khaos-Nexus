'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  ApplicationMonitor,
  STARTUP_BATCH_DELAY_MS,
  ERROR_BATCH_INTERVAL_MS
} = require('../main/services/application-monitor.cjs');

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; }
  };
}

function timerHandle() {
  return { unref() {} };
}

function harness({ enabled = true, token = 'github-token', fetchImpl } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-monitor-'));
  const config = {
    monitor: {
      autoReportEnabled: enabled,
      reportRepository: 'Khaos-Krew/Khaos-Nexus-Bot-Manager',
      reportLabels: ['bug', 'automated-report'],
      duplicateWindowHours: 72,
      maxReportsPerDay: 10
    }
  };
  const configStore = {
    getConfig: () => JSON.parse(JSON.stringify(config)),
    getPublicConfig: () => ({ ...JSON.parse(JSON.stringify(config)), hasGithubToken: Boolean(token) }),
    getGithubToken: () => token
  };
  const logs = [];
  const logger = {
    info: (message, meta) => logs.push({ level: 'info', message, meta }),
    warn: (message, meta) => logs.push({ level: 'warn', message, meta }),
    error: (message, meta) => logs.push({ level: 'error', message, meta })
  };
  const createReport = () => ({
    application: { version: '0.17.3' },
    system: { platform: 'win32', release: 'test', architecture: 'x64' },
    configuration: {},
    runtime: {
      status: 'error',
      crashCount: 1,
      autoRestartBlocked: false,
      ready: null,
      heartbeat: null,
      lastError: null
    },
    recentLogs: []
  });
  const timers = { timeout: null, interval: null };
  let now = Date.parse('2026-07-26T03:00:00Z');
  const monitor = new ApplicationMonitor({
    configStore,
    logger,
    createReport,
    dataDirectory: directory,
    fetchImpl: fetchImpl || (async () => response(500, { message: 'unexpected request' })),
    now: () => now,
    setTimeoutFactory: (callback, delay) => {
      timers.timeout = { callback, delay };
      return timerHandle();
    },
    clearTimeoutFactory: () => {},
    setIntervalFactory: (callback, delay) => {
      timers.interval = { callback, delay };
      return timerHandle();
    },
    clearIntervalFactory: () => {}
  });
  return {
    monitor,
    config,
    configStore,
    logs,
    directory,
    timers,
    setToken: (value) => { token = value; },
    setNow: (value) => { now = typeof value === 'number' ? value : Date.parse(value); }
  };
}

function cleanup(t, setup) {
  t.after(() => {
    setup.monitor.destroy();
    fs.rmSync(setup.directory, { recursive: true, force: true });
  });
}

test('automatic reporting remains opt-in', async (t) => {
  let requests = 0;
  const setup = harness({ enabled: false, fetchImpl: async () => { requests += 1; return response(201, {}); } });
  cleanup(t, setup);
  const result = await setup.monitor.capture(new Error('disabled'));
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'disabled');
  assert.equal(requests, 0);
});

test('automatic capture retains errors instead of uploading immediately', async (t) => {
  const calls = [];
  const setup = harness({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(201, { number: 42, html_url: 'https://github.com/Khaos-Krew/Khaos-Nexus-Bot-Manager/issues/42' });
    }
  });
  cleanup(t, setup);
  const result = await setup.monitor.capture(Object.assign(new Error('Button failed'), { id: 'BUTTON-1' }), { source: 'renderer-action' });
  assert.equal(result.queued, true);
  assert.equal(result.reason, 'awaiting-batch');
  assert.equal(setup.monitor.getState().queueDepth, 1);
  assert.equal(calls.length, 0);
});

test('first batch is scheduled five minutes after startup and recurring checks every thirty minutes', async (t) => {
  const calls = [];
  const setup = harness({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(201, { number: 42, html_url: 'https://github.com/Khaos-Krew/Khaos-Nexus-Bot-Manager/issues/42' });
    }
  });
  cleanup(t, setup);
  assert.equal(setup.timers.timeout.delay, STARTUP_BATCH_DELAY_MS);
  assert.equal(setup.monitor.getState().startupBatchDelayMinutes, 5);
  await setup.monitor.capture(Object.assign(new Error('Startup failure'), { id: 'STARTUP-1' }));
  setup.setNow('2026-07-26T03:05:00Z');
  await setup.timers.timeout.callback();
  assert.equal(calls.length, 1);
  assert.equal(setup.monitor.getState().queueDepth, 0);
  assert.equal(setup.timers.interval.delay, ERROR_BATCH_INTERVAL_MS);
  assert.equal(setup.monitor.getState().batchIntervalMinutes, 30);
});

test('all retained errors are uploaded together in the scheduled batch', async (t) => {
  const calls = [];
  const setup = harness({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(201, { number: 51, html_url: 'https://github.com/Khaos-Krew/Khaos-Nexus-Bot-Manager/issues/51' });
    }
  });
  cleanup(t, setup);
  await setup.monitor.capture(Object.assign(new Error('Restart failed'), { id: 'ERR-RESTART' }), { source: 'hosted-server' });
  await setup.monitor.capture(Object.assign(new Error('Save failed'), { id: 'ERR-SAVE' }), { source: 'server-scheduler' });
  const result = await setup.monitor.processAutomaticBatch({ trigger: 'five-minute-startup-batch' });
  assert.equal(result.errors, 2);
  assert.equal(result.remaining, 0);
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].options.body);
  assert.match(body.title, /Auto Error Batch/);
  assert.match(body.body, /Restart failed/);
  assert.match(body.body, /Save failed/);
  assert.match(body.body, /five minutes after startup/);
  assert.match(body.body, /every thirty minutes/);
});

test('later thirty-minute batches append to the same daily GitHub issue', async (t) => {
  const calls = [];
  const setup = harness({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) return response(201, { number: 77, html_url: 'https://github.com/Khaos-Krew/Khaos-Nexus-Bot-Manager/issues/77' });
      return response(201, { issue_url: 'https://api.github.com/repos/Khaos-Krew/Khaos-Nexus-Bot-Manager/issues/77' });
    }
  });
  cleanup(t, setup);
  await setup.monitor.capture(Object.assign(new Error('First failure'), { id: 'FIRST' }));
  await setup.monitor.processAutomaticBatch({ trigger: 'five-minute-startup-batch' });
  setup.setNow('2026-07-26T03:35:00Z');
  await setup.monitor.capture(Object.assign(new Error('Later failure'), { id: 'LATER' }));
  await setup.monitor.processAutomaticBatch({ trigger: 'thirty-minute-maintenance-scan' });
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/issues$/);
  assert.match(calls[1].url, /\/issues\/77\/comments$/);
  const comment = JSON.parse(calls[1].options.body);
  assert.match(comment.body, /Later failure/);
});

test('retained renderer errors import only new occurrence counts and ignore access denials', (t) => {
  const setup = harness();
  cleanup(t, setup);
  const entries = [
    {
      id: 'UI-1', channel: 'hosted-server:power', view: 'hosted-servers', operation: 'Restart',
      message: 'Provider returned 500.', stack: 'Error: Provider returned 500.', occurrences: 2,
      time: '2026-07-26T03:00:00Z', lastSeenAt: '2026-07-26T03:01:00Z'
    },
    {
      id: 'LOCKED', channel: 'player-console:get', view: 'dashboard', operation: 'Players',
      message: 'View connected players requires viewer access. Sign in with an authorized Discord account.', occurrences: 1
    }
  ];
  const first = setup.monitor.captureRetainedErrors(entries);
  const second = setup.monitor.captureRetainedErrors(entries);
  assert.equal(first.captured, 2);
  assert.equal(second.captured, 0);
  assert.equal(setup.monitor.getState().queueDepth, 1);
});

test('missing GitHub credentials retain the entire batch for the next check', async (t) => {
  const setup = harness({ token: '' });
  cleanup(t, setup);
  await setup.monitor.capture(Object.assign(new Error('Offline report'), { id: 'OFFLINE' }));
  const result = await setup.monitor.processAutomaticBatch({ trigger: 'five-minute-startup-batch' });
  assert.equal(result.reason, 'missing-token');
  assert.equal(result.remaining, 1);
  assert.equal(setup.monitor.getState().status, 'waiting-for-token');
});

test('expected authorization denials are never queued as defects', async (t) => {
  const setup = harness();
  cleanup(t, setup);
  const result = await setup.monitor.capture(new Error('View connected players requires viewer access. Sign in with an authorized Discord account.'));
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'expected-access-denial');
  assert.equal(setup.monitor.getState().queueDepth, 0);
});
