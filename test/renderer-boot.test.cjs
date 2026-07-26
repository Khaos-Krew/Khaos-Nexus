'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('preload starts the renderer heartbeat before page feature scripts', () => {
  const preload = read('main/preload.cjs');
  assert.match(preload, /sendRendererHeartbeat\(\);/);
  assert.match(preload, /setInterval\(sendRendererHeartbeat, 2000\)/);
  assert.match(preload, /reportBootStage/);
});

test('renderer feature scripts are serialized with progress and timeout protection', () => {
  const coordinator = read('main/renderer-boot-coordinator-extension.cjs');
  assert.match(coordinator, /Node\.prototype\.appendChild/);
  assert.match(coordinator, /FEATURE_START_DELAY_MS = 750/);
  assert.match(coordinator, /FEATURE_GAP_MS = 180/);
  assert.match(coordinator, /FEATURE_LOAD_TIMEOUT_MS = 8000/);
  assert.match(coordinator, /feature-loading/);
  assert.match(coordinator, /features-ready/);
  assert.match(coordinator, /nexusBootIndicator/);
});

test('optional monitor extensions wait until the base document has loaded', () => {
  const monitor = read('renderer/application-monitor.js');
  assert.match(monitor, /scheduleOptionalExtensions/);
  assert.match(monitor, /document\.readyState === 'complete'/);
  assert.match(monitor, /window\.addEventListener\('load'/);
  assert.match(monitor, /setTimeout\(begin, 1000\)/);
});

test('Windows compatibility mode defaults to software rendering with an explicit hardware override', () => {
  const graphics = read('main/software-rendering-extension.cjs');
  const entry = read('main/entry.cjs');
  assert.match(graphics, /disableHardwareAcceleration/);
  assert.match(graphics, /disable-gpu-compositing/);
  assert.match(graphics, /--hardware-renderer/);
  assert.match(graphics, /KHAOS_NEXUS_HARDWARE_RENDERING/);
  assert.match(entry, /software-rendering-extension\.cjs/);
});

test('software compatibility mode skips the expensive global brand renderer', () => {
  const extension = read('main/brand-update-extension.cjs');
  assert.match(extension, /hardwareRenderingRequested/);
  assert.match(extension, /if \(richBrandEnabled\)/);
  assert.match(extension, /addScript\('brand-ui\.js'\)/);
  assert.match(extension, /rich-brand-skipped/);
  assert.match(extension, /nexus-compatibility-visuals/);
  assert.match(extension, /addScript\('simple-updater\.js'\)/);
});

test('v0.18.1 restores prior data and Discord access before enforcing the desktop lock', () => {
  const packageJson = JSON.parse(read('package.json'));
  const entry = read('main/entry.cjs');
  const preload = read('main/preload.cjs');
  const startupState = read('main/startup-state-extension.cjs');
  const migration = read('main/user-data-migration-extension.cjs');
  const recovery = read('renderer/access-recovery.js');
  const splashCss = read('renderer/startup-splash.css');
  const monitor = read('main/services/application-monitor.cjs');

  assert.equal(packageJson.version, '0.18.1');
  assert.match(packageJson.description, /prior-configuration recovery/i);
  assert.match(packageJson.description, /Discord session restoration before access enforcement/i);
  assert.match(packageJson.description, /CSP-safe first-frame startup lock/i);
  assert.match(entry, /user-data-migration-extension\.cjs/);
  assert.match(entry, /startup-state-extension\.cjs/);
  assert.match(startupState, /authRestoreComplete/);
  assert.match(startupState, /startup:get-state/);
  assert.match(startupState, /refs\.discordAuth\.restore\(\)/);
  assert.match(migration, /configurationValueScore/);
  assert.match(migration, /PORTABLE_EXECUTABLE_DIR/);
  assert.match(preload, /startup-splash\.css/);
  assert.match(preload, /scheduleSplashInstall\(\)/);
  assert.match(preload, /modulesReady && startupReady\(\)/);
  assert.match(preload, /onStartupState/);
  assert.match(splashCss, /z-index: 2147483647/);
  assert.match(recovery, /startupState\?\.authRestoreComplete/);
  assert.match(recovery, /startup:get-state/);
  assert.match(monitor, /STARTUP_BATCH_DELAY_MS = 5 \* 60 \* 1000/);
  assert.match(monitor, /ERROR_BATCH_INTERVAL_MS = 30 \* 60 \* 1000/);
});
