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
  assert.match(pkg.khaosRelease.displayVersion, /SENTINEL-RC1/);
  assert.match(pkg.build.nsis.artifactName, /RC1/);
  assert.match(pkg.build.portable.artifactName, /RC1/);
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
    '!main/sentinel-test-update-boundary-extension.cjs',
    '!main/**/*pterodactyl*'
  ]) {
    assert.equal(files.has(excluded), true, `missing package exclusion ${excluded}`);
  }
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
    'sentinel-readiness-extension.cjs',
    'sentinel-backup-safety-extension.cjs',
    'sentinel-update-extension.cjs',
    'sentinel-owner-monitor-boundary-extension.cjs',
    'sentinel-bot-supervisor-boundary-extension.cjs'
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
    'mobile-gateway-extension.cjs',
    'sentinel-test-update-boundary-extension.cjs'
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

test('Sentinel updater consumes only Sentinel release identities and includes rollback protection', () => {
  const source = read('main/sentinel-update-extension.cjs');
  const policy = read('shared/sentinel-update-policy.cjs');
  assert.match(source, /updateScope: 'sentinel-only'/);
  assert.match(source, /selectSentinelRelease/);
  assert.match(source, /prepareRollbackSnapshot/);
  assert.match(source, /startRollbackWatchdog/);
  assert.match(source, /startupAccepted/);
  assert.match(policy, /-sentinel/);
  assert.match(policy, /sentinelPortableAsset/);
  assert.match(policy, /sentinelSetupAsset/);

  const entry = read('main/entry.cjs');
  assert.ok(
    entry.indexOf('sentinel-update-extension.cjs') < entry.indexOf("require('./main.cjs')"),
    'The Sentinel update boundary must install before main.cjs constructs UpdateService.'
  );
  assert.doesNotMatch(entry, /sentinel-test-update-boundary-extension/);
});

test('Application Monitor user actions are owner-only at the backend boundary', () => {
  const source = read('main/sentinel-owner-monitor-boundary-extension.cjs');
  for (const channel of ['monitor:verify', 'monitor:process-queue', 'monitor:clear-queue', 'monitor:send-current', 'monitor:open-last-issue']) {
    assert.match(source, new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(source, /assertAccess\(refs\.discordAuth\?\.getState\?\.\(\), 'owner'/);
  assert.match(source, /SENTINEL_OWNER_ACCESS_NOT_READY/);
  assert.doesNotMatch(source, /monitor:capture-renderer/);

  const entry = read('main/entry.cjs');
  assert.ok(
    entry.indexOf('sentinel-owner-monitor-boundary-extension.cjs') < entry.indexOf("require('./main.cjs')"),
    'The owner-only monitor boundary must install before main.cjs registers monitor handlers.'
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
  assert.match(source, /sentinel-roadmap\.js/);
  assert.match(source, /sentinel-roadmap\.css/);
  const activeBlock = source.match(/const ACTIVE_MODULES = new Set\(\[[\s\S]*?\]\);/)?.[0] || '';
  assert.doesNotMatch(activeBlock, /palworld-companion/);
  assert.doesNotMatch(activeBlock, /pterodactyl-control/);
});

test('Sentinel renderer hides deferred product surfaces and forces Palworld server creation', () => {
  const source = read('renderer/sentinel-scope.js');
  for (const view of ['dnd', 'ai', 'ai-services', 'nexus-ai', 'scheduler', 'hosted-servers', 'mobile', 'mobile-companion', 'rust', 'satisfactory']) {
    assert.match(source, new RegExp(`'${view.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  }
  assert.match(source, /option\.value !== 'palworld'/);
  assert.match(source, /select\.value = 'palworld'/);
  assert.match(source, /select\.disabled = true/);
  assert.match(source, /Discord \+ Palworld Control Center/);
  assert.match(source, /Start Sentinel/);
  assert.match(source, /RELEVANT_SELECTOR/);
  assert.match(source, /setTimeout\(\(\) => observer\.disconnect\(\), 12000\)/);
});

test('Sentinel operational roadmap replaces migration UI with runtime statuses and test path', () => {
  const source = read('renderer/sentinel-roadmap.js');
  for (const label of ['Operational', 'Migrate in progress', 'Disabled', 'Blocked']) assert.match(source, new RegExp(label));
  assert.match(source, /sentinelTestRoadmap/);
  assert.match(source, /sentinelModuleCenter/);
  assert.match(source, /modules:get/);
  assert.match(source, /modules:update/);
  assert.match(source, /sentinel-owner-only-hidden/);
  assert.match(source, /Application Monitor/);
  assert.match(source, /Check Palworld Servers/);
  assert.doesNotMatch(source, /% migrated/);

  const finalizer = read('renderer/sentinel-roadmap-finalizer.js');
  assert.match(finalizer, /11 phases implemented/);
  assert.match(finalizer, /palworld-companion/);

  const roadmap = read('docs/NEXUS-SENTINEL-TEST-ROADMAP.md');
  for (const phase of ['Phase 0', 'Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Phase 5', 'Phase 6', 'Phase 7', 'Phase 8', 'Phase 9', 'Phase 10']) {
    assert.match(roadmap, new RegExp(phase));
  }
  assert.match(roadmap, /Home test order/);
  assert.match(roadmap, /Operational/);
  assert.match(roadmap, /owner-only/);
});

test('Sentinel persistent navigation guard blocks late monolith navigation rebuilds', () => {
  const guard = read('renderer/sentinel-navigation-guard.js');
  for (const view of ['dnd', 'ai', 'ai-services', 'nexus-ai', 'scheduler', 'hosted-servers', 'mobile', 'mobile-companion', 'rust', 'satisfactory']) {
    assert.match(guard, new RegExp(`'${view.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  }
  for (const attribute of ['data-view', 'data-view-link', 'data-view-proxy', 'data-command-view', 'data-khaos-open']) {
    assert.match(guard, new RegExp(attribute));
  }
  assert.match(guard, /Discord \+ Palworld Control Center/);
  assert.match(guard, /sentinelUiGuard = 'active'/);
  assert.match(guard, /sentinelUiReady/);
  assert.match(guard, /new MutationObserver\(\(mutations\) =>/);
  assert.match(guard, /mutations\.some\(relevantMutation\)/);
  assert.match(guard, /if \(mutations\.some\(relevantMutation\)\) scheduleApply\(\)/);
  assert.match(guard, /Palworld Servers/);

  const extension = read('main/sentinel-scope-extension.cjs');
  assert.match(extension, /sentinel-navigation-guard\.js/);
});

test('packaged Sentinel smoke evidence inspects final renderer, Readiness, and completed operational scope', () => {
  const evidence = read('main/startup-smoke-evidence-extension.cjs');
  assert.match(evidence, /async function captureUiState/);
  assert.match(evidence, /forbiddenVisible/);
  assert.match(evidence, /brandSubtitle === 'Discord \+ Palworld Control Center'/);
  assert.match(evidence, /product === 'sentinel'/);
  assert.match(evidence, /serverOptions\.length === 1 && serverOptions\[0\] === 'palworld'/);
  assert.match(evidence, /dashboardRoadmap/);
  assert.match(evidence, /readinessCenter/);
  assert.match(evidence, /roadmapCompleteBadge/);
  assert.match(evidence, /moduleCenter/);
  assert.match(evidence, /legacyModuleCenterHidden/);
  assert.match(evidence, /validRoadmapLabels/);
  assert.doesNotMatch(evidence.match(/validRoadmapLabels[\s\S]*?const uniqueForbidden/)?.[0] || '', /Migrate in progress/);

  const workflow = read('.github/workflows/sentinel-test-build.yml');
  assert.match(workflow, /\$ui -and \$ui\.ready/);
  assert.match(workflow, /Forbidden monolith views remain visible/);
  assert.match(workflow, /Readiness Center did not render/);
  assert.match(workflow, /Nexus-Sentinel-Complete-Roadmap-RC1/);
});

test('renderer asset loader reports feature readiness only for the real desktop window after bundle injection', () => {
  const source = read('main/renderer-asset-loader.cjs');
  assert.match(source, /function isMainRendererWindow/);
  assert.match(source, /renderer\\\/index\\\.html/);
  assert.match(source, /stage: 'features-ready'/);
  assert.match(source, /source: 'renderer-asset-loader'/);
  assert.match(source, /if \(!onlyId\) reportFeaturesReady\(window, selected, generation\)/);
});
