'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const rendererDir = path.join(root, 'renderer');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('renderer app-state fan-out has one IPC authority', () => {
  const directStatePattern = /window\.khaos(?:\?\.|\.)onState(?:\?\.)?\(/;
  const offenders = fs.readdirSync(rendererDir)
    .filter((name) => name.endsWith('.js') && name !== 'state-hub.js')
    .filter((name) => directStatePattern.test(fs.readFileSync(path.join(rendererDir, name), 'utf8')))
    .sort();

  assert.deepEqual(offenders, []);
  assert.match(read('renderer/state-hub.js'), /window\.khaos\.onState\(publish\)/);
});

test('late renderer consumers can bind after state hub readiness', () => {
  const hub = read('renderer/state-hub.js');
  const moduleRuntime = read('renderer/module-runtime.js');
  const updater = read('renderer/simple-updater.js');

  assert.match(hub, /khaos:state-hub-ready/);
  assert.match(moduleRuntime, /window\.khaosStateHub\.subscribe\(onAppState, \{ replay: true \}\)/);
  assert.match(moduleRuntime, /addEventListener\('khaos:state-hub-ready', bindStateHub/);
  assert.match(updater, /window\.khaosStateHub\.subscribe\(applyAppState, \{ replay: true \}\)/);
  assert.match(updater, /addEventListener\('khaos:state-hub-ready', bindStateHub/);
});

test('Nexus Core contracts stay independent of privileged runtime adapters', () => {
  const contracts = read('shared/nexus-core/contracts.cjs');
  assert.doesNotMatch(contracts, /require\(['"]electron['"]\)/);
  assert.doesNotMatch(contracts, /discord\.js|rcon|child_process|supabase/i);
});
