'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('navigation shell renderer is valid JavaScript and installs once', () => {
  const source = read('renderer/navigation-shell.js');
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /__khaosNavigationShellInstalled/);
  assert.match(source, /MutationObserver/);
  assert.match(source, /requestAnimationFrame\(organize\)/);
});

test('navigation is grouped into a small stable set of top-level sections', () => {
  const source = read('renderer/navigation-shell.js');
  for (const label of ['Servers', 'Discord & Community', 'Automation', 'Modules & Tools', 'System']) {
    assert.ok(source.includes(`label: '${label}'`), `${label} group should exist`);
  }
  assert.match(source, /id === 'dashboard'/);
  assert.match(source, /data-navigation-home/);
});

test('future module navigation entries are classified and reorganized dynamically', () => {
  const source = read('renderer/navigation-shell.js');
  assert.match(source, /function classify\(view\)/);
  assert.match(source, /\(server\|palworld\|ark\|player\|hosted\|rcon\|console\)/);
  assert.match(source, /\(scheduler\|schedule\|automation\|routine\|task\|restart-plan\)/);
  assert.match(source, /return 'modules'/);
  assert.match(source, /observer\.observe\(sidebar, \{ subtree: true, childList: true, attributes: true/);
});

test('navigation search, accordion persistence, and duplicate suppression are present', () => {
  const source = read('renderer/navigation-shell.js');
  assert.match(source, /type=\"search\"/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /event\.key === 'Enter'/);
  assert.match(source, /localStorage\.setItem\(STORAGE_KEY/);
  assert.match(source, /if \(other !== details\) other\.open = false/);
  assert.match(source, /navigationDuplicate/);
});

test('always-on UI layer loads grouped navigation in software and rich modes', () => {
  const css = read('renderer/ui-fixes.css');
  const extension = read('main/brand-update-extension.cjs');
  assert.match(css, /^@import url\(['"]scroll-layout\.css['"]\);\s*@import url\(['"]navigation-shell\.css['"]\);/);
  assert.match(extension, /addScript\('navigation-shell\.js'\)/);
  assert.match(extension, /addScript\('simple-updater\.js'\);\s*addScript\('navigation-shell\.js'\)/);
});

test('v0.18.12 is configured as an in-app GitHub release update', () => {
  const packageJson = JSON.parse(read('package.json'));
  const notes = read('release-notes/v0.18.12.md');
  const workflow = read('.github/workflows/publish-patch.yml');
  assert.equal(packageJson.version, '0.18.12');
  assert.match(packageJson.description, /searchable collapsible navigation groups/i);
  assert.equal(packageJson.build.publish[0].provider, 'github');
  assert.equal(packageJson.build.publish[0].releaseType, 'release');
  assert.equal(packageJson.build.publish[0].tagNamePrefix, 'v');
  assert.equal(packageJson.build.releaseInfo.releaseNotesFile, 'release-notes/v0.18.12.md');
  assert.match(notes, /Download Update → Install & Restart/);
  assert.match(notes, /mandatory verified pre-update backup/i);
  assert.match(workflow, /npm run release:win/);
  assert.match(workflow, /release\/v\$\{VERSION\}/);
});
