'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  BOT_STARTUP_TIMEOUT_MS,
  isStartupStatus,
  startupTimeoutMessage
} = require('../shared/startup-guard.cjs');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('startup guard recognizes only unfinished startup states', () => {
  assert.equal(isStartupStatus('starting'), true);
  assert.equal(isStartupStatus('connecting'), true);
  assert.equal(isStartupStatus('online'), false);
  assert.equal(isStartupStatus('error'), false);
  assert.equal(BOT_STARTUP_TIMEOUT_MS, 45000);
  assert.match(startupTimeoutMessage(), /45 seconds/i);
  assert.match(startupTimeoutMessage(), /Live Logs/i);
});

test('stability CSS keeps the sidebar scrollable and overrides stale click blocking', () => {
  const css = read('renderer/stability-fixes.css');
  assert.match(css, /\.sidebar\s*\{[\s\S]*overflow-y:\s*auto\s*!important/i);
  assert.match(css, /\.sidebar-footer\s*\{[\s\S]*position:\s*sticky\s*!important/i);
  assert.match(css, /body\.nexus-access-locked[\s\S]*pointer-events:\s*auto\s*!important/i);
  assert.match(css, /\.nexus-version-chip/);
});

test('renderer fail-safe exposes recovery and navigation without duplicating preload heartbeat polling', () => {
  const script = read('renderer/stability-fixes.js');
  const preload = read('main/preload.cjs');
  assert.match(script, /Sign In with Discord/);
  assert.match(script, /Emergency Local Recovery/);
  assert.match(script, /UNLOCK KHAOS NEXUS/);
  assert.match(script, /nexusAlwaysVisibleVersion/);
  assert.match(script, /bindFailSafeNavigation/);
  assert.doesNotMatch(script, /stability:heartbeat/);
  assert.doesNotMatch(script, /setInterval\(refreshState/);
  assert.match(preload, /ipcRenderer\.invoke\('stability:heartbeat'\)/);
  assert.match(preload, /setInterval\(sendRendererHeartbeat, 2000\)/);
});

test('main stability extension guards bot startup and sustained renderer freezes', () => {
  const script = read('main/stability-extension.cjs');
  assert.match(script, /BOT_STARTUP_TIMEOUT/);
  assert.match(script, /armKhaosStartupTimer/);
  assert.match(script, /Discord bot launch failed/);
  assert.match(script, /status:\s*'error'/);
  assert.match(script, /stability:heartbeat/);
  assert.match(script, /Interface Not Responding/);
  assert.match(script, /Restart Interface/);
  assert.match(script, /RENDERER_STARTUP_GRACE_MS\s*=\s*60000/);
  assert.match(script, /RENDERER_HEARTBEAT_TIMEOUT_MS\s*=\s*30000/);
  assert.match(script, /NATIVE_UNRESPONSIVE_CONFIRM_MS\s*=\s*12000/);
  assert.match(script, /scheduleNativeUnresponsiveConfirmation/);
  assert.match(script, /window\.on\('responsive'/);
  assert.match(script, /lastHeartbeat > signalAt/);
});

test('hardware acceleration stays enabled unless safe rendering is explicitly requested', () => {
  const script = read('main/stability-extension.cjs');
  assert.match(script, /softwareRenderingRequested/);
  assert.match(script, /--safe-renderer/);
  assert.match(script, /KHAOS_NEXUS_SOFTWARE_RENDERING/);
  assert.match(script, /if \(!softwareRenderingRequested\(\)\) return false/);
  assert.match(script, /configureGraphicsMode\(\);/);
  assert.doesNotMatch(script, /installed = true;\s*\n\s*electron\.app\.disableHardwareAcceleration\(\)/);
});

test('renderer recovery captures webContents IDs and handles every asynchronous recovery', () => {
  const script = read('main/stability-extension.cjs');
  assert.match(script, /const webContentsId = webContents\.id/);
  assert.match(script, /webContents\.on\('destroyed', \(\) => cleanupRendererTracking\(webContentsId\)\)/);
  assert.doesNotMatch(script, /on\('destroyed',[\s\S]{0,100}window\.webContents\.id/);
  assert.match(script, /offerRendererRecovery\([\s\S]*?\)\.catch/);
  assert.match(script, /usableWindow\(window\)/);
});

test('main-process crash diagnostics create redacted local reports and IPC recovery actions', () => {
  const script = read('main/crash-diagnostics-extension.cjs');
  assert.match(script, /uncaughtExceptionMonitor/);
  assert.match(script, /khaos-nexus-crash-report/);
  assert.match(script, /crash-diagnostics:get-last/);
  assert.match(script, /crash-diagnostics:open-folder/);
  assert.match(script, /crash-diagnostics:copy-last/);
  assert.match(script, /redactText/);
});

test('module migration UI no longer installs a whole-document mutation observer', () => {
  const script = read('renderer/module-hub.js');
  assert.doesNotMatch(script, /new MutationObserver/);
  assert.doesNotMatch(script, /querySelectorAll\(['"]body \*['"]\)/);
  assert.match(script, /applyStaticCopy/);
});

test('renderer error reporting is rate-limited on both renderer and main sides', () => {
  const renderer = read('renderer/application-monitor.js');
  const main = read('main/stability-extension.cjs');
  assert.match(renderer, /recentRendererErrors/);
  assert.match(renderer, /now - previous < 60000/);
  assert.match(main, /__khaosRendererErrorDeduped/);
  assert.match(main, /duplicate:\s*true/);
});
