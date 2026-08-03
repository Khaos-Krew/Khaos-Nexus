'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DiagnosticGithubBridge,
  deliveryPolicy,
  diagnosticMarkdown,
  preparedItem,
  UNHEALTHY_REPEAT_MS
} = require('../main/diagnostic-github-bridge.cjs');
const { normalizePreparedItem } = require('../main/diagnostic-application-monitor-extension.cjs');

function tempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-diagnostic-github-'));
}

function report({ version = '0.27.1', runtime = '0.1.0', warnings = 0, failed = 0, summary = 'Application data directory is writable.' } = {}) {
  return {
    reportId: `KN-${version}-${runtime}-${warnings}-${failed}`,
    createdAt: '2026-08-03T04:45:00.000Z',
    trigger: { type: 'startup-health-check', detail: { diagnosticsRuntime: runtime } },
    application: { version, installMode: 'installed' },
    summary: { passed: 3, warnings, failed, info: 0 },
    checks: [
      { id: 'data-directory', status: failed ? 'failed' : 'passed', summary, detail: { path: 'C:\\Users\\Owner\\AppData\\Roaming\\Khaos Nexus' } },
      ...(warnings ? [{ id: 'previous-shutdown', status: 'warning', summary: 'A previous session was unclean.', detail: {} }] : [])
    ],
    system: { platform: 'win32', release: '10.0.19045', architecture: 'x64' },
    process: { pid: 1234, memoryMb: { rss: 100 } },
    evidence: { recentLogs: 'authorization: Bearer super-secret-token-value\npassword=rcon-secret-value' }
  };
}

function monitor({ enabled = true, result = { delivered: true, issueNumber: 175 } } = {}) {
  const calls = [];
  return {
    calls,
    getState() { return { enabled }; },
    async capturePrepared(item, options) {
      calls.push({ item, options });
      return result;
    }
  };
}

test('startup diagnostics GitHub delivery remains tied to Application Monitor consent', async () => {
  const fake = monitor({ enabled: false });
  const bridge = new DiagnosticGithubBridge({ applicationMonitor: fake, dataDirectory: tempDirectory() });
  const result = await bridge.submit(report());
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'application-monitor-disabled');
  assert.equal(fake.calls.length, 0);
});

test('healthy startup evidence is delivered only once per application/runtime version', async () => {
  const fake = monitor();
  const bridge = new DiagnosticGithubBridge({ applicationMonitor: fake, dataDirectory: tempDirectory(), now: () => Date.parse('2026-08-03T04:45:00Z') });
  const first = await bridge.submit(report());
  const second = await bridge.submit(report());
  const nextVersion = await bridge.submit(report({ version: '0.27.2' }));
  assert.equal(first.delivered, true);
  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'healthy-version-already-reported');
  assert.equal(nextVersion.delivered, true);
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls[0].options.immediate, true);
});

test('unchanged unhealthy startup evidence is throttled but changed health is eligible', () => {
  const unhealthy = report({ warnings: 1 });
  const firstPolicy = deliveryPolicy(unhealthy, {}, 1000);
  assert.equal(firstPolicy.send, true);
  const state = {
    lastUnhealthyIdentity: firstPolicy.identity,
    lastUnhealthyAt: new Date(1000).toISOString()
  };
  assert.equal(deliveryPolicy(unhealthy, state, 1000 + UNHEALTHY_REPEAT_MS - 1).send, false);
  assert.equal(deliveryPolicy(unhealthy, state, 1000 + UNHEALTHY_REPEAT_MS + 1).send, true);
  assert.equal(deliveryPolicy(report({ warnings: 1, summary: 'A different warning.' }), state, 2000).send, true);
});

test('diagnostic GitHub markdown is bounded and redacted locally', () => {
  const markdown = diagnosticMarkdown(report({ warnings: 1 }));
  assert.match(markdown, /automatic startup diagnostics/i);
  assert.match(markdown, /Known credential formats are redacted/i);
  assert.doesNotMatch(markdown, /super-secret-token-value/);
  assert.doesNotMatch(markdown, /rcon-secret-value/);
  assert.ok(markdown.length <= 54000);
  const item = preparedItem(report({ failed: 1 }));
  assert.match(item.title, /failed/);
  assert.equal(item.source, 'startup-diagnostics');
});

test('prepared monitor reports require bounded explicit fields', () => {
  assert.throws(() => normalizePreparedItem({ title: 'Missing ID', body: 'body' }), /require an ID/i);
  const item = normalizePreparedItem({ id: 'diag-1', title: 'Title', body: 'Body', occurrences: 100000 });
  assert.equal(item.id, 'diag-1');
  assert.equal(item.occurrences, 9999);
});

test('desktop entry installs the diagnostic monitor bridge after the suite', () => {
  const root = path.join(__dirname, '..');
  const entry = fs.readFileSync(path.join(root, 'main', 'entry.cjs'), 'utf8');
  const suiteIndex = entry.indexOf("require('./diagnostic-suite-extension.cjs').install()");
  const bridgeIndex = entry.indexOf("require('./diagnostic-application-monitor-extension.cjs').install()");
  assert.ok(suiteIndex >= 0);
  assert.ok(bridgeIndex > suiteIndex);

  const suite = fs.readFileSync(path.join(root, 'main', 'diagnostic-suite-extension.cjs'), 'utf8');
  assert.match(suite, /startup-health-check/);
  assert.match(suite, /Automatic in-app startup health check/);
  assert.match(suite, /connectApplicationMonitor/);
  assert.match(suite, /githubBridge\.submit/);
});
