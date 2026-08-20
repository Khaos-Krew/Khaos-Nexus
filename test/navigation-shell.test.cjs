'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('navigation renderer builds grouped proxies without moving working buttons', () => {
  const source = read('renderer/navigation-shell.js');
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /__khaosNavigationShellInstalled/);
  assert.match(source, /navigation-proxy-ready/);
  assert.match(source, /mode: 'static-proxy'/);
  assert.match(source, /data-view-proxy/);
  assert.match(source, /original\.click\(\)/);
  assert.match(source, /nexus-original-nav-item/);
  assert.match(source, /Servers/);
  assert.match(source, /Discord & Community/);
  assert.match(source, /Automation/);
  assert.match(source, /Modules & Tools/);
  assert.match(source, /System/);
  assert.doesNotMatch(source, /appendChild\(item\)/);
  assert.doesNotMatch(source, /new MutationObserver/);
});

test('grouped proxy clicks resolve data-view-proxy through dataset.viewProxy', () => {
  const source = read('renderer/navigation-shell.js');
  assert.match(source, /proxy\.dataset\.viewProxy/);
  assert.match(source, /const original = originalFor\(view\)/);
  assert.match(source, /navigation-proxy-missing-target/);
  assert.match(source, /navigation-proxy-routing-warning/);
  assert.doesNotMatch(source, /originalFor\(proxy\.dataset\.view\)/);
});

test('safe UI layer loads one primary navigation owner while preserving independent scrolling', () => {
  const css = read('renderer/ui-fixes.css');
  const extension = read('main/brand-update-extension.cjs');
  assert.match(css, /^@import url\(['"]scroll-layout\.css['"]\);/);
  assert.match(css, /@import url\(['"]navigation-shell\.css['"]\);/);
  assert.match(css, /nexus-original-nav-item/);
  assert.match(css, /body:not\(\.nexus-static-navigation-active\)/);
  assert.match(extension, /addScript\('simple-updater\.js'\)/);
  assert.match(extension, /addScript\('ui-refresh\.js'\)/);
  assert.doesNotMatch(extension, /addScript\('navigation-shell\.js'\)/);
});

test('current Windows release preserves Android production boundaries and release metadata integrity', () => {
  const packageJson = JSON.parse(read('package.json'));
  const notes = read(packageJson.build.releaseInfo.releaseNotesFile);
  const mobileDocs = read('docs/ANDROID_COMPANION_v0.22.0.md');
  const mobileShared = read('shared/mobile-gateway.cjs');
  const mobileService = read('main/services/mobile-gateway-service.cjs');
  const mobileSecurity = read('main/mobile-gateway-security-extension.cjs');
  const mobileHold = read('main/mobile-production-hold-extension.cjs');
  const androidWorkflow = read('.github/workflows/android-build.yml');
  const ownerTestAuthorizationPath = path.join(root, 'config', 'mobile-owner-test-authorization.json');
  const ownerTestAuthorization = fs.existsSync(ownerTestAuthorizationPath)
    ? JSON.parse(fs.readFileSync(ownerTestAuthorizationPath, 'utf8'))
    : null;
  const authorizedAndroidOwnerTest = Boolean(
    ownerTestAuthorization?.enabled === true
    && ownerTestAuthorization?.scope === 'owner-test'
    && ownerTestAuthorization?.architectureDecision === 'ADR-009'
    && ownerTestAuthorization?.trackingIssue === 276
    && ownerTestAuthorization?.desktopBaseline === 'v0.41.2-B'
  );
  const rust = read('bot/rust-webrcon.cjs');
  const rustMain = read('main/rust-main-extension.cjs');
  const rustUi = read('renderer/rust-webrcon-ui.js');
  const rustDocs = read('docs/RUST_WEBRCON_v0.21.0.md');
  const sdk = read('shared/game-adapter-sdk.cjs');
  const fixtures = read('shared/game-adapter-fixtures.cjs');
  const bridge = read('bot/game-adapters/current-server-adapter.cjs');
  const sdkDocs = read('docs/GAME_ADAPTER_SDK_v0.20.0.md');
  const registry = read('shared/module-registry.cjs');
  const foundation = read('main/module-foundation-extension.cjs');
  const localAuthority = read('main/local-module-authority-extension.cjs');
  const runtime = read('main/module-runtime-extension.cjs');
  const botRuntime = read('bot/module-runtime.cjs');
  const workflow = read('.github/workflows/stable-release.yml');
  const ciWorkflow = read('.github/workflows/ci.yml');
  const prerelease = packageJson.version.includes('-');

  assert.match(packageJson.version, /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/);
  assert.match(packageJson.description, /unconditional local-desktop module recovery controls/i);
  assert.match(packageJson.description, /preserved but paused Android Companion and Mobile Gateway/i);
  assert.match(packageJson.description, /complete D&D campaign management/i);
  assert.match(packageJson.description, /dedicated Rust WebRCON operations/i);
  assert.match(packageJson.description, /Owner-only raw Rust console access/i);
  assert.match(packageJson.description, /typed Game Adapter SDK/i);
  assert.match(packageJson.description, /explicit capability manifests/i);
  assert.match(packageJson.description, /authoritative Owner module switches/i);
  assert.match(packageJson.description, /full production runtime audit repairs/i);
  assert.match(localAuthority, /Discord authentication or a Discord role/);
  assert.match(localAuthority, /get: \(\) => null/);
  assert.match(localAuthority, /set: \(\) => \{\}/);

  // Android and Mobile Gateway implementation evidence remains preserved. Stable/public release stays held,
  // while a narrowly-scoped ADR-009 package marker may authorize this private owner-test workflow only.
  assert.match(mobileShared, /verifyMobileRequestSignature/);
  assert.match(mobileShared, /issueDeviceCredential/);
  assert.match(mobileService, /class MobileGatewayService/);
  assert.match(mobileService, /TLSv1\.2/);
  assert.match(mobileSecurity, /OneTimeDelivery|oneTimePairingRoute/);
  assert.match(mobileDocs, /Android Keystore/);
  assert.match(mobileDocs, /Phase 1 API/);
  assert.match(mobileHold, /KHAOS_NEXUS_MOBILE_GATEWAY_ENABLED/);
  assert.match(mobileHold, /paused-by-owner-directive/);
  assert.match(mobileHold, /launchView: null/);

  if (authorizedAndroidOwnerTest) {
    assert.equal(ownerTestAuthorization.scope, 'owner-test');
    assert.equal(ownerTestAuthorization.architectureDecision, 'ADR-009');
    assert.equal(ownerTestAuthorization.trackingIssue, 276);
    assert.equal(ownerTestAuthorization.desktopBaseline, 'v0.41.2-B');
    assert.match(androidWorkflow, /name: Android Owner Test/);
    assert.match(androidWorkflow, /owner-test\/android-resume-v0\.41\.2/);
    assert.match(androidWorkflow, /testDebugUnitTest lintDebug/);
    assert.match(androidWorkflow, /assembleRelease/);
    assert.match(androidWorkflow, /apksigner verify/);
    assert.match(androidWorkflow, /Khaos-Nexus-Mobile-Android-0\.41\.2-B-owner-test/);
    assert.match(androidWorkflow, /actions\/upload-artifact@v4/);
    assert.doesNotMatch(androidWorkflow, /gh release create|gh release edit|softprops\/action-gh-release/);
  } else {
    assert.match(androidWorkflow, /name: Android Production Hold/);
    assert.match(androidWorkflow, /workflow_dispatch/);
    assert.match(androidWorkflow, /ADR-008/);
    assert.doesNotMatch(androidWorkflow, /lintDebug/);
    assert.doesNotMatch(androidWorkflow, /apksigner/);
    assert.doesNotMatch(androidWorkflow, /upload-artifact/);
  }

  assert.match(rust, /class RustWebRconClient/);
  assert.match(rust, /serverinfo/);
  assert.match(rust, /playerlist/);
  assert.match(rust, /encodeURIComponent\(server\.password\)/);
  assert.match(rust, /allowCloseAsSuccess/);
  assert.match(rustMain, /server:rust-action/);
  assert.match(rustMain, /RUN RAW COMMAND/);
  assert.match(rustUi, /Rust WebRCON Operations/);
  assert.match(rustUi, /rcon\.web 1/);
  assert.match(rustDocs, /vanilla-safe/i);
  assert.match(rustDocs, /Owner module behavior/);
  assert.match(sdk, /CORE_CAPABILITY_DEFINITIONS/);
  assert.match(sdk, /Custom game-adapter capability/);
  assert.match(sdk, /executeAdapterOperation/);
  assert.match(sdk, /SENSITIVE_FIELD_PATTERN/);
  assert.match(sdk, /GameAdapterRegistry/);
  assert.match(fixtures, /GameAdapterFixtureRecorder/);
  assert.match(fixtures, /SENSITIVE_KEY/);
  assert.match(bridge, /createCurrentServerAdapter/);
  assert.match(bridge, /rust-webrcon/);
  assert.match(bridge, /palworld-rest/);
  assert.match(sdkDocs, /Game Adapter SDK/);
  assert.match(registry, /rust-server-operations/);
  assert.match(registry, /normalizeModuleOverrides/);
  assert.match(registry, /not-implemented/);
  assert.match(registry, /discord-auth:/);
  assert.match(foundation, /moduleOverrides/);
  assert.match(foundation, /modules:bulk-update/);
  assert.match(foundation, /safe-mode/);
  assert.match(runtime, /moduleDecisionForChannel/);
  assert.match(botRuntime, /blockedModuleForInteraction/);

  assert.equal(packageJson.build.publish[0].provider, 'github');
  assert.equal(packageJson.build.publish[0].releaseType, prerelease ? 'prerelease' : 'release');
  assert.equal(packageJson.build.publish[0].tagNamePrefix, 'v');
  assert.equal(packageJson.build.releaseInfo.releaseNotesFile, `release-notes/v${packageJson.version}.md`);
  assert.match(notes, /Android Companion and Mobile Gateway (?:are|remain) paused and excluded/i);
  assert.match(notes, /D&D/i);
  assert.match(notes, /No APK or Android setup link|Android Companion and Mobile Gateway remain paused and excluded/i);
  assert.match(workflow, /branches:\s*\n\s*- "release\/v\*"/);
  assert.match(workflow, /pull_request_target/);
  assert.match(workflow, /ADR-008 violation/);
  assert.match(workflow, /release-notes\/v\$version\.md/);
  assert.match(ciWorkflow, /npm audit --omit=dev --audit-level=high/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run check/);
  assert.match(workflow, /npm run dist:win/);
});

test('simple updater creates a dedicated center and always-visible header action without permanent observation', () => {
  const updater = read('renderer/simple-updater.js');
  assert.doesNotThrow(() => new Function(updater));
  assert.match(updater, /ensureFallbackCenter/);
  assert.match(updater, /nexusUpdateFallbackCenter/);
  assert.match(updater, /nexusHeaderUpdateButton/);
  assert.match(updater, /nexusSimpleUpdatePrimary/);
  assert.match(updater, /Check, download, and install updates inside the application/);
  assert.match(updater, /const replacementReady = Boolean\(\$\('nexusSimpleUpdatePrimary'\) && \$\('nexusHeaderUpdateButton'\)\)/);
  assert.match(updater, /legacy\.classList\.toggle\('hidden', replacementReady\)/);
  assert.match(updater, /RECONCILE_DELAYS_MS/);
  assert.doesNotMatch(updater, /new MutationObserver/);
});
