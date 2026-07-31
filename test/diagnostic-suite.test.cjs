'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const { DiagnosticSuite, normalizeEndpoint, installMode } = require('../main/services/diagnostic-suite.cjs');

function tempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-diagnostics-'));
}

test('diagnostics API remains HTTPS-only and automatic uploads remain opt-in', () => {
  assert.equal(normalizeEndpoint('https://diagnostics.example.com/'), 'https://diagnostics.example.com');
  assert.throws(() => normalizeEndpoint('http://diagnostics.example.com'), /HTTPS endpoint/i);
  const suite = new DiagnosticSuite({ dataDirectory: tempDirectory(), appVersion: '0.24.0' });
  assert.equal(suite.publicSettings().automaticCaptureEnabled, true);
  assert.equal(suite.publicSettings().automaticUploadEnabled, false);
  assert.equal(suite.publicSettings().endpointConfigured, false);
  assert.throws(() => suite.setSettings({ automaticUploadEnabled: true }), /Choose an HTTPS diagnostics endpoint/i);
});

test('installer diagnostics detect an unclean prior session automatically', () => {
  const directory = tempDirectory();
  const first = new DiagnosticSuite({ dataDirectory: directory, appVersion: '0.24.0', installMode: 'installed', pid: 111 });
  const old = first.startSession({ source: 'test' });
  const second = new DiagnosticSuite({ dataDirectory: directory, appVersion: '0.24.0', installMode: 'installed', pid: 222 });
  second.startSession({ source: 'restarted-test' });
  assert.equal(second.hadUncleanPreviousSession(), true);
  assert.equal(second.previousSession.id, old.id);
  const report = second.captureAutomatic({ type: 'unexpected-previous-shutdown', reason: 'Prior session stopped unexpectedly.' });
  assert.equal(report.summary.warnings >= 1, true);
  assert.equal(report.checks.some((item) => item.id === 'previous-shutdown' && item.status === 'warning'), true);
});

test('diagnostic reports redact credentials before writing evidence', () => {
  const directory = tempDirectory();
  fs.mkdirSync(path.join(directory, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify({
    schemaVersion: 3,
    discord: { token: 'super-secret-discord-token-value' },
    servers: [{ id: 'one', password: 'rcon-secret-value' }]
  }), 'utf8');
  fs.writeFileSync(path.join(directory, 'logs', 'manager.log'), 'authorization: bearer-value\npassword=rcon-secret-value\n', 'utf8');
  fs.writeFileSync(path.join(directory, 'secrets.bin'), Buffer.from('must-never-be-copied'));
  const suite = new DiagnosticSuite({ dataDirectory: directory, appVersion: '0.24.0', installMode: 'installed' });
  suite.startSession();
  const report = suite.createReport({ type: 'test', reason: 'redaction test', severity: 'info' });
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /super-secret-discord-token-value/);
  assert.doesNotMatch(serialized, /rcon-secret-value/);
  assert.doesNotMatch(serialized, /must-never-be-copied/);
  assert.match(serialized, /\[REDACTED\]/);
  const bundle = suite.packageReport(report);
  assert.equal(fs.existsSync(path.join(bundle.bundleDirectory, 'diagnostic-report.json')), true);
  assert.equal(fs.existsSync(path.join(bundle.bundleDirectory, 'secrets.bin')), false);
});

test('install mode distinguishes installer, portable and development runs', () => {
  const oldPortable = process.env.PORTABLE_EXECUTABLE_DIR;
  delete process.env.PORTABLE_EXECUTABLE_DIR;
  assert.equal(installMode({ executablePath: 'C:\\Program Files\\Khaos Nexus\\Khaos Nexus.exe', isPackaged: true }), 'installed');
  process.env.PORTABLE_EXECUTABLE_DIR = 'C:\\Tools\\Khaos Nexus';
  assert.equal(installMode({ executablePath: 'C:\\Tools\\Khaos Nexus.exe', isPackaged: true }), 'portable');
  if (oldPortable === undefined) delete process.env.PORTABLE_EXECUTABLE_DIR;
  else process.env.PORTABLE_EXECUTABLE_DIR = oldPortable;
  assert.equal(installMode({ isPackaged: false }), 'development');
});

test('installer and desktop entry expose the standalone diagnostic tool', () => {
  const entry = read('main/entry.cjs');
  const packageJson = JSON.parse(read('package.json'));
  const include = read('assets/installer.nsh');
  const html = read('renderer/diagnostics.html');
  assert.match(entry, /--diagnostics/);
  assert.match(entry, /diagnostic-tool\.cjs/);
  assert.match(entry, /diagnostic-suite-extension\.cjs/);
  assert.equal(packageJson.build.nsis.include, 'assets/installer.nsh');
  assert.match(include, /Khaos Nexus Diagnostics\.lnk/);
  assert.match(include, /--diagnostics/);
  assert.match(html, /Create support bundle/);
  assert.match(html, /Automatically upload captured reports/);
});
