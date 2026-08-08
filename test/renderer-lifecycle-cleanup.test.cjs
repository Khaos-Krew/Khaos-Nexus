'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const dndRendererExtensions = [
  'dnd-action-rejection-boundary-extension.cjs',
  'dnd-ai-gm-extension.cjs',
  'dnd-ai-homebrew-extension.cjs',
  'dnd-ai-homebrew-ui-contract-extension.cjs',
  'dnd-ai-map-stability-extension.cjs',
  'dnd-ai-maps-extension.cjs',
  'dnd-authorization-summary-extension.cjs',
  'dnd-campaign-extension.cjs',
  'dnd-campaign-runtime-extension.cjs',
  'dnd-co-dm-extension.cjs',
  'dnd-co-dm-stability-extension.cjs',
  'dnd-content-catalog-extension.cjs',
  'dnd-discord-bot-registry-bridge-extension.cjs',
  'dnd-discord-provisioning-extension.cjs',
  'dnd-encounter-panels-extension.cjs',
  'dnd-group-runtime-extension.cjs',
  'dnd-live-maps-extension.cjs',
  'dnd-npc-tool-extension.cjs',
  'dnd-owner-license-default-extension.cjs',
  'dnd-owner-workflows-extension.cjs',
  'dnd-solo-combat-extension.cjs',
  'dnd-usability-repair-extension.cjs',
  'dnd-world-content-extension.cjs'
];

test('D&D renderer assets share the centralized lifecycle loader', () => {
  const loader = read('main/renderer-asset-loader.cjs');
  assert.match(loader, /browser-window-created/);
  assert.match(loader, /did-finish-load/);
  assert.match(loader, /registerRendererBundle/);

  for (const file of dndRendererExtensions) {
    const source = read(`main/${file}`);
    assert.match(source, /registerRendererBundle/ , `${file} should register a centralized bundle`);
    assert.doesNotMatch(source, /browser-window-created/, `${file} should not own a BrowserWindow lifecycle hook`);
    assert.doesNotMatch(source, /did-finish-load/, `${file} should not own a did-finish-load listener`);
  }
});

test('centralized D&D loading materially reduces main-process load listeners', () => {
  const files = fs.readdirSync(path.join(root, 'main')).filter((name) => name.endsWith('.cjs'));
  const listenerFiles = files.filter((name) => read(`main/${name}`).includes('did-finish-load'));
  assert.ok(listenerFiles.length <= 23, `expected <=23 did-finish-load owners after consolidation, found ${listenerFiles.length}`);
});

test('renderer state uses one IPC subscription hub', () => {
  const rendererFiles = fs.readdirSync(path.join(root, 'renderer')).filter((name) => name.endsWith('.js'));
  const direct = rendererFiles.filter((name) => read(`renderer/${name}`).includes('window.khaos.onState('));
  assert.deepEqual(direct, ['state-hub.js']);

  const hub = read('renderer/state-hub.js');
  assert.match(hub, /const listeners = new Set\(\)/);
  assert.match(hub, /unsubscribe = window\.khaos\.onState\(publish\)/);
  assert.match(hub, /return \(\) => listeners\.delete\(listener\)/);

  const html = read('renderer/index.html');
  assert.ok(html.indexOf('state-hub.js') < html.indexOf('app.js'), 'state hub must load before base renderer app.js');
  const brand = read('main/brand-update-extension.cjs');
  assert.ok(brand.indexOf("addScript('state-hub.js')") < brand.indexOf("addScript('ui-refresh.js')"), 'secondary renderer injection should load state hub before UI refresh');
});


test('D&D DOM mutation fan-out is centralized and scoped to the main content surface', () => {
  const hub = read('renderer/dnd-dom-hub.js');
  assert.match(hub, /const listeners = new Set\(\)/);
  assert.match(hub, /document\.querySelector\('main\.content'\) \|\| document\.body/);
  assert.match(hub, /observer\.observe\(root, \{ childList: true, subtree: true \}\)/);

  for (const file of ['dnd-solo-combat.js', 'dnd-campaign-runtime.js', 'dnd-group-runtime.js', 'dnd-authorization-summary.js', 'dnd-ai-gm.js']) {
    const source = read(`renderer/${file}`);
    assert.match(source, /khaosDndDomHub\?\.subscribe/);
    assert.doesNotMatch(source, /new MutationObserver/);
    assert.doesNotMatch(source, /documentElement.*subtree/s);
  }

  const rendererFiles = fs.readdirSync(path.join(root, 'renderer')).filter((name) => name.endsWith('.js'));
  const observerOwners = rendererFiles.filter((name) => read(`renderer/${name}`).includes('new MutationObserver'));
  assert.ok(observerOwners.length <= 4, `expected <=4 MutationObserver owners after D&D consolidation, found ${observerOwners.length}`);
});

test('remaining periodic UI work is visibility or active-workspace gated', () => {
  assert.match(read('renderer/app.js'), /if \(document\.hidden\) return;/);
  assert.match(read('renderer/autonomy.js'), /document\.hidden \|\| !byId\('view-autonomy'\)\?\.classList\.contains\('active'\)/);
  assert.match(read('renderer/application-monitor.js'), /document\.hidden \|\| !byId\('view-monitor'\)\?\.classList\.contains\('active'\)/);
  assert.match(read('renderer/discord-studio.js'), /view-discord-studio.*classList\.contains\('active'\)/s);
  assert.match(read('renderer/nexus-ai-operations.js'), /view-ai.*classList\.contains\('active'\)/s);
  assert.match(read('renderer/hosted-server.js'), /view-hosted-servers.*classList\.contains\('active'\)/s);
  assert.match(read('renderer/player-console.js'), /view-players.*classList\.contains\('active'\)/s);
});
