'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('preload waits for the real interface and maintains a renderer heartbeat', () => {
  const preload = read('main/preload.cjs');
  assert.match(preload, /sendRendererHeartbeat\(\);/);
  assert.match(preload, /setInterval\(sendRendererHeartbeat, 2000\)/);
  assert.match(preload, /interfaceSnapshot/);
  assert.match(preload, /snapshot\.href === 'about:blank'/);
  assert.match(preload, /startup-health:renderer-ready/);
  assert.doesNotMatch(preload, /startup-health:base-ui-ready/);
});

test('renderer features remain serialized and software compatibility remains the safe Windows default', () => {
  const coordinator = read('main/renderer-boot-coordinator-extension.cjs');
  const graphics = read('main/software-rendering-extension.cjs');
  const brand = read('main/brand-update-extension.cjs');
  assert.match(coordinator, /FEATURE_START_DELAY_MS = 750/);
  assert.match(coordinator, /FEATURE_GAP_MS = 180/);
  assert.match(coordinator, /FEATURE_LOAD_TIMEOUT_MS = 8000/);
  assert.match(coordinator, /features-ready/);
  assert.match(graphics, /disableHardwareAcceleration/);
  assert.match(graphics, /--hardware-renderer/);
  assert.match(graphics, /KHAOS_NEXUS_HARDWARE_RENDERING/);
  assert.match(brand, /rich-brand-skipped/);
  assert.match(brand, /addScript\('simple-updater\.js'\)/);
});

test('current release retains stable startup, adapters, preserved Android evidence and unconditional local recovery', () => {
  const packageJson = JSON.parse(read('package.json'));
  const entry = read('main/entry.cjs');
  const coreRelease = read('main/startup-core-release-extension.cjs');
  const monitor = read('main/services/application-monitor.cjs');
  const portableBootstrap = read('main/portable-bootstrap-extension.cjs');
  const watchdog = read('main/interface-watchdog-extension.cjs');
  const unresponsive = read('main/renderer-unresponsive-extension.cjs');
  const audit = read('main/audit-repair-extension.cjs');
  const moduleFoundation = read('main/module-foundation-extension.cjs');
  const localAuthority = read('main/local-module-authority-extension.cjs');
  const moduleRuntime = read('main/module-runtime-extension.cjs');
  const adapterSdk = read('shared/game-adapter-sdk.cjs');
  const palworld = read('main/palworld-main-extension.cjs');
  const rust = read('main/rust-main-extension.cjs');
  const rustGate = read('main/rust-module-gate-extension.cjs');
  const satisfactory = read('main/satisfactory-main-extension.cjs');
  const mobile = read('main/services/mobile-gateway-service.cjs');
  const mobileSecurity = read('main/mobile-gateway-security-extension.cjs');
  const mobileHold = read('main/mobile-production-hold-extension.cjs');

  assert.match(packageJson.version, /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/);
  assert.match(packageJson.description, /installer-first automatic diagnostics/i);
  assert.match(packageJson.description, /standalone Khaos Nexus Diagnostics launcher/i);
  assert.match(packageJson.description, /preserved but paused Android Companion and Mobile Gateway/i);
  assert.match(packageJson.description, /complete D&D campaign management/i);
  assert.match(packageJson.description, /dedicated Rust WebRCON operations/i);
  assert.match(packageJson.description, /Satisfactory dedicated-server operations/i);
  assert.match(packageJson.description, /typed Game Adapter SDK/i);

  assert.match(entry, /portable-bootstrap-extension\.cjs/);
  assert.ok(entry.indexOf('portable-bootstrap-extension.cjs') < entry.indexOf('requestSingleInstanceLock'));
  assert.match(entry, /diagnostic-runtime-updater\.cjs/);
  assert.match(entry, /runDiagnosticTool/);
  assert.match(entry, /--diagnostics/);
  assert.match(entry, /diagnostic-suite-extension\.cjs/);
  assert.match(entry, /startup-core-release-extension\.cjs/);
  assert.match(entry, /interface-watchdog-extension\.cjs/);
  assert.match(entry, /renderer-unresponsive-extension\.cjs/);
  assert.match(entry, /mobile-production-hold-extension\.cjs/);
  assert.match(entry, /mobileGatewayPolicyEnabled/);
  assert.match(entry, /if \(mobileGatewayEnabled\) require\('\.\/mobile-module-registry-extension\.cjs'\)\.install\(\)/);
  assert.match(entry, /if \(mobileGatewayEnabled\) \{\s*require\('\.\/mobile-gateway-extension\.cjs'\)\.install\(\);\s*require\('\.\/mobile-gateway-security-extension\.cjs'\)\.install\(\);/s);
  assert.match(entry, /module-foundation-extension\.cjs/);
  assert.match(entry, /local-module-authority-extension\.cjs/);
  assert.match(entry, /module-runtime-extension\.cjs/);
  assert.match(entry, /satisfactory-main-extension\.cjs/);
  assert.match(entry, /game-adapter-runtime-extension\.cjs/);
  assert.ok(entry.indexOf('diagnostic-suite-extension.cjs') < entry.indexOf("require('./main.cjs')"));

  assert.match(localAuthority, /for \(const key of \['autonomy', 'discordAuth'\]\)/);
  assert.match(moduleFoundation, /modules:bulk-update/);
  assert.match(moduleRuntime, /patchIpcHandlers/);
  assert.match(adapterSdk, /executeAdapterOperation/);
  assert.match(adapterSdk, /GameAdapterRegistry/);
  assert.match(palworld, /executeAdapterOperation/);
  assert.match(rust, /createCurrentServerAdapter/);
  assert.match(rust, /rustModuleEnabledFromRuntime/);
  assert.match(rustGate, /assertModule\('rust-server-operations'/);
  assert.match(satisfactory, /server:satisfactory-action/);

  // Dormant Android and Mobile Gateway implementation remains intact for future authorized resumption.
  assert.match(mobile, /class MobileGatewayService/);
  assert.match(mobile, /TLSv1\.2/);
  assert.match(mobileSecurity, /LAST_SEEN_WRITE_INTERVAL_MS/);
  assert.match(mobileHold, /String\(env\?\.\[ENABLE_VARIABLE\] \|\| ''\) === '1'/);
  assert.match(mobileHold, /reason: 'paused-by-owner-directive'/);
  assert.match(mobileHold, /effectiveEnabled: false/);

  assert.match(audit, /reconcileInterruptedRuns/);
  assert.match(unresponsive, /renderer-unresponsive/);
  assert.match(watchdog, /interface-watchdog-state\.json/);
  assert.match(watchdog, /queueAutomaticReport/);
  assert.match(portableBootstrap, /bootstrap\.log/);
  assert.match(coreRelease, /visibleInterfaceRequired: true/);
  assert.match(coreRelease, /stage: 'features-ready'/);
  assert.match(monitor, /ERROR_BATCH_INTERVAL_MS = 30 \* 60 \* 1000/);
});

test('installer diagnostics are local-first, redacted and independent of the main UI', () => {
  const entry = read('main/entry.cjs');
  const extension = read('main/diagnostic-suite-extension.cjs');
  const updater = read('main/diagnostic-runtime-updater.cjs');
  const service = read('main/services/diagnostic-suite.cjs');
  const tool = read('main/diagnostic-tool.cjs');
  const preload = read('main/diagnostic-tool-preload.cjs');
  const installer = read('assets/installer.nsh');
  const packageJson = JSON.parse(read('package.json'));

  assert.match(entry, /diagnostic-runtime-updater\.cjs/);
  assert.match(entry, /runDiagnosticTool/);
  assert.match(updater, /Khaos-Krew\/Khaos-Nexus-Diagnostics/);
  assert.match(updater, /require\('\.\/diagnostic-tool\.cjs'\)/);
  assert.match(updater, /require\('\.\/services\/diagnostic-suite\.cjs'\)/);
  assert.match(extension, /render-process-gone/);
  assert.match(extension, /did-fail-load/);
  assert.match(extension, /unexpected-previous-shutdown/);
  assert.match(extension, /post-install-baseline/);
  assert.match(service, /secrets\.bin/);
  assert.match(service, /redactObject/);
  assert.match(service, /Compress-Archive/);
  assert.match(service, /https:/);
  assert.match(service, /automaticUploadEnabled: current\.automaticUploadEnabled === true/);
  assert.match(service, /reportsDirectory/);
  assert.match(tool, /standalone-startup-baseline/);
  assert.match(preload, /diagnostic-tool:get-state/);
  assert.match(installer, /Khaos Nexus Diagnostics\.lnk/);
  assert.match(installer, /--diagnostics/);
  assert.equal(packageJson.build.nsis.include, 'assets/installer.nsh');
});

test('updater keeps bounded reconciliation and protected install flow', () => {
  const updater = read('renderer/simple-updater.js');
  const extension = read('main/brand-update-extension.cjs');
  const audit = read('main/audit-repair-extension.cjs');
  const flow = read('shared/update-flow.cjs');
  assert.doesNotThrow(() => new Function(updater));
  assert.match(updater, /RECONCILE_DELAYS_MS = Object\.freeze\(\[250, 1000, 3000, 6000\]\)/);
  assert.match(updater, /scheduleBoundedReconciliation/);
  assert.doesNotMatch(updater, /new MutationObserver/);
  assert.match(updater, /Install & Restart/);
  assert.match(extension, /createAutomaticBackup\('pre-update'\)/);
  assert.match(extension, /verifyBackup\(backup\.filePath\)/);
  assert.match(audit, /status: 'downloaded'/);
  assert.match(flow, /return service\.getState\(\)/);
});
