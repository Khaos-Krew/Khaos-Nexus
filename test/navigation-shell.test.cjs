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

test('v0.18.16 is configured for the guarded in-app GitHub release channel', () => {
  const packageJson = JSON.parse(read('package.json'));
  const notes = read('release-notes/v0.18.16.md');
  const workflow = read('.github/workflows/stable-release.yml');
  assert.equal(packageJson.version, '0.18.16');
  assert.match(packageJson.description, /continuous visible-interface startup gate/i);
  assert.match(packageJson.description, /always-visible in-app update control/i);
  assert.equal(packageJson.build.publish[0].provider, 'github');
  assert.equal(packageJson.build.publish[0].releaseType, 'release');
  assert.equal(packageJson.build.publish[0].tagNamePrefix, 'v');
  assert.equal(packageJson.build.releaseInfo.releaseNotesFile, 'release-notes/v0.18.16.md');
  assert.match(notes, /visible interface startup gate/i);
  assert.match(notes, /verified pre-update backup/i);
  assert.match(notes, /interface-watchdog-state\.json/);
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

test('simple updater creates a replacement button without requiring nexusUpdateCenter', () => {
  const updater = read('renderer/simple-updater.js');
  assert.doesNotThrow(() => new Function(updater));
  assert.match(updater, /settingsPanel\?\.querySelector\('\.form-actions'\)/);
  assert.match(updater, /ensureFallbackCenter/);
  assert.match(updater, /nexusUpdateFallbackCenter/);
  assert.match(updater, /const replacementReady = Boolean\(\$\('nexusSimpleUpdatePrimary'\)\)/);
  assert.match(updater, /legacy\.classList\.toggle\('hidden', replacementReady\)/);
  assert.match(updater, /exportBackupButton/);
});
