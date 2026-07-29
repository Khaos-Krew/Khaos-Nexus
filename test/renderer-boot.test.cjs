'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('preload starts the renderer heartbeat but waits for the real application document before readiness', () => {
  const preload = read('main/preload.cjs');
  assert.match(preload, /sendRendererHeartbeat\(\);/);
  assert.match(preload, /setInterval\(sendRendererHeartbeat, 2000\)/);
  assert.match(preload, /reportBootStage/);
  assert.match(preload, /interfaceSnapshot/);
  assert.match(preload, /snapshot\.href === 'about:blank'/);
  assert.match(preload, /snapshot\.expectedDocument && snapshot\.hasShell && snapshot\.hasSidebar && snapshot\.hasContent && snapshot\.hasActiveView/);
  assert.match(preload, /DOMContentLoaded/);
  assert.match(preload, /startup-health:renderer-ready/);
  assert.doesNotMatch(preload, /startup-health:base-ui-ready/);
  assert.doesNotMatch(preload, /reportBaseInterfaceReady/);
});

test('renderer feature scripts remain serialized with progress and timeout protection', () => {
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

test('v0.18.21 retains startup foundations and reports a blocked renderer from the main process', () => {
  const packageJson = JSON.parse(read('package.json'));
  const entry = read('main/entry.cjs');
  const health = read('main/startup-health-extension.cjs');
  const coreRelease = read('main/startup-core-release-extension.cjs');
  const splashRenderer = read('renderer/startup-health.js');
  const stability = read('main/stability-extension.cjs');
  const splashHtml = read('renderer/startup-health.html');
  const recovery = read('renderer/access-recovery.js');
  const monitor = read('main/services/application-monitor.cjs');
  const preload = read('main/preload.cjs');
  const portableBootstrap = read('main/portable-bootstrap-extension.cjs');
  const watchdog = read('main/interface-watchdog-extension.cjs');
  const unresponsive = read('main/renderer-unresponsive-extension.cjs');

  assert.equal(packageJson.version, '0.18.21');
  assert.match(packageJson.description, /verified click-through grouped proxy navigation/i);
  assert.match(packageJson.description, /always-visible in-app update center/i);
  assert.match(packageJson.description, /bounded idempotent updater UI/i);
  assert.match(packageJson.description, /renderer-unresponsive reporting/i);
  assert.match(packageJson.description, /continuous visible-interface startup gate/i);
  assert.match(packageJson.description, /immediate portable sidecar logs and diagnostics/i);
  assert.match(packageJson.description, /canonical v0\.17-compatible AppData configuration/i);
  assert.match(packageJson.description, /sandbox-compatible main preload/i);
  assert.match(entry, /portable-bootstrap-extension\.cjs/);
  assert.ok(entry.indexOf('portable-bootstrap-extension.cjs') < entry.indexOf('requestSingleInstanceLock'));
  assert.match(entry, /startup-core-release-extension\.cjs/);
  assert.match(entry, /startup-preload-diagnostics-extension\.cjs/);
  assert.match(entry, /interface-watchdog-extension\.cjs/);
  assert.match(entry, /renderer-unresponsive-extension\.cjs/);
  assert.doesNotMatch(entry, /startup-release-fallback-extension\.cjs/);
  assert.match(unresponsive, /window\.on\('unresponsive'/);
  assert.match(unresponsive, /window\.webContents\.on\('unresponsive'/);
  assert.match(unresponsive, /watchdog\.reportFailure/);
  assert.match(unresponsive, /renderer-unresponsive/);
  assert.match(watchdog, /DISCOVERY_INTERVAL_MS = 250/);
  assert.match(watchdog, /INSPECTION_INTERVAL_MS = 500/);
  assert.match(watchdog, /INTERFACE_STABILITY_MS = 3000/);
  assert.match(watchdog, /capturePage\(\)/);
  assert.match(watchdog, /did-fail-load/);
  assert.match(watchdog, /render-process-gone/);
  assert.match(watchdog, /interface-watchdog-state\.json/);
  assert.match(watchdog, /interface-watchdog-error\.json/);
  assert.match(watchdog, /interface-watchdog\.log/);
  assert.match(watchdog, /queueAutomaticReport/);
  assert.match(watchdog, /rendererErrors\.record/);
  assert.match(watchdog, /Interface recovery/);
  assert.match(portableBootstrap, /process-started/);
  assert.match(portableBootstrap, /bootstrap\.log/);
  assert.match(health, /MINIMUM_SPLASH_MS = 30 \* 1000/);
  assert.match(coreRelease, /POLL_INTERVAL_MS = 250/);
  assert.match(coreRelease, /READY_STABILITY_MS = 1500/);
  assert.match(coreRelease, /visibleInterfaceRequired: true/);
  assert.match(coreRelease, /interfaceWatchdog\.publicState\(\)/);
  assert.match(coreRelease, /startup-core-release-diagnostics\.json/);
  assert.match(coreRelease, /startup-core-release\.log/);
  assert.match(coreRelease, /controller-installed/);
  assert.match(coreRelease, /configStoreReady/);
  assert.match(coreRelease, /rendererBridgeReady/);
  assert.match(coreRelease, /renderer-boot:stage/);
  assert.match(coreRelease, /stage: 'features-ready'/);
  assert.match(coreRelease, /discordDesktopSignInRequired: false/);
  assert.match(coreRelease, /optionalModuleCompletionRequired: false/);
  assert.doesNotMatch(coreRelease, /BrowserWindow\.prototype/);
  assert.doesNotMatch(coreRelease, /startup-health:base-ui-ready/);
  assert.doesNotMatch(coreRelease, /discordAuth/);
  assert.doesNotMatch(preload, /require\(['"]\.\.?\//);
  assert.match(splashRenderer, /Discord desktop sign-in \(optional\)/);
  assert.match(splashRenderer, /This does not block local startup/);
  assert.match(stability, /function isMainInterfaceWindow/);
  assert.match(stability, /preloadName\(window\) === 'preload\.cjs'/);
  assert.match(stability, /window\.__khaosStartupSplashWindow/);
  assert.match(splashHtml, /Entering the Khaos Nexus/);
  assert.match(splashHtml, /Minimum startup check: 30s/);
  assert.match(recovery, /startupReleased/);
  assert.match(monitor, /STARTUP_BATCH_DELAY_MS = 5 \* 60 \* 1000/);
  assert.match(monitor, /ERROR_BATCH_INTERVAL_MS = 30 \* 60 \* 1000/);
});

test('updater uses bounded idempotent reconciliation and retains protected install flow', () => {
  const updater = read('renderer/simple-updater.js');
  const extension = read('main/brand-update-extension.cjs');
  const flow = read('shared/update-flow.cjs');
  assert.doesNotThrow(() => new Function(updater));
  assert.match(updater, /RECONCILE_DELAYS_MS = Object\.freeze\(\[250, 1000, 3000, 6000\]\)/);
  assert.match(updater, /function setText\(element, value\)/);
  assert.match(updater, /if \(element\.textContent !== next\) element\.textContent = next/);
  assert.match(updater, /scheduleBoundedReconciliation/);
  assert.doesNotMatch(updater, /new MutationObserver/);
  assert.doesNotMatch(updater, /observer\.observe\(document\.body/);
  assert.match(updater, /ensureFallbackCenter/);
  assert.match(updater, /nexusHeaderUpdateButton/);
  assert.match(updater, /replacementReady/);
  assert.match(updater, /Download v\$\{update\.version/);
  assert.match(updater, /Install & Restart/);
  assert.match(updater, /invoke\('update:download'\)/);
  assert.match(updater, /invoke\('update:install'\)/);
  assert.doesNotMatch(updater, /invoke\('update:apply'\)/);
  assert.match(extension, /createAutomaticBackup\('pre-update'\)/);
  assert.match(extension, /verifyBackup\(backup\.filePath\)/);
  assert.match(extension, /Installation was cancelled and the current version remains active/);
  assert.match(extension, /status: 'backing-up'/);
  assert.match(flow, /return service\.getState\(\)/);
});