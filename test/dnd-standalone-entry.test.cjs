'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('package targets the standalone D&D Windows product without CI publishing', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.main, 'main/entry-dnd-standalone.cjs');
  assert.equal(pkg.build.appId, 'com.khaosnexus.dnd');
  assert.equal(pkg.build.productName, 'Nexus D&D');
  assert.equal(pkg.build.directories.output, 'dist-dnd');
  assert.match(pkg.build.nsis.artifactName, /^Nexus-DnD-Setup-/);
  assert.match(pkg.build.portable.artifactName, /^Nexus-DnD-Portable-/);
  assert.match(pkg.scripts['dist:win'], /--publish never/);
});

test('standalone entry loads D&D, Discord Store policy and Veyra but not game-server or Sentinel AI surfaces', () => {
  const source = read('main/entry-dnd-standalone.cjs');

  for (const required of [
    'dnd-campaign-extension.cjs',
    'dnd-discord-provisioning-runtime-extension.cjs',
    'dnd-ai-gm-extension.cjs',
    'dnd-ai-maps-extension.cjs',
    'dnd-co-dm-extension.cjs',
    'dnd-campaign-runtime-extension.cjs',
    'dnd-group-runtime-extension.cjs',
    'dnd-monetization-extension.cjs',
    'ai-services-extension.cjs',
    'bundled-ai-runtimes-extension.cjs',
    'dnd-standalone-ai-runtime-boundary-extension.cjs',
    'dnd-standalone-update-boundary-extension.cjs',
    'dnd-standalone-shell-extension.cjs'
  ]) {
    assert.match(source, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  for (const forbidden of [
    'nexus-ai-core-operations-extension.cjs',
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

test('standalone Veyra lifecycle boundary rejects the Nexus Sentinel worker', () => {
  const source = read('main/dnd-standalone-ai-runtime-boundary-extension.cjs');
  assert.match(source, /allowedAgents: \['dnd'\]/);
  assert.match(source, /return runtimes\.start\('dnd'\)/);
  assert.match(source, /return runtimes\.restart\('dnd'\)/);
  assert.match(source, /return runtimes\.stop\('dnd'\)/);
  assert.match(source, /Nexus D&D can start only the Veyra D&D AI runtime/);
  assert.match(source, /'ai:runtimes-start'/);
  assert.match(source, /electron\.ipcMain\.removeHandler\(channel\)/);
});

test('standalone update boundary cannot consume the Khaos Nexus release feed', () => {
  const source = read('main/dnd-standalone-update-boundary-extension.cjs');
  assert.match(source, /status: 'disabled'/);
  assert.match(source, /mode: 'standalone'/);
  assert.match(source, /standaloneUpdateDisabled: true/);
  assert.match(source, /do not download Khaos Nexus updates/);
  assert.doesNotMatch(source, /api\.github\.com\/repos\/Khaos-Krew\/Khaos-Nexus/);
  assert.doesNotMatch(source, /electron-updater/);
});

test('standalone installer diagnostics shortcut points only at Nexus D&D', () => {
  const installer = read('assets/installer.nsh');
  assert.match(installer, /Nexus D&D Diagnostics\.lnk/);
  assert.match(installer, /Nexus D&D\.exe/);
  assert.doesNotMatch(installer, /Khaos Nexus\.exe/);
});

test('standalone Discord worker only registers D&D and health commands with entitlement gating', () => {
  const source = read('bot/entry.cjs');
  assert.match(source, /dndCommands/);
  assert.match(source, /Nexus D&D bot runtime health/);
  assert.match(source, /handleDndInteraction/);
  assert.match(source, /discord-entitlement-policy\.cjs/);
  assert.match(source, /enforceStoreAccess/);
  assert.doesNotMatch(source, /installModuleRuntime/);
  assert.doesNotMatch(source, /installStatusPanelRuntime/);
  assert.doesNotMatch(source, /installDiscordAutomationRuntime/);
  assert.doesNotMatch(source, /game-adapters/);
  assert.doesNotMatch(source, /executeServerAction/);
});

test('Discord Store policy has an owner editor in the standalone D&D renderer', () => {
  const main = read('main/dnd-monetization-extension.cjs');
  const renderer = read('renderer/dnd-monetization.js');
  assert.match(main, /dnd:monetization-get/);
  assert.match(main, /dnd:monetization-set/);
  assert.match(main, /pushDndConfig/);
  assert.match(renderer, /Discord Store ranks &amp; feature locks/);
  assert.match(renderer, /dnd\.roll/);
  assert.match(renderer, /Save Discord Store Policy/);
});

test('standalone shell exposes only campaign, bot, Veyra, logs and settings surfaces', () => {
  const source = read('renderer/dnd-standalone-shell.js');
  assert.match(source, /const PRODUCT = 'Nexus D&D'/);
  assert.match(source, /new Set\(\['dnd', 'setup', 'ai-services', 'logs', 'settings'\]\)/);
  assert.doesNotMatch(source, /new Set\([^\n]*'nexus-ai'/);
  assert.match(source, /Veyra AI Runtime/);
  assert.match(source, /Dedicated D&D Discord bot/);
  assert.match(source, /aiCoreConnectionForm/);
});