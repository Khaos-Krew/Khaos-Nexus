'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ApplicationMonitor } = require('../main/services/application-monitor.cjs');

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; }
  };
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
    application: { version: '0.3.0' },
    system: { platform: 'win32', release: 'test', architecture: 'x64' },
    configuration: {},
    runtime: {
      status: 'error',
      crashCount: 1,
      autoRestartBlocked: false,
      ready: null,
      heartbeat: null,
      lastError: { id: 'ERR-TEST', message: 'Test failure', stack: 'Error: Test failure' }
    },
    recentLogs: []
  });
  const monitor = new ApplicationMonitor({
    configStore,
    logger,
    createReport,
    dataDirectory: directory,
    fetchImpl: fetchImpl || (async () => response(500, { message: 'unexpected request' })),
    now: () => Date.parse('2026-07-22T18:00:00Z')
  });
  return { monitor, config, configStore, logs, directory };
}

test('automatic reporting is opt-in', async (t) => {
  let requests = 0;
  const { monitor, directory } = harness({ enabled: false, fetchImpl: async () => { requests += 1; return response(201, {}); } });
  t.after(() => { monitor.destroy(); fs.rmSync(directory, { recursive: true, force: true }); });
  const result = await monitor.capture(new Error('disabled'));
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'disabled');
  assert.equal(requests, 0);
});

test('creates a new GitHub issue with a redacted diagnostic report', async (t) => {
  const calls = [];
  const { monitor, directory } = harness({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(201, { number: 42, html_url: 'https://github.com/Khaos-Krew/Khaos-Nexus-Bot-Manager/issues/42' });
    }
  });
  t.after(() => { monitor.destroy(); fs.rmSync(directory, { recursive: true, force: true }); });
  const result = await monitor.capture(new Error('Test failure'));
  assert.equal(result.delivered, true);
  assert.equal(result.action, 'created');
  assert.equal(result.issueNumber, 42);
  assert.match(calls[0].url, /\/issues$/);
  const body = JSON.parse(calls[0].options.body);
  assert.match(body.title, /ERR-TEST/);
  assert.match(body.body, /Captured automatically/);
  assert.equal(monitor.getState().queueDepth, 0);
});

test('comments on the existing issue when the same fingerprint repeats', async (t) => {
  const calls = [];
  const { monitor, directory } = harness({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) return response(201, { number: 42, html_url: 'https://github.com/Khaos-Krew/Khaos-Nexus-Bot-Manager/issues/42' });
      return response(201, { issue_url: 'https://api.github.com/repos/Khaos-Krew/Khaos-Nexus-Bot-Manager/issues/42', html_url: 'https://github.com/Khaos-Krew/Khaos-Nexus-Bot-Manager/issues/42#issuecomment-1' });
    }
  });
  t.after(() => { monitor.destroy(); fs.rmSync(directory, { recursive: true, force: true }); });
  await monitor.capture(new Error('Test failure'));
  const result = await monitor.capture(new Error('Test failure'));
  assert.equal(result.action, 'commented');
  assert.match(calls[1].url, /\/issues\/42\/comments$/);
});

test('queues reports until a GitHub token is configured', async (t) => {
  const { monitor, directory } = harness({ token: '' });
  t.after(() => { monitor.destroy(); fs.rmSync(directory, { recursive: true, force: true }); });
  const result = await monitor.capture(new Error('Test failure'));
  assert.equal(result.queued, true);
  assert.equal(result.reason, 'missing-token');
  assert.equal(monitor.getState().queueDepth, 1);
  assert.equal(monitor.getState().status, 'waiting-for-token');
});

test('delivers queued reports after credentials become available', async (t) => {
  let token = '';
  const calls = [];
  const setup = harness({
    token: '',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(201, { number: 77, html_url: 'https://github.com/Khaos-Krew/Khaos-Nexus-Bot-Manager/issues/77' });
    }
  });
  setup.configStore.getGithubToken = () => token;
  setup.configStore.getPublicConfig = () => ({ ...setup.config, hasGithubToken: Boolean(token) });
  t.after(() => { setup.monitor.destroy(); fs.rmSync(setup.directory, { recursive: true, force: true }); });
  await setup.monitor.capture(new Error('Test failure'));
  token = 'github-token';
  const result = await setup.monitor.processQueue();
  assert.equal(result.delivered, 1);
  assert.equal(result.remaining, 0);
  assert.equal(calls.length, 1);
  assert.equal(setup.monitor.getState().queueDepth, 0);
});
