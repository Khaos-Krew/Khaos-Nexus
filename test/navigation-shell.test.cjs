'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('navigation renderer is valid JavaScript and enters original-DOM safe mode', () => {
  const source = read('renderer/navigation-shell.js');
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /__khaosNavigationShellInstalled/);
  assert.match(source, /navigation-safe-mode/);
  assert.match(source, /mode: 'original-dom'/);
  assert.match(source, /Dynamic navigation reparenting is temporarily disabled/);
  assert.doesNotMatch(source, /appendChild\(item\)/);
  assert.doesNotMatch(source, /MutationObserver/);
});

test('safe UI layer preserves original navigation containers and scrolling', () => {
  const css = read('renderer/ui-fixes.css');
  const extension = read('main/brand-update-extension.cjs');
  assert.match(css, /^@import url\(['"]scroll-layout\.css['"]\);/);
  assert.doesNotMatch(css, /navigation-shell\.css/);
  assert.doesNotMatch(css, /nexus-legacy-navigation/);
  assert.match(extension, /addScript\('simple-updater\.js'\)/);
  assert.match(extension, /addScript\('navigation-shell\.js'\)/);
});

test('v0.18.18 is configured for the guarded in-app GitHub release channel', () => {
  const packageJson = JSON.parse(read('package.json'));
  const notes = read('release-notes/v0.18.18.md');
  const workflow = read('.github/workflows/stable-release.yml');
  assert.equal(packageJson.version, '0.18.18');
  assert.match(packageJson.description, /synchronized live Discord runtime status/i);
  assert.match(packageJson.description, /spawn-confirmed supervised process IDs/i);
  assert.match(packageJson.description, /bounded idempotent in-app updater UI/i);
  assert.match(packageJson.description, /renderer-unresponsive reporting/i);
  assert.match(packageJson.description, /always-visible in-app update control/i);
  assert.equal(packageJson.build.publish[0].provider, 'github');
  assert.equal(packageJson.build.publish[0].releaseType, 'release');
  assert.equal(packageJson.build.publish[0].tagNamePrefix, 'v');
  assert.equal(packageJson.build.releaseInfo.releaseNotesFile, 'release-notes/v0.18.18.md');
  assert.match(notes, /Discord runtime state synchronization/i);
  assert.match(notes, /older startup snapshot/i);
  assert.match(notes, /utility-process PID/i);
  assert.match(notes, /v0\.18\.17 startup and renderer-unfreeze behavior/i);
  assert.match(workflow, /branches:\s*\n\s*- "release\/v\*"/);
  assert.match(workflow, /pull_request_target/);
  assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(workflow, /startsWith\(github\.event\.pull_request\.head\.ref, 'publish\/v'\)/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run check/);
  assert.match(workflow, /npm run dist:win/);
  assert.match(workflow, /Khaos-Nexus-Setup-\$version-x64\.exe/);
  assert.match(workflow, /Khaos-Nexus-Portable-\$version-x64\.exe/);
  assert.match(workflow, /dist\/latest\.yml/);
});

test('simple updater creates a replacement button without permanent DOM observation', () => {
  const updater = read('renderer/simple-updater.js');
  assert.doesNotThrow(() => new Function(updater));
  assert.match(updater, /settingsPanel\?\.querySelector\('\.form-actions'\)/);
  assert.match(updater, /ensureFallbackCenter/);
  assert.match(updater, /nexusUpdateFallbackCenter/);
  assert.match(updater, /const replacementReady = Boolean\(\$\('nexusSimpleUpdatePrimary'\)\)/);
  assert.match(updater, /legacy\.classList\.toggle\('hidden', replacementReady\)/);
  assert.match(updater, /exportBackupButton/);
  assert.match(updater, /RECONCILE_DELAYS_MS/);
  assert.doesNotMatch(updater, /new MutationObserver/);
});
