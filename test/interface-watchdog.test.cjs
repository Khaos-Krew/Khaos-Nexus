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
  assert.ok(preload.includes('/\\/renderer\\/index\\.html'), 'the expected renderer/index.html file URL must be required');
  for (const selector of ['.app-shell', '.sidebar', '.content', '.view.active']) {
    assert.ok(preload.includes(selector), `${selector} must be required for readiness`);
  }
  assert.match(preload, /interface-verification/);
  assert.match(preload, /startup-health:preload-failed/);
});

test('watchdog repeatedly discovers and continuously inspects the real main window', () => {
  const watchdog = read('main/interface-watchdog-extension.cjs');
  assert.doesNotThrow(() => new Function(watchdog));
  assert.match(watchdog, /DISCOVERY_INTERVAL_MS = 250/);
  assert.match(watchdog, /INSPECTION_INTERVAL_MS = 500/);
  assert.match(watchdog, /INTERFACE_STABILITY_MS = 3000/);
  assert.match(watchdog, /for \(const delay of \[0, 50, 250, 1000\]\)/);
  assert.match(watchdog, /setInterval\(discover, DISCOVERY_INTERVAL_MS\)/);
  assert.match(watchdog, /setInterval\(\(\) => scheduleInspection\('continuous'\), INSPECTION_INTERVAL_MS\)/);
  assert.match(watchdog, /window === startupHealth\.refs\.mainWindow/);
  assert.match(watchdog, /preloadName\(window\) === 'preload\.cjs'/);
});

test('watchdog covers load failure, renderer exit, blank document, hidden shell, zero-size layout, and visually blank output', () => {
  const watchdog = read('main/interface-watchdog-extension.cjs');
  assert.match(watchdog, /did-fail-load/);
  assert.match(watchdog, /render-process-gone/);
  assert.match(watchdog, /STARTUP_DEADLINE_MS = 45000/);
  assert.match(watchdog, /safe\.bodyTextLength > 20/);
  assert.match(watchdog, /safe\.shellDisplay !== 'none'/);
  assert.match(watchdog, /safe\.shellVisibility !== 'hidden'/);
  assert.match(watchdog, /safe\.shellOpacity !== '0'/);
  assert.match(watchdog, /safe\.shellWidth > 100/);
  assert.match(watchdog, /safe\.contentHeight > 100/);
  assert.match(watchdog, /capturePage\(\)/);
  assert.match(watchdog, /visuallyBlank/);
  assert.match(watchdog, /nonDarkRatio < 0\.001/);
});

test('startup release controller requires stable watchdog state before it can emit features-ready', () => {
  const release = read('main/startup-core-release-extension.cjs');
  assert.match(release, /interfaceWatchdog\.publicState\(\)/);
  assert.match(release, /!interfaceState\.installed \|\| !interfaceState\.attached \|\| !interfaceState\.stable/);
  assert.match(release, /visibleInterfaceRequired: true/);
  assert.match(release, /visibleInterfaceStable: true/);
  assert.match(release, /the main interface is not stably visible/);
  const tickStart = release.indexOf('function tick()');
  const interfaceGate = release.indexOf('!interfaceState.installed || !interfaceState.attached || !interfaceState.stable', tickStart);
  const emitCall = release.indexOf('emitCoreReady(health, interfaceState);', tickStart);
  assert.ok(tickStart >= 0, 'the polling tick must exist');
  assert.ok(interfaceGate > tickStart, 'the visible interface gate must execute inside tick');
  assert.ok(emitCall > interfaceGate, 'features-ready must be emitted only after the visible interface gate');
});

test('healthy and failed watchdog states are retained in AppData and portable diagnostics', () => {
  const watchdog = read('main/interface-watchdog-extension.cjs');
  assert.match(watchdog, /interface-watchdog-state\.json/);
  assert.match(watchdog, /interface-watchdog-error\.json/);
  assert.match(watchdog, /path\.join\('logs', 'interface-watchdog\.log'\)/);
  assert.match(watchdog, /writeDiagnostic\('interface-watchdog-state\.json'/);
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
  assert.match(watchdog, /data:text\/html;charset=utf-8/);
});
