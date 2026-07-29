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

test('v0.19.0 retains startup and scrolling while module switches hide only disabled workspaces', () => {
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
  const audit = read('main/audit-repair-extension.cjs');

  assert.equal(packageJson.version, '0.19.0');
  assert.match(packageJson.description, /compact production dashboard density/i);
  assert.match(packageJson.description, /independently scrollable navigation and workspace panes/i);
  assert.match(packageJson.description, /verified click-through grouped proxy navigation/i);
  assert.match(packageJson.description, /always-visible in-app update center/i);
  assert.match(packageJson.description, /continuous visible-interface startup gate/i);
  assert.match(packageJson.description, /renderer-unresponsive reporting/i);
  assert.match(packageJson.description, /authoritative Owner module switches/i);
  assert.doesNotMatch(preload, /require\(['"]\.\.?\//);
  assert.doesNotMatch(updater, /new MutationObserver/);
  assert.doesNotMatch(navigation, /new MutationObserver/);
  assert.match(navigation, /proxy\.dataset\.viewProxy/);
  assert.match(moduleRuntime, /nexus-module-disabled-target/);
  assert.match(moduleRuntime, /metricModules/);
  assert.match(moduleRuntime, /state\.botStatus/);
  assert.match(moduleRuntime, /Not Implemented/);
  assert.match(moduleCss, /display:\s*none\s*!important/);
  assert.match(audit, /serverHealth: health/);
  assert.match(audit, /Recovered interrupted server scheduler state/);
  assert.match(portable, /bootstrap\.log/);
  assert.match(health, /MINIMUM_SPLASH_MS = 30 \* 1000/);
  assert.match(entry, /interface-watchdog-extension\.cjs/);
  assert.match(entry, /renderer-unresponsive-extension\.cjs/);
  assert.match(entry, /module-runtime-extension\.cjs/);
  assert.match(entry, /audit-repair-extension\.cjs/);
  assert.match(watchdog, /interface-watchdog-state\.json/);
});