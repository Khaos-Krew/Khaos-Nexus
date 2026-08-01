'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('scroll correction is loaded through the always-on UI fixes layer', () => {
  const uiFixes = read('renderer/ui-fixes.css');
  assert.match(uiFixes, /^@import url\(['"]scroll-layout\.css['"]\);/);
});

test('application grid establishes bounded independent scroll containers', () => {
  const css = read('renderer/scroll-layout.css');
  assert.match(css, /\.app-shell\s*\{[^}]*height:\s*100dvh;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.sidebar,\s*\.content\s*\{[^}]*min-height:\s*0;[^}]*max-height:\s*100dvh;/s);
});

test('sidebar and workspace remain vertically scrollable in base and rich-brand modes', () => {
  const css = read('renderer/scroll-layout.css');
  assert.match(css, /\.sidebar,\s*body\.nexus-v8 \.sidebar\s*\{[^}]*overflow-y:\s*auto\s*!important;/s);
  assert.match(css, /\.content,\s*body\.nexus-v8 \.content\s*\{[^}]*overflow-y:\s*auto\s*!important;/s);
  assert.match(css, /overflow-x:\s*hidden\s*!important/);
  assert.match(css, /overscroll-behavior-y:\s*contain/);
  assert.match(css, /touch-action:\s*pan-y/);
});

test('nested logs and diagnostic outputs retain their own scrolling', () => {
  const css = read('renderer/scroll-layout.css');
  for (const selector of ['.activity-list', '.log-console', '.error-panel pre', '.monitor-renderer-error-body pre', '.nexus-release-notes']) {
    assert.ok(css.includes(selector), `${selector} should be included in nested scroll protection`);
  }
});

test('v0.25.0 retains scrolling, Owner modules, Android exclusion and local recovery behavior', () => {
  const packageJson = JSON.parse(read('package.json'));
  const preload = read('main/preload.cjs');
  const portable = read('main/portable-bootstrap-extension.cjs');
  const health = read('main/startup-health-extension.cjs');
  const entry = read('main/entry.cjs');
  const watchdog = read('main/interface-watchdog-extension.cjs');
  const updater = read('renderer/simple-updater.js');
  const navigation = read('renderer/navigation-shell.js');
  const moduleRuntime = read('renderer/module-runtime.js');
  const moduleCss = read('renderer/module-runtime.css');
  const localAuthority = read('main/local-module-authority-extension.cjs');
  const adapterSdk = read('shared/game-adapter-sdk.cjs');
  const rustUi = read('renderer/rust-webrcon-ui.js');
  const rustCss = read('renderer/rust-webrcon-ui.css');
  const mobileUi = read('renderer/mobile-companion.js');
  const mobileCss = read('renderer/mobile-companion.css');
  const mobileHold = read('main/mobile-production-hold-extension.cjs');
  const audit = read('main/audit-repair-extension.cjs');

  assert.equal(packageJson.version, '0.25.0');
  assert.match(packageJson.description, /unconditional local-desktop module recovery controls/i);
  assert.match(packageJson.description, /preserved but paused Android Companion and Mobile Gateway/i);
  assert.match(packageJson.description, /D&D campaign integration/i);
  assert.match(packageJson.description, /dedicated Rust WebRCON operations/i);
  assert.match(packageJson.description, /typed Game Adapter SDK/i);
  assert.match(packageJson.description, /compact production dashboard density/i);
  assert.match(packageJson.description, /independently scrollable navigation and workspace panes/i);
  assert.match(packageJson.description, /verified click-through grouped proxy navigation/i);
  assert.match(packageJson.description, /always-visible in-app update center/i);
  assert.match(packageJson.description, /continuous visible-interface startup gate/i);
  assert.match(packageJson.description, /renderer-unresponsive reporting/i);
  assert.match(packageJson.description, /authoritative Owner module switches/i);
  assert.match(localAuthority, /local owner out of their own application/);
  assert.doesNotMatch(preload, /require\(['"]\.\.?\//);
  assert.doesNotMatch(updater, /new MutationObserver/);
  assert.doesNotMatch(navigation, /new MutationObserver/);
  assert.doesNotMatch(rustUi, /new MutationObserver/);
  assert.doesNotMatch(mobileUi, /new MutationObserver/);
  assert.match(navigation, /proxy\.dataset\.viewProxy/);
  assert.match(moduleRuntime, /nexus-module-disabled-target/);
  assert.match(moduleRuntime, /metricModules/);
  assert.match(moduleRuntime, /state\.botStatus/);
  assert.match(moduleRuntime, /Not Implemented/);
  assert.match(moduleCss, /display:\s*none\s*!important/);
  assert.match(rustCss, /rust-operation-output/);
  assert.match(rustCss, /overflow:\s*auto/);

  // Mobile renderer and security assets remain preserved, but runtime/navigation activation is blocked.
  assert.match(mobileCss, /mobile-device-list/);
  assert.match(mobileCss, /overflow-wrap:\s*anywhere/);
  assert.match(mobileHold, /launchView: null/);
  assert.match(mobileHold, /enabled: false/);
  assert.match(mobileHold, /effectiveEnabled: false/);
  assert.match(mobileHold, /paused-by-owner-directive/);

  assert.match(adapterSdk, /roleAtLeast/);
  assert.match(adapterSdk, /redactAdapterValue/);
  assert.match(audit, /serverHealth: health/);
  assert.match(audit, /Recovered interrupted server scheduler state/);
  assert.match(portable, /bootstrap\.log/);
  assert.match(health, /MINIMUM_SPLASH_MS = 30 \* 1000/);
  assert.match(entry, /interface-watchdog-extension\.cjs/);
  assert.match(entry, /renderer-unresponsive-extension\.cjs/);
  assert.match(entry, /local-module-authority-extension\.cjs/);
  assert.match(entry, /module-runtime-extension\.cjs/);
  assert.match(entry, /mobile-production-hold-extension\.cjs/);
  assert.match(entry, /if \(mobileGatewayEnabled\)/);
  assert.match(entry, /audit-repair-extension\.cjs/);
  assert.match(entry, /rust-main-extension\.cjs/);
  assert.match(watchdog, /interface-watchdog-state\.json/);
});
