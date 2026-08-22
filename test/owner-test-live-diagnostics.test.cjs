'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DiagnosticGithubBridge,
  inferStabilizationGate,
  runtimeSeverity,
  runtimePreparedItem
} = require('../main/diagnostic-github-bridge.cjs');
const {
  migrateLegacyReportRepository,
  LEGACY_REPORT_REPOSITORY,
  CURRENT_REPORT_REPOSITORY
} = require('../main/diagnostic-application-monitor-extension.cjs');

function report(overrides = {}) {
  const base = {
    reportId: 'KN-OWNER-TEST-1',
    createdAt: '2026-08-20T21:00:00.000Z',
    application: { version: '0.41.2', installMode: 'installed' },
    session: { id: 'session-test' },
    trigger: {
      type: 'renderer-load-failed',
      reason: 'The desktop interface failed to load.',
      severity: 'error',
      fingerprint: 'ABC123',
      error: {
        name: 'Error',
        message: 'renderer token=super-secret failed',
        stack: 'Error: renderer token=super-secret failed\n at test'
      },
      detail: {}
    },
    checks: [
      { id: 'data-directory', status: 'passed', summary: 'Application data directory is writable.', detail: {} }
    ],
    summary: { passed: 1, warnings: 0, failed: 0, info: 0 },
    evidence: { recentLogs: 'authorization: Bearer definitely-secret\nstartup failed' }
  };
  return {
    ...base,
    ...overrides,
    trigger: { ...base.trigger, ...(overrides.trigger || {}) },
    application: { ...base.application, ...(overrides.application || {}) },
    session: { ...base.session, ...(overrides.session || {}) },
    summary: { ...base.summary, ...(overrides.summary || {}) }
  };
}

test('owner-test diagnostics map failures to the stabilization gates conservatively', () => {
  assert.deepEqual(inferStabilizationGate(report()), { number: 1, label: 'Startup/loading' });
  assert.deepEqual(inferStabilizationGate(report({ trigger: { type: 'discord-status-panel-error', reason: 'Discord status panel failed.' } })), { number: 5, label: 'Discord status/control panel' });
  assert.deepEqual(inferStabilizationGate(report({ trigger: { type: 'palworld-config-save', reason: 'Palworld configuration did not persist after restart.' } })), { number: 6, label: 'Palworld server configuration' });
  assert.deepEqual(inferStabilizationGate(report({ trigger: { type: 'scheduler-recovery-error', reason: 'Shared scheduler recovery failed.' } })), { number: 9, label: 'Shared scheduler' });
  assert.deepEqual(inferStabilizationGate(report({ trigger: { type: 'backup-restore-error', reason: 'Backup restore failed.' } })), { number: 12, label: 'Backup/restore' });
  assert.equal(inferStabilizationGate(report({ trigger: { type: 'unknown-cross-cutting-error', reason: 'Something unrelated failed.' } })), null);
});

test('runtime severity treats an explicit runtime error as unhealthy even when system checks pass', () => {
  assert.equal(runtimeSeverity(report()), 'error');
  assert.equal(runtimeSeverity(report({ trigger: { severity: 'fatal' } })), 'fatal');
  assert.equal(runtimeSeverity(report({ trigger: { severity: 'info' }, summary: { failed: 1 } })), 'failed');
  assert.equal(runtimeSeverity(report({ trigger: { severity: 'info' }, summary: { warnings: 1 } })), 'warning');
  assert.equal(runtimeSeverity(report({ trigger: { severity: 'info' } })), 'healthy');
});

test('prepared owner-test issues include gate context and redact credential-shaped text', () => {
  const item = runtimePreparedItem(report());
  assert.match(item.title, /Owner Test Gate 1/);
  assert.match(item.body, /Gate 1 — Startup\/loading/);
  assert.doesNotMatch(item.body, /super-secret/);
  assert.doesNotMatch(item.body, /definitely-secret/);
  assert.match(item.body, /\[REDACTED\]/);
});

test('unhealthy owner-test diagnostics are handed to Application Monitor for immediate delivery', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-owner-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const calls = [];
  const monitor = {
    getState: () => ({ enabled: true }),
    capturePrepared: async (item, options) => {
      calls.push({ item, options });
      return { delivered: true, action: 'created', issueNumber: 42 };
    }
  };
  const bridge = new DiagnosticGithubBridge({ applicationMonitor: monitor, dataDirectory: directory });
  const result = await bridge.submitRuntime(report());
  assert.equal(result.delivered, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.immediate, true);
  assert.equal(calls[0].options.trigger, 'owner-test-live-diagnostic');
  assert.match(calls[0].item.title, /Owner Test Gate 1/);
});

test('healthy periodic system checks do not create GitHub issues', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-owner-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let deliveries = 0;
  const monitor = {
    getState: () => ({ enabled: true }),
    capturePrepared: async () => { deliveries += 1; return { delivered: true }; }
  };
  const bridge = new DiagnosticGithubBridge({ applicationMonitor: monitor, dataDirectory: directory });
  const result = await bridge.submitRuntime(report({ trigger: { type: 'owner-test-system-check', reason: 'Periodic owner-test system health check.', severity: 'info', error: null } }));
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'healthy-runtime-check');
  assert.equal(deliveries, 0);
});

test('legacy Application Monitor destination migrates to the active Khaos Nexus repository', () => {
  const config = {
    monitor: {
      autoReportEnabled: true,
      reportRepository: LEGACY_REPORT_REPOSITORY,
      reportLabels: ['bug', 'automated-report'],
      duplicateWindowHours: 72,
      maxReportsPerDay: 10
    }
  };
  const configStore = {
    getConfig: () => JSON.parse(JSON.stringify(config)),
    setMonitor: (next) => { config.monitor = { ...config.monitor, ...next }; }
  };
  const migrated = migrateLegacyReportRepository({ configStore });
  assert.equal(migrated, true);
  assert.equal(config.monitor.reportRepository, CURRENT_REPORT_REPOSITORY);
  assert.equal(config.monitor.autoReportEnabled, true);
  assert.equal(migrateLegacyReportRepository({ configStore }), false);
});
