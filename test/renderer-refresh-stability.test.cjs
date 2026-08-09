'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('sidebar navigation only reconciles for actual legacy navigation mutations', () => {
  const source = read('renderer/ui-refresh.js');

  assert.match(source, /const LEGACY_NAV_SELECTOR = '\.nav-item\[data-view\]:not\(\.nexus-nav-item\)'/);
  assert.match(source, /function nodeContainsLegacyNavigation\(node\)/);
  assert.match(source, /function mutationChangesLegacyNavigation\(mutation\)/);
  assert.match(source, /\.\.\.mutation\.addedNodes, \.\.\.mutation\.removedNodes/);
  assert.match(source, /mutations\.some\(mutationChangesLegacyNavigation\)/);
  assert.doesNotMatch(source, /if \(!mutation\.target\.closest\?\.\('#nexusNavigation'\)\) return true/);
});

test('navigation structure is stable when only live state changes', () => {
  const source = read('renderer/ui-refresh.js');

  assert.match(source, /function navigationSignature\(entries\)/);
  assert.match(source, /navigation\.dataset\.structureSignature !== signature/);
  assert.match(source, /navigation\.dataset\.structureSignature = signature/);
  assert.match(source, /navigation\.replaceChildren\(fragment\)/);
});

test('renderer app state fan-out stays behind the shared state hub', () => {
  const rendererDir = path.join(root, 'renderer');
  const rendererFiles = fs.readdirSync(rendererDir).filter((name) => name.endsWith('.js'));
  const directStatePattern = /window\.khaos(?:\?\.|\.)onState(?:\?\.)?\(/;
  const direct = rendererFiles.filter((name) => directStatePattern.test(read(`renderer/${name}`)));

  assert.deepEqual(direct, ['state-hub.js']);
  assert.match(read('renderer/ui-refresh.js'), /window\.khaosStateHub\?\.subscribe\?\.\(applyServiceState\)/);
});

test('Command Center live cards and activity list do not remount on every heartbeat', () => {
  const app = read('renderer/app.js');
  const shell = read('renderer/nexus-shell-v14.js');

  assert.match(app, /activitySignature/);
  assert.match(app, /function refreshActivityTimes\(\)/);
  assert.match(app, /if \(signature === state\.activitySignature\)/);
  assert.match(app, /data-activity-time/);
  assert.match(app, /refreshActivityTimes\(\);\s*\n\s*}, 1000\);/);

  assert.match(shell, /function ensureTaskCards\(\)/);
  assert.match(shell, /function updateTaskCard\(/);
  assert.match(shell, /updateTaskCard\('discord'/);
  assert.match(shell, /updateTaskCard\('release'/);
  assert.match(shell, /updateTaskCard\('streams'/);
});

test('temporary refresh guard is not shipped or injected', () => {
  assert.equal(fs.existsSync(path.join(root, 'renderer', 'refresh-stability.js')), false);
  const loader = read('main/brand-update-extension.cjs');
  assert.doesNotMatch(loader, /refresh-stability\.js/);
  assert.ok(loader.indexOf("addScript('state-hub.js')") < loader.indexOf("addScript('ui-refresh.js')"));
});
