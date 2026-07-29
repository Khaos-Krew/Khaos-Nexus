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

test('v0.18.22 is configured for the guarded in-app GitHub release channel', () => {
  const packageJson = JSON.parse(read('package.json'));
  const notes = read('release-notes/v0.18.22.md');
  const audit = read('main/audit-repair-extension.cjs');
  const runtimeAudit = read('bot/runtime-audit.cjs');
  const workflow = read('.github/workflows/stable-release.yml');
  assert.equal(packageJson.version, '0.18.22');
  assert.match(packageJson.description, /full production runtime audit repairs/i);
  assert.match(packageJson.description, /verified click-through grouped proxy navigation/i);
  assert.match(packageJson.description, /live supervised bot configuration updates/i);
  assert.match(packageJson.description, /functional Discord status-panel buttons/i);
  assert.match(packageJson.description, /resilient error-monitor batching/i);
  assert.match(packageJson.description, /retryable updater installation failures/i);
  assert.match(audit, /reconcileInterruptedRuns/);
  assert.match(audit, /daily delivery limit/i);
  assert.match(runtimeAudit, /handleStatusButton/);
  assert.equal(packageJson.build.publish[0].provider, 'github');
  assert.equal(packageJson.build.publish[0].releaseType, 'release');
  assert.equal(packageJson.build.publish[0].tagNamePrefix, 'v');
  assert.equal(packageJson.build.releaseInfo.releaseNotesFile, 'release-notes/v0.18.22.md');
  assert.match(notes, /Full production runtime audit and repair/i);
  assert.match(notes, /live `config-update`/i);
  assert.match(notes, /Refresh Status/i);
  assert.match(notes, /daily GitHub delivery limit/i);
  assert.match(notes, /interrupted by an application restart/i);
  assert.match(notes, /mandatory verified pre-update backup/i);
  assert.match(workflow, /branches:\s*\n\s*- "release\/v\*"/);
  assert.match(workflow, /pull_request_target/);
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
