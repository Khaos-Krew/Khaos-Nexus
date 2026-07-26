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

test('v0.18.4 preserves startup health without monitoring the splash as the main renderer', () => {
  const packageJson = JSON.parse(read('package.json'));
  const entry = read('main/entry.cjs');
  const health = read('main/startup-health-extension.cjs');
  const profileRecovery = read('main/startup-profile-recovery-extension.cjs');
  const windowGate = read('main/startup-window-gate-extension.cjs');
  const baseReady = read('main/startup-base-ready-extension.cjs');
  const stability = read('main/stability-extension.cjs');
  const splashHtml = read('renderer/startup-health.html');
  const recovery = read('renderer/access-recovery.js');
  const monitor = read('main/services/application-monitor.cjs');

  assert.equal(packageJson.version, '0.18.4');
  assert.match(packageJson.description, /v0\.17-compatible profile recovery/i);
  assert.match(packageJson.description, /30-second minimum startup health screen/i);
  assert.match(packageJson.description, /splash-safe renderer monitoring/i);
  assert.match(entry, /startup-profile-recovery-extension\.cjs/);
  assert.match(entry, /startup-health-extension\.cjs/);
  assert.match(entry, /startup-base-ready-extension\.cjs/);
  assert.match(entry, /startup-window-gate-extension\.cjs/);
  assert.doesNotMatch(entry, /user-data-migration-extension\.cjs/);
  assert.match(health, /MINIMUM_SPLASH_MS = 30 \* 1000/);
  assert.match(health, /STARTUP_HEALTH_TIMEOUT_MS = 75 \* 1000/);
  assert.match(health, /startup-health\.html/);
  assert.match(health, /recoverProfileIfNeeded/);
  assert.match(health, /before-v0\.18\.3/);
  assert.match(profileRecovery, /before window creation/i);
  assert.match(windowGate, /startupGatedShow/);
  assert.match(baseReady, /OPTIONAL_MODULE_GRACE_MS = 15000/);
  assert.match(baseReady, /stage !== 'monitor-ready'/);
  assert.match(baseReady, /stage: 'features-ready'/);
  assert.match(baseReady, /optionalModulesContinuing: true/);
  assert.match(stability, /function isMainInterfaceWindow/);
  assert.match(stability, /preloadName\(window\) === 'preload\.cjs'/);
  assert.match(stability, /window\.__khaosStartupSplashWindow/);
  assert.match(stability, /if \(!isMainInterfaceWindow\(window\) \|\| !window\.isVisible\(\)\) continue/);
  assert.match(stability, /if \(managed\) attachWindowRecovery\(window\)/);
  assert.match(splashHtml, /Entering the Khaos Nexus/);
  assert.match(splashHtml, /Minimum startup check: 30s/);
  assert.match(recovery, /startupReleased/);
  assert.match(recovery, /startup-health:get/);
  assert.match(monitor, /STARTUP_BATCH_DELAY_MS = 5 \* 60 \* 1000/);
  assert.match(monitor, /ERROR_BATCH_INTERVAL_MS = 30 \* 60 \* 1000/);
});
