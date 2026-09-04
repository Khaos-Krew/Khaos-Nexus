'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const {
  enabledSentinelModules,
  categoryMatchesModule,
  setupHealthy,
  modulesNeedingProvision,
  bootstrapCategoryAccess,
  createAutoprovisionRunQueue
} = require('../src/sentinel/module-autoprovision-extension.cjs');

function stateFor({ setups = {}, roles = {} } = {}) {
  return {
    getModuleSetup: (moduleId) => setups[moduleId] || null,
    getAccessRole: (moduleId) => roles[moduleId] ? { roleId: roles[moduleId] } : null
  };
}

test('auto-provision target list includes active Sentinel modules but excludes retired Once Human and delegated D&D', () => {
  const enabled = enabledSentinelModules({
    modules: {
      osrs: { enabled: true },
      runescape3: { enabled: true },
      oncehuman: { enabled: true },
      dnd: { enabled: true },
      warframe: { enabled: false }
    }
  });
  assert.ok(enabled.some((module) => module.id === 'osrs'));
  assert.ok(enabled.some((module) => module.id === 'runescape3'));
  assert.equal(enabled.some((module) => module.id === 'oncehuman'), false);
  assert.equal(enabled.some((module) => module.id === 'dnd'), false);
  assert.equal(enabled.some((module) => module.id === 'warframe'), false);
});

test('healthy stored module layout is not provisioned again', () => {
  const channels = new Map([
    ['cat', { id: 'cat', name: 'Warframe', type: ChannelType.GuildCategory }],
    ['hub', { id: 'hub', type: ChannelType.GuildText, parentId: 'cat' }]
  ]);
  assert.equal(setupHealthy({ categoryId: 'cat', consoleChannelId: 'hub' }, channels, 'warframe'), true);
  assert.equal(setupHealthy({ categoryId: 'cat', consoleChannelId: 'missing' }, channels, 'warframe'), false);
});

test('a stored RS3 setup under OSRS is unhealthy and must be repaired', () => {
  const channels = new Map([
    ['cat', { id: 'cat', name: 'Old School RuneScape', type: ChannelType.GuildCategory }],
    ['hub', { id: 'hub', name: 'rs3-hub', type: ChannelType.GuildText, parentId: 'cat' }]
  ]);
  const setup = { categoryId: 'cat', consoleChannelId: 'hub' };
  assert.equal(categoryMatchesModule('osrs', channels.get('cat')), true);
  assert.equal(categoryMatchesModule('runescape3', channels.get('cat')), false);
  assert.equal(setupHealthy(setup, channels, 'runescape3'), false);
});

test('retired Once Human never becomes pending or blocked even when configuration and access role still exist', () => {
  const config = {
    modules: {
      osrs: { enabled: true },
      runescape3: { enabled: true },
      oncehuman: { enabled: true },
      ark: { enabled: false },
      callofduty: { enabled: false },
      deadbydaylight: { enabled: false },
      diablo4: { enabled: false },
      palworld: { enabled: false },
      minecraft: { enabled: false },
      warframe: { enabled: false },
      division2: { enabled: false },
      rust: { enabled: false },
      satisfactory: { enabled: false },
      idleon: { enabled: false },
      pokemongo: { enabled: false },
      dnd: { enabled: true }
    }
  };
  const state = stateFor({
    roles: { osrs: 'role-osrs', runescape3: 'role-rs3', oncehuman: 'role-oncehuman' }
  });
  const roles = new Map([
    ['role-osrs', { id: 'role-osrs' }],
    ['role-rs3', { id: 'role-rs3' }],
    ['role-oncehuman', { id: 'role-oncehuman' }]
  ]);
  const result = modulesNeedingProvision(config, state, new Map(), roles);
  assert.deepEqual(result.pending.sort(), ['osrs', 'runescape3']);
  assert.equal(result.pending.includes('oncehuman'), false);
  assert.equal(result.blocked.some((item) => item.moduleId === 'oncehuman'), false);
});

test('category bootstrap denies everyone before granting the module access role', async () => {
  const edits = [];
  const category = {
    id: 'category-warframe',
    permissionOverwrites: {
      edit: async (targetId, permissions) => edits.push({ targetId, permissions })
    }
  };
  const provisioner = { category: async () => ({ category, created: true, source: 'created', matchScore: 0 }) };
  const guild = { id: 'guild-1' };
  const result = await bootstrapCategoryAccess(guild, provisioner, 'warframe', 'role-warframe');
  assert.equal(result.category, category);
  assert.deepEqual(edits, [
    { targetId: 'guild-1', permissions: { ViewChannel: false } },
    { targetId: 'role-warframe', permissions: { ViewChannel: true } }
  ]);
  assert.equal(PermissionFlagsBits.ViewChannel > 0n, true);
});

test('slow topology reconciliation coalesces follow-up requests instead of overlapping them', async () => {
  const calls = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  let first = true;
  const queue = createAutoprovisionRunQueue(async (reason) => {
    calls.push(`start:${reason}`);
    if (first) {
      first = false;
      await firstGate;
    }
    calls.push(`end:${reason}`);
  }, { logger: { log() {}, warn() {} }, now: () => 1 });

  const startup = queue.request('startup');
  await Promise.resolve();
  const periodic = queue.request('periodic');
  const roleChange = queue.request('role-change');
  assert.equal(queue.isRunning(), true);
  assert.deepEqual(queue.pending(), ['periodic', 'role-change']);
  assert.equal(periodic, startup);
  assert.equal(roleChange, startup);

  releaseFirst();
  await startup;
  assert.deepEqual(calls, [
    'start:startup',
    'end:startup',
    'start:queued:periodic+role-change',
    'end:queued:periodic+role-change'
  ]);
  assert.equal(queue.isRunning(), false);
  assert.deepEqual(queue.pending(), []);
});
