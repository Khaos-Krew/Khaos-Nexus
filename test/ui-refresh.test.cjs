'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

const legacyViews = ['dashboard', 'setup', 'servers', 'modules', 'monitor', 'logs', 'settings'];

test('UI refresh loads through the existing optional renderer extension path', () => {
  const permissionState = read('renderer/permission-state.js');
  assert.match(permissionState, /script\.src = 'ui-refresh\.js'/);
  assert.match(permissionState, /The legacy interface remains available/);
});

test('D&D and Nexus AI are dedicated first-class views', () => {
  const source = read('renderer/ui-refresh.js');
  assert.match(source, /dnd:\s*\{/);
  assert.match(source, /ai:\s*\{/);
  assert.match(source, /id = 'view-dnd'/);
  assert.match(source, /id = 'view-ai'/);
  assert.match(source, /createNavButton\('dnd'/);
  assert.match(source, /createNavButton\('ai'/);
  assert.match(source, /Campaign data stays with D&D/);
  assert.match(source, /Nexus AI Core remains advisory/);
});

test('legacy navigation view IDs and controls remain present', () => {
  const index = read('renderer/index.html');
  for (const view of legacyViews) {
    assert.match(index, new RegExp(`id=["']view-${view}["']`));
    assert.match(index, new RegExp(`data-view=["']${view}["']`));
  }
  for (const id of ['startButton', 'restartButton', 'stopButton', 'saveDiscordButton', 'serverList', 'moduleGrid', 'logConsole', 'saveSettingsButton']) {
    assert.match(index, new RegExp(`id=["']${id}["']`));
  }
});

test('graphics are local, layered, and reduced-motion safe', () => {
  const css = read('renderer/ui-refresh.css');
  assert.match(css, /nexus-command-core\.svg/);
  assert.match(css, /nexus-dnd-runes\.svg/);
  assert.match(css, /nexus-ai-core\.svg/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(css, /https?:\/\//);

  for (const file of ['assets/ui/nexus-command-core.svg', 'assets/ui/nexus-dnd-runes.svg', 'assets/ui/nexus-ai-core.svg']) {
    const svg = read(file);
    assert.match(svg, /^<svg/);
    assert.doesNotMatch(svg, /<script/i);
    assert.doesNotMatch(svg, /(?:href|src)=["']https?:\/\//i);
  }
});

test('README documents the dedicated workspaces and non-release boundary', () => {
  const readme = read('README.md');
  assert.match(readme, /\*\*D&D\*\*/);
  assert.match(readme, /\*\*Nexus AI\*\*/);
  assert.match(readme, /requests reduced motion/i);
  assert.match(readme, /must not publish or modify a release channel/i);
  assert.match(readme, /nexus-mobile-companion/);
});
