'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');
const {
  enabledSentinelModules,
  setupHealthy,
  modulesNeedingProvision
} = require('../src/sentinel/module-autoprovision-extension.cjs');

function stateFor({ setups = {}, roles = {} } = {}) {
  return {
    getModuleSetup: (moduleId) => setups[moduleId] || null,
    getAccessRole: (moduleId) => roles[moduleId] ? { roleId: roles[moduleId] } : null
  };
}

test('auto-provision target list includes Sentinel modules but never delegated D&D', () => {
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
  assert.ok(enabled.some((module) => module.id === 'oncehuman'));
  assert.equal(enabled.some((module) => module.id === 'dnd'), false);
  assert.equal(enabled.some((module) => module.id === 'warframe'), false);
});

test('healthy stored module layout is not provisioned again', () => {
  const channels = new Map([
    ['cat', { id: 'cat', type: ChannelType.GuildCategory }],
    ['hub', { id: 'hub', type: ChannelType.GuildText, parentId: 'cat' }]
  ]);
  assert.equal(setupHealthy({ categoryId: 'cat', consoleChannelId: 'hub' }, channels), true);
  assert.equal(setupHealthy({ categoryId: 'cat', consoleChannelId: 'missing' }, channels), false);
});

test('new OSRS RS3 and Once Human layouts wait for access roles before category creation', () => {
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
    roles: { osrs: 'role-osrs', runescape3: 'role-rs3' }
  });
  const roles = new Map([
    ['role-osrs', { id: 'role-osrs' }],
    ['role-rs3', { id: 'role-rs3' }]
  ]);
  const result = modulesNeedingProvision(config, state, new Map(), roles);
  assert.deepEqual(result.pending.sort(), ['osrs', 'runescape3']);
  assert.deepEqual(result.blocked, [{ moduleId: 'oncehuman', reason: 'access-role-not-ready' }]);
});

test('Once Human becomes provisionable as soon as its access role exists', () => {
  const config = {
    modules: Object.fromEntries([
      'ark', 'callofduty', 'deadbydaylight', 'diablo4', 'palworld', 'minecraft', 'warframe', 'division2',
      'rust', 'satisfactory', 'idleon', 'pokemongo', 'dnd', 'osrs', 'runescape3'
    ].map((id) => [id, { enabled: false }]))
  };
  config.modules.oncehuman = { enabled: true };
  const state = stateFor({ roles: { oncehuman: 'role-oncehuman' } });
  const result = modulesNeedingProvision(config, state, new Map(), new Map([['role-oncehuman', { id: 'role-oncehuman' }]]));
  assert.deepEqual(result.pending, ['oncehuman']);
  assert.deepEqual(result.blocked, []);
});
