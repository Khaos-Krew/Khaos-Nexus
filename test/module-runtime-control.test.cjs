'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  catalog,
  getModule,
  mergeModuleStates,
  buildModuleRuntime,
  moduleDecisionForChannel,
  decisionEnabled,
  validateRegistry,
  VIEW_RULES
} = require('../shared/module-registry.cjs');
const { createCommands } = require('../bot/commands.cjs');
const { blockedModuleForInteraction, roleMenuModule } = require('../bot/module-runtime.cjs');
const { isExpectedAccessDenial } = require('../shared/renderer-action-errors.cjs');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function completeState(enabled = true) {
  return { enabled, completedSteps: ['inventory', 'data', 'services', 'interface', 'access', 'validation'], notes: '', updatedAt: '2026-07-29T20:00:00.000Z' };
}

test('authoritative registry identifies implemented, partial and planned modules', () => {
  assert.equal(validateRegistry(), true);
  assert.equal(getModule('server-scheduler').availability, 'implemented');
  assert.equal(getModule('players-console').stage, 'live');
  assert.equal(getModule('pterodactyl-control').launchView, 'hosted-servers');
  assert.equal(getModule('discord-observability').availability, 'implemented');
  assert.equal(getModule('mobile-gateway').availability, 'partial');
  assert.equal(getModule('communities-directory').availability, 'planned');
  assert.ok(catalog().length > 30);
});

test('implemented Pterodactyl inventory describes only current desktop capabilities', () => {
  const module = getModule('pterodactyl-control');
  assert.ok(module.features.includes('Live resource snapshots'));
  assert.ok(module.features.includes('Start, stop, restart and kill'));
  assert.equal(module.features.some((feature) => /console|file editor|database|subuser/i.test(feature)), false);
});

test('owner override remains authoritative when a migration extension tries to re-enable a module', () => {
  const source = { 'server-scheduler': completeState(true) };
  const states = mergeModuleStates(source, {}, { 'server-scheduler': { enabled: false, updatedAt: '2026-07-29T20:05:00.000Z' } });
  assert.equal(states['server-scheduler'].enabled, false);
  assert.equal(buildModuleRuntime(states)['server-scheduler'].reason, 'disabled-by-owner');
});

test('disabled dependencies block dependent modules without erasing their requested state', () => {
  const states = mergeModuleStates({
    'discord-runtime': completeState(false),
    'server-status-panels': completeState(true),
    'game-server-control': completeState(true)
  });
  const runtime = buildModuleRuntime(states);
  assert.equal(runtime['server-status-panels'].requestedEnabled, true);
  assert.equal(runtime['server-status-panels'].effectiveEnabled, false);
  assert.equal(runtime['server-status-panels'].reason, 'dependency-disabled');
  assert.ok(runtime['server-status-panels'].blockedBy.includes('discord-runtime'));
});

test('local recovery remains available when Discord Runtime is disabled', () => {
  const states = mergeModuleStates({
    'discord-runtime': completeState(false),
    'game-server-control': completeState(true),
    'operator-console': completeState(true)
  });
  const runtime = buildModuleRuntime(states);
  assert.equal(runtime['operator-console'].effectiveEnabled, true);
  assert.deepEqual(getModule('operator-console').dependencies, ['game-server-control']);
});

test('planned modules cannot become effectively runnable from a saved true flag', () => {
  const states = mergeModuleStates({ 'communities-directory': completeState(true) });
  const runtime = buildModuleRuntime(states)['communities-directory'];
  assert.equal(runtime.requestedEnabled, true);
  assert.equal(runtime.effectiveEnabled, false);
  assert.equal(runtime.reason, 'not-implemented');
});

test('desktop views and IPC channels resolve to the correct module gates without locking out owner sign-in', () => {
  const states = mergeModuleStates({
    'discord-runtime': completeState(true),
    'game-server-control': completeState(true),
    'palworld-operations': completeState(false),
    'server-scheduler': completeState(false),
    'embed-studio': completeState(true),
    'server-status-panels': completeState(false)
  });
  const runtime = buildModuleRuntime(states);
  assert.equal(decisionEnabled(runtime, VIEW_RULES.scheduler), false);
  assert.equal(decisionEnabled(runtime, VIEW_RULES['discord-studio']), true);
  assert.equal(VIEW_RULES.setup, undefined);
  assert.deepEqual(moduleDecisionForChannel('server:palworld-action'), { allOf: ['palworld-operations'] });
  assert.deepEqual(moduleDecisionForChannel('server-scheduler:run-now'), { allOf: ['server-scheduler'] });
  assert.deepEqual(moduleDecisionForChannel('discord-studio:save-template'), { allOf: ['embed-studio'] });
  assert.deepEqual(moduleDecisionForChannel('discord-studio:publish-panel'), { allOf: ['server-status-panels'] });
  assert.equal(moduleDecisionForChannel('discord-auth:login'), null);
  assert.equal(moduleDecisionForChannel('discord-auth:refresh'), null);
});

test('color role menu IPC accepts both color and colors kind labels', () => {
  assert.deepEqual(moduleDecisionForChannel('discord-automation:save-menu', [{ kind: 'color' }]), { allOf: ['color-roles'] });
  assert.deepEqual(moduleDecisionForChannel('discord-automation:save-menu', [{ kind: 'colors' }]), { allOf: ['color-roles'] });
});

test('module-aware Discord command registration removes disabled game operations', () => {
  const commands = createCommands({ isModuleEnabled: (id) => !['palworld-operations', 'game-server-control'].includes(id) });
  const names = commands.map((command) => command.name);
  assert.ok(names.includes('ping'));
  assert.ok(names.includes('health'));
  assert.equal(names.includes('status'), false);
  assert.equal(names.includes('players'), false);
  assert.equal(names.includes('settings'), false);
  assert.equal(names.includes('shutdown'), false);
});

test('Discord button guard blocks status panels and the correct role-menu module', () => {
  const statusInteraction = { customId: 'kn-status:refresh:panel-1', isButton: () => true };
  const bootstrap = { config: { moduleRuntime: { 'server-status-panels': { effectiveEnabled: false } } };
  assert.equal(blockedModuleForInteraction(bootstrap, statusInteraction), 'Server Status Panels');

  const roleBootstrap = {
    config: {
      moduleRuntime: { 'color-roles': { effectiveEnabled: false }, 'role-menus': { effectiveEnabled: true } },
      discordAutomation: { roleMenus: [{ id: 'colors', name: 'Colors', kind: 'colors', enabled: true, options: [] }] }
    }
  };
  const colorButton = { customId: 'kn-role:colors:red', isButton: () => true };
  assert.equal(roleMenuModule(roleBootstrap, colorButton.customId), 'color-roles');
  assert.equal(blockedModuleForInteraction(roleBootstrap, colorButton), 'Color Roles');
});

test('owner-disabled module messages are expected outcomes instead of error reports', () => {
  assert.equal(isExpectedAccessDenial(Object.assign(new Error('Server Scheduler is disabled by the owner.'), { code: 'MODULE_DISABLED' })), true);
  assert.equal(isExpectedAccessDenial(new Error('This action requires an enabled Nexus module: Server Scheduler.')), true);
});

test('Sentinel production entry installs module control before Discord and Palworld services and preserves the bot entry chain', () => {
  const entry = read('main/entry.cjs');
  const foundation = read('main/module-foundation-extension.cjs');
  const runtime = read('main/module-runtime-extension.cjs');
  const wrapper = read('bot/audit-wrapper.cjs');
  const botEntry = read('bot/entry.cjs');
  const bot = read('bot/index.cjs');
  const renderer = read('renderer/module-runtime.js');

  const foundationIndex = entry.indexOf('module-foundation-extension.cjs');
  const runtimeIndex = entry.indexOf('module-runtime-extension.cjs');
  const palworldIndex = entry.indexOf('palworld-main-extension.cjs');
  const studioIndex = entry.indexOf('discord-studio-extension.cjs');
  const scopeIndex = entry.indexOf('sentinel-scope-extension.cjs');
  assert.ok(foundationIndex >= 0 && runtimeIndex > foundationIndex);
  assert.ok(palworldIndex > runtimeIndex);
  assert.ok(studioIndex > runtimeIndex);
  assert.ok(scopeIndex > palworldIndex && scopeIndex > studioIndex);
  assert.doesNotMatch(entry, /server-scheduler-extension\.cjs/);
  assert.doesNotMatch(entry, /hosted-server-extension\.cjs/);
  assert.doesNotMatch(entry, /dnd-/);
  assert.doesNotMatch(entry, /bundled-ai-runtimes-extension\.cjs/);
  assert.match(foundation, /moduleOverrides/);
  assert.match(foundation, /modules:bulk-update/);
  assert.match(runtime, /moduleDecisionForChannel/);
  assert.match(runtime, /ipcMain\.handle = function moduleAwareHandle/);
  assert.match(wrapper, /require\('\.\/entry\.cjs'\)/);
  assert.match(botEntry, /installModuleRuntime/);
  assert.match(botEntry, /installDiscordAutomationRuntime/);
  assert.match(botEntry, /installStatusPanelRuntime/);
  assert.doesNotMatch(botEntry, /dnd/i);
  assert.match(bot, /message\?\.type === 'config-update'/);
  assert.match(bot, /scheduleCommandRegistration/);
  assert.match(renderer, /nexus-module-disabled-target/);
  assert.match(renderer, /khaos:module-runtime-applied/);
  assert.match(renderer, /state\.botStatus/);
  assert.match(renderer, /Not Implemented/);
});