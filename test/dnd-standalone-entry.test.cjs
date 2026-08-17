'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('package targets the standalone D&D Windows product', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.main, 'main/entry-dnd-standalone.cjs');
  assert.equal(pkg.build.appId, 'com.khaosnexus.dnd');
  assert.equal(pkg.build.productName, 'Nexus D&D');
  assert.equal(pkg.build.directories.output, 'dist-dnd');
  assert.match(pkg.build.nsis.artifactName, /^Nexus-DnD-Setup-/);
  assert.match(pkg.build.portable.artifactName, /^Nexus-DnD-Portable-/);
});

test('standalone entry loads D&D and AI but not game-server stacks', () => {
  const source = read('main/entry-dnd-standalone.cjs');

  for (const required of [
    'dnd-campaign-extension.cjs',
    'dnd-discord-provisioning-runtime-extension.cjs',
    'dnd-ai-gm-extension.cjs',
    'dnd-ai-maps-extension.cjs',
    'dnd-co-dm-extension.cjs',
    'dnd-campaign-runtime-extension.cjs',
    'dnd-group-runtime-extension.cjs',
    'ai-services-extension.cjs',
    'bundled-ai-runtimes-extension.cjs',
    'nexus-ai-core-operations-extension.cjs',
    'dnd-standalone-shell-extension.cjs'
  ]) {
    assert.match(source, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  for (const forbidden of [
    'hosted-server-control-extension.cjs',
    'rust-webrcon-extension.cjs',
    'satisfactory-extension.cjs',
    'server-scheduler-extension.cjs',
    'player-console-extension.cjs',
    'mobile-gateway-extension.cjs',
    'module-catalog-extension.cjs'
  ]) {
    assert.doesNotMatch(source, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('standalone shell exposes only campaign, bot, AI, logs and settings surfaces', () => {
  const source = read('renderer/dnd-standalone-shell.js');
  assert.match(source, /const PRODUCT = 'Nexus D&D'/);
  assert.match(source, /new Set\(\['dnd', 'setup', 'ai-services', 'nexus-ai', 'logs', 'settings'\]\)/);
  assert.match(source, /Dedicated D&D Discord bot/);
  assert.match(source, /Nexus Sentinel/);
});
