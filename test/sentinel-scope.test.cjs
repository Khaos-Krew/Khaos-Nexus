'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Sentinel package uses the normal desktop entry and excludes D&D and hosted server source', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.main, 'main/entry.cjs');
  assert.match(pkg.description, /Nexus Sentinel/);
  assert.match(pkg.description, /Palworld/);
  assert.match(pkg.scripts['dist:win'], /--publish never/);
  const files = new Set(pkg.build.files);
  for (const excluded of [
    '!main/dnd-*',
    '!bot/dnd-*',
    '!renderer/dnd-*',
    '!shared/dnd-*',
    '!main/entry-pdf-import.cjs',
    '!main/hosted-server-*',
    '!main/services/hosted-server-*',
    '!shared/hosted-server-*',
    '!renderer/hosted-server-*',
    '!main/nexus-core-live-migrations-extension.cjs',
    '!main/**/*pterodactyl*'
  ]) {
    assert.equal(files.has(excluded), true, `missing package exclusion ${excluded}`);
  }
  assert.match(pkg.build.nsis.artifactName, /Sentinel/);
  assert.match(pkg.build.portable.artifactName, /Sentinel/);
});

test('Sentinel desktop startup contains only the Discord and Palworld active product graph', () => {
  const source = read('main/entry.cjs');
  for (const required of [
    'module-foundation-extension.cjs',
    'module-runtime-extension.cjs',
    'palworld-main-extension.cjs',
    'discord-studio-extension.cjs',
    'discord-automation-extension.cjs',
    'status-panels-extension.cjs',
    'player-console-extension.cjs',
    'discord-observability-extension.cjs',
    'game-adapter-runtime-extension.cjs',
    'nexus-core-foundation-extension.cjs',
    'sentinel-scope-extension.cjs',
    'sentinel-bot-supervisor-boundary-extension.cjs',
    'sentinel-test-update-boundary-extension.cjs'
  ]) assert.match(source, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  for (const forbidden of [
    'dnd-',
    'ai-services-extension.cjs',
    'bundled-ai-runtimes-extension.cjs',
    'nexus-ai-core-operations-extension.cjs',
    'hosted-server-extension.cjs',
    'rust-webrcon-extension.cjs',
    'satisfactory-extension.cjs',
    'server-scheduler-extension.cjs',
    'nexus-core-scheduler-gateway-extension.cjs',
    'nexus-core-live-migrations-extension.cjs',
    'mobile-gateway-extension.cjs'
  ]) assert.doesNotMatch(source, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('Sentinel desktop supervisor spawns the Sentinel wrapper instead of raw bot/index.cjs', () => {
  const source = read('main/sentinel-bot-supervisor-boundary-extension.cjs');
  assert.match(source, /class SentinelBotSupervisor extends Original/);
  assert.match(source, /'bot', 'entry\.cjs'/);
  assert.match(source, /'\.\.', 'bot', 'entry\.cjs'/);
  assert.doesNotMatch(source, /'bot', 'index\.cjs'/);

  const entry = read('main/entry.cjs');
  assert.ok(
    entry.indexOf('sentinel-bot-supervisor-boundary-extension.cjs') < entry.indexOf("require('./main.cjs')"),
    'The Sentinel supervisor boundary must install before main.cjs constructs BotSupervisor.'
  );
});

test('Sentinel split test build cannot consume the legacy Khaos Nexus release feed', () => {
  const source = read('main/sentinel-test-update-boundary-extension.cjs');
  assert.match(source, /status: 'disabled'/);
  assert.match(source, /mode: 'sentinel-test'/);
  assert.match(source, /sentinelTestUpdateDisabled: true/);
  assert.match(source, /do not download legacy Khaos Nexus updates/);
  assert.doesNotMatch(source, /api\.github\.com\/repos\/Khaos-Krew\/Khaos-Nexus/);
  assert.doesNotMatch(source, /electron-updater/);

  const entry = read('main/entry.cjs');
  assert.ok(
    entry.indexOf('sentinel-test-update-boundary-extension.cjs') < entry.indexOf("require('./main.cjs')"),
    'The Sentinel update boundary must install before main.cjs constructs UpdateService.'
  );
});

test('primary Sentinel Discord worker has no D&D runtime', () => {
  const entry = read('bot/entry.cjs');
  assert.match(entry, /installModuleRuntime/);
  assert.match(entry, /installDiscordAutomationRuntime/);
  assert.match(entry, /installStatusPanelRuntime/);
  assert.match(entry, /sentinel-bot/);
  assert.match(entry, /require\('\.\/index\.cjs'\)/);
  assert.doesNotMatch(entry, /dnd/i);
});

test('primary Sentinel slash command surface is Palworld and Discord only', () => {
  const source = read('bot/commands.cjs');
  for (const command of ['ping', 'health', 'status', 'players', 'settings', 'metrics', 'snapshot', 'saveworld', 'broadcast', 'kick', 'ban', 'unban', 'shutdown', 'forcestop', 'rcon', 'listservers', 'managerrestart']) {
    assert.match(source, new RegExp(`setName\\('${command}'\\)`));
  }
  for (const command of ['campaign', 'character', 'roll', 'initiative', 'session', 'quest']) {
    assert.doesNotMatch(source, new RegExp(`setName\\('${command}'\\)`));
  }
  assert.match(source, /Configured Palworld server name/);
  assert.match(source, /Nexus Sentinel/);
});

test('Sentinel config boundary preserves deferred modules while blocking non-Palworld activation', () => {
  const source = read('main/sentinel-scope-extension.cjs');
  assert.match(source, /function onlyPalworldServers/);
  assert.match(source, /server\?\.game \|\| ''\)\.toLowerCase\(\) === 'palworld'/);
  assert.match(source, /SENTINEL_PALWORLD_ONLY/);
  assert.match(source, /SENTINEL_MODULE_DEFERRED/);
  assert.match(source, /primaryBotName = 'Nexus Sentinel'/);
  assert.match(source, /productScope = 'discord-palworld'/);
  assert.doesNotMatch(source, /'pterodactyl-control'/);
});

test('Sentinel renderer hides deferred product surfaces and forces Palworld server creation', () => {
  const source = read('renderer/sentinel-scope.js');
  for (const view of ['dnd', 'ai-services', 'nexus-ai', 'scheduler', 'hosted-servers', 'mobile-companion', 'rust', 'satisfactory']) {
    assert.match(source, new RegExp(`'${view.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  }
  assert.match(source, /option\.value !== 'palworld'/);
  assert.match(source, /select\.value = 'palworld'/);
  assert.match(source, /select\.disabled = true/);
  assert.match(source, /Discord \+ Palworld Control Center/);
  assert.match(source, /Start Sentinel/);
});

test('renderer asset loader reports feature readiness only for the real desktop window after bundle injection', () => {
  const source = read('main/renderer-asset-loader.cjs');
  assert.match(source, /function isMainRendererWindow/);
  assert.match(source, /renderer\\\/index\\\.html/);
  assert.match(source, /stage: 'features-ready'/);
  assert.match(source, /source: 'renderer-asset-loader'/);
  assert.match(source, /if \(!onlyId\) reportFeaturesReady\(window, selected, generation\)/);
});
