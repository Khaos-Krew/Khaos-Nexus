'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('preload does not allow the initial about:blank document to satisfy renderer readiness', () => {
  const preload = read('main/preload.cjs');
  assert.doesNotThrow(() => new Function(preload));
  const readyCall = preload.indexOf("ipcRenderer.invoke('startup-health:renderer-ready', snapshot)");
  const blankGuard = preload.indexOf("snapshot.href === 'about:blank'");
  const validation = preload.indexOf('snapshot.expectedDocument && snapshot.hasShell && snapshot.hasSidebar && snapshot.hasContent && snapshot.hasActiveView');
  assert.ok(blankGuard >= 0, 'about:blank must be explicitly ignored');
  assert.ok(validation > blankGuard, 'the real application structure must be validated after the blank guard');
  assert.ok(readyCall > validation, 'renderer readiness must be invoked only after structural validation');
});

test('preload verifies the expected file document and required interface elements', () => {
  const preload = read('main/preload.cjs');
  assert.match(preload, /href\.startsWith\('file:'\)/);
  assert.match(preload, /renderer\/index\\\.html/);
  for (const selector of ['.app-shell', '.sidebar', '.content', '.view.active']) {
    assert.ok(preload.includes(selector), `${selector} must be required for readiness`);
  }
  assert.match(preload, /interface-verification/);
  assert.match(preload, /startup-health:preload-failed/);
});

test('main-process watchdog covers load failure, renderer exit, blank document, and hidden shell cases', () => {
  const watchdog = read('main/interface-watchdog-extension.cjs');
  assert.doesNotThrow(() => new Function(watchdog));
  assert.match(watchdog, /did-fail-load/);
  assert.match(watchdog, /render-process-gone/);
  assert.match(watchdog, /STARTUP_DEADLINE_MS = 12000/);
  assert.match(watchdog, /safe\.bodyTextLength > 20/);
  assert.match(watchdog, /safe\.shellDisplay !== 'none'/);
  assert.match(watchdog, /safe\.shellVisibility !== 'hidden'/);
  assert.match(watchdog, /safe\.shellOpacity !== '0'/);
});

test('interface failures are retained locally, mirrored to portable diagnostics, and queued for Application Monitor', () => {
  const watchdog = read('main/interface-watchdog-extension.cjs');
  assert.match(watchdog, /interface-watchdog-error\.json/);
  assert.match(watchdog, /interface-watchdog\.log/);
  assert.match(watchdog, /writeDiagnostic\('interface-watchdog-error\.json'/);
  assert.match(watchdog, /appendLog\('interface-watchdog\.log'/);
  assert.match(watchdog, /crashDiagnostics\.writeCrashReport/);
  assert.match(watchdog, /rendererErrors\.record/);
  assert.match(watchdog, /queueAutomaticReport/);
  assert.match(watchdog, /MAX_REPORT_RETRIES = 20/);
});

test('blank interface recovery replaces the black window with a visible diagnostic screen', () => {
  const watchdog = read('main/interface-watchdog-extension.cjs');
  assert.match(watchdog, /Interface recovery/);
  assert.match(watchdog, /Khaos Nexus could not display the desktop interface/);
  assert.match(watchdog, /Error ID:/);
  assert.match(watchdog, /Retry interface/);
  assert.match(watchdog, /document\.open\(\);document\.write/);
});
