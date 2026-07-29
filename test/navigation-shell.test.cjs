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

test('safe UI layer loads grouped navigation while preserving independent scrolling', () => {
  const css = read('renderer/ui-fixes.css');
  const extension = read('main/brand-update-extension.cjs');
  assert.match(css, /^@import url\(['"]scroll-layout\.css['"]\);/);
  assert.match(css, /@import url\(['"]navigation-shell\.css['"]\);/);
  assert.match(css, /nexus-original-nav-item/);
  assert.match(css, /body:not\(\.nexus-static-navigation-active\)/);
  assert.match(extension, /addScript\('simple-updater\.js'\)/);
  assert.match(extension, /addScript\('navigation-shell\.js'\)/);
});

test('v0.20.0 is configured for the guarded Game Adapter SDK release channel', () => {
  const packageJson = JSON.parse(read('package.json'));
  const notes = read('release-notes/v0.20.0.md');
  const sdk = read('shared/game-adapter-sdk.cjs');
  const fixtures = read('shared/game-adapter-fixtures.cjs');
  const bridge = read('bot/game-adapters/current-server-adapter.cjs');
  const sdkDocs = read('docs/GAME_ADAPTER_SDK_v0.20.0.md');
  const registry = read('shared/module-registry.cjs');
  const foundation = read('main/module-foundation-extension.cjs');
  const runtime = read('main/module-runtime-extension.cjs');
  const botRuntime = read('bot/module-runtime.cjs');
  const workflow = read('.github/workflows/stable-release.yml');

  assert.equal(packageJson.version, '0.20.0');
  assert.match(packageJson.description, /typed Game Adapter SDK/i);
  assert.match(packageJson.description, /explicit capability manifests/i);
  assert.match(packageJson.description, /role-aware destructive-action policy/i);
  assert.match(packageJson.description, /bounded opt-in protocol fixtures/i);
  assert.match(packageJson.description, /authoritative Owner module switches/i);
  assert.match(packageJson.description, /full production runtime audit repairs/i);
  assert.match(sdk, /CORE_CAPABILITY_DEFINITIONS/);
  assert.match(sdk, /Custom game-adapter capability/);
  assert.match(sdk, /executeAdapterOperation/);
  assert.match(sdk, /SENSITIVE_FIELD_PATTERN/);
  assert.match(sdk, /GameAdapterRegistry/);
  assert.match(fixtures, /GameAdapterFixtureRecorder/);
  assert.match(fixtures, /SENSITIVE_KEY/);
  assert.match(bridge, /createCurrentServerAdapter/);
  assert.match(bridge, /palworld-rest/);
  assert.match(sdkDocs, /Game Adapter SDK/);
  assert.match(sdkDocs, /Rust WebRCON/);
  assert.match(registry, /normalizeModuleOverrides/);
  assert.match(registry, /not-implemented/);
  assert.match(registry, /discord-auth:/);
  assert.match(foundation, /moduleOverrides/);
  assert.match(foundation, /modules:bulk-update/);
  assert.match(foundation, /safe-mode/);
  assert.match(runtime, /moduleDecisionForChannel/);
  assert.match(botRuntime, /blockedModuleForInteraction/);
  assert.equal(packageJson.build.publish[0].provider, 'github');
  assert.equal(packageJson.build.publish[0].releaseType, 'release');
  assert.equal(packageJson.build.publish[0].tagNamePrefix, 'v');
  assert.equal(packageJson.build.releaseInfo.releaseNotesFile, 'release-notes/v0.20.0.md');
  assert.match(notes, /Game Adapter SDK foundation/i);
  assert.match(notes, /Custom, game-specific capabilities/i);
  assert.match(notes, /Operational payloads are not truncated/i);
  assert.match(notes, /Preserved v0\.19\.0 foundations/i);
  assert.match(workflow, /branches:\s*\n\s*- "release\/v\*"/);
  assert.match(workflow, /pull_request_target/);
  assert.match(workflow, /npm audit --omit=dev --audit-level=high/);
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
