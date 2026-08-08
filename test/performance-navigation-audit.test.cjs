'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('primary navigation owns explicit product directories and never defaults unknown workspaces to Settings', () => {
  const ui = read('renderer/ui-refresh.js');
  const v14 = read('renderer/nexus-shell-v14.js');
  const brand = read('main/brand-update-extension.cjs');

  for (const label of ['D&D', 'Nexus AI', 'Discord & Community', 'Game Servers', 'Operations & Access', 'Modules & Tools', 'System']) {
    assert.match(ui, new RegExp(label.replace(/[&]/g, '&')));
  }
  assert.match(ui, /return 'modules';/);
  assert.doesNotMatch(ui, /return 'settings';/);
  assert.match(v14, /return 'modules';/);
  assert.doesNotMatch(v14, /return 'settings';/);
  assert.match(brand, /addScript\('ui-refresh\.js'\)/);
  assert.doesNotMatch(brand, /addScript\('navigation-shell\.js'\)/);
  assert.match(ui, /new MutationObserver/);
  assert.match(ui, /navigationObserver\.observe\(sidebar, \{ childList: true, subtree: true \}\)/);
  assert.match(ui, /nexus-legacy-navigation/);
  assert.match(ui, /installDndFallbackWorkspace/);
  assert.doesNotMatch(ui, /ensureView\('dnd'/);
});

test('interface watchdog retains startup visual validation but does not capture the desktop forever', () => {
  const watchdog = read('main/interface-watchdog-extension.cjs');
  assert.match(watchdog, /capturePage\(\)/);
  assert.match(watchdog, /if \(result\?\.stable\) stopInspection\(\)/);
  assert.match(watchdog, /stopDiscovery\(\);\r?\n  currentWindow = window/);
  assert.match(watchdog, /startInspection\('did-navigate'\)/);
  assert.doesNotMatch(watchdog, /scheduleInspection\('continuous'\)/);
  assert.doesNotMatch(watchdog, /setInterval\(discover, DISCOVERY_INTERVAL_MS\)/);
});

test('renderer liveness uses one preload heartbeat and no duplicate five-second state polling', () => {
  const preload = read('main/preload.cjs');
  const stability = read('renderer/stability-fixes.js');
  assert.match(preload, /setInterval\(sendRendererHeartbeat, 2000\)/);
  assert.doesNotMatch(stability, /stability:heartbeat/);
  assert.doesNotMatch(stability, /setInterval\(refreshState/);
  assert.doesNotMatch(stability, /setInterval\(sendHeartbeat/);
});

test('D&D workspace relies on pushed state instead of remounting the full workspace every 15 seconds', () => {
  const dnd = read('renderer/dnd-workspace.js');
  assert.match(dnd, /window\.khaos\.onDnd/);
  assert.doesNotMatch(dnd, /15000/);
  assert.doesNotMatch(dnd, /setInterval\(/);
});

test('startup and AI polling stop when their surfaces are no longer active', () => {
  const startup = read('renderer/startup-health.js');
  const controls = read('renderer/ai-runtime-controls-hotfix.js');
  assert.match(startup, /if \(state\.released && countdownTimer\)/);
  assert.match(startup, /clearInterval\(countdownTimer\)/);
  assert.match(controls, /!aiWorkspaceActive\(\)/);
  assert.match(controls, /if \(!aiWorkspaceActive\(\)\) return stopPolling\(\)/);
});
