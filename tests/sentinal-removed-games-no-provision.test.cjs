'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ChannelType, Collection } = require('discord.js');

const { MODULES } = require('../src/backend/modules/catalog.cjs');
const { ROADMAP_GAME_MODULES } = require('../src/sentinel/roadmap-game-module-registry.cjs');
const {
  NO_PROVISION_CHANNEL_MODULES,
  NO_PROVISION_CHANNEL_MODULE_IDS,
  MODULE_CHANNELS_NOT_PROVISIONED,
  isNoProvisionChannelModule,
  isModuleChannelsNotProvisionedError
} = require('../src/sentinel/no-provision-modules.cjs');
const { AUTO_PROVISION_MODULES } = require('../src/sentinel/role-menu-extension.cjs');
const { ModuleProvisioner } = require('../src/sentinel/module-provisioner.cjs');
const { SentinalAdminOps } = require('../src/sentinel/admin-ops.cjs');
const { modulesNeedingProvision, bootstrapCategoryAccess } = require('../src/sentinel/module-autoprovision-extension.cjs');
const { enabledAccessDefinitions } = require('../src/sentinel/role-menu.cjs');

const REMOVED_GAME_KEYS = [
  '7daystodie', 'conanexiles', 'oncehuman', 'idleon', 'osrs', 'runescape3',
  'rust', 'satisfactory', 'dnd', 'callofduty', 'deadbydaylight'
];
const CATALOG_IDS = new Set(MODULES.map((module) => module.id));
const LISTED_CATALOG_IDS = REMOVED_GAME_KEYS.filter((id) => CATALOG_IDS.has(id));

function fakeGuild(existing = []) {
  const channels = new Collection(existing.map((channel) => [channel.id, channel]));
  const creates = [];
  let next = 1;
  const guild = {
    id: 'guild-1',
    creates,
    channels: {
      cache: channels,
      async fetch(id) {
        if (id === undefined) return channels;
        return channels.get(String(id)) || null;
      },
      async create(options) {
        creates.push(options);
        const channel = { id: `created-${next++}`, name: options.name, type: options.type, parentId: options.parent || null,
          permissionOverwrites: { cache: new Collection(), edit: async () => {} } };
        channels.set(channel.id, channel);
        return channel;
      }
    },
    roles: { cache: new Collection(), async fetch() { return new Collection(); } }
  };
  return guild;
}

function fakeState() {
  const setups = {};
  return {
    setups,
    setModuleSetup: (id, setup) => { setups[id] = setup; },
    getModuleSetup: (id) => setups[id] || null,
    listModuleSetups: () => ({ ...setups }),
    getAdminSettings: () => ({}),
    getAccessRole: () => ({ roleId: 'role-1' })
  };
}

test('AUTO_PROVISION_MODULES only auto-provisions Diablo IV (CoD/DbD removed)', () => {
  assert.deepEqual([...AUTO_PROVISION_MODULES], ['diablo4']);
  assert.ok(Object.isFrozen(AUTO_PROVISION_MODULES));
  for (const id of AUTO_PROVISION_MODULES) assert.equal(isNoProvisionChannelModule(id), false);
});

test('no-provision list maps every removed game to a real module key', () => {
  assert.deepEqual([...NO_PROVISION_CHANNEL_MODULE_IDS].sort(), [...REMOVED_GAME_KEYS].sort());
  const roadmapIds = new Set(ROADMAP_GAME_MODULES.map((module) => module.id));
  for (const id of REMOVED_GAME_KEYS) {
    assert.ok(CATALOG_IDS.has(id) || roadmapIds.has(id), `${id} must exist in the catalog or roadmap registry`);
    assert.ok(NO_PROVISION_CHANNEL_MODULES[id]);
  }
  // Untouched games stay provisionable.
  for (const id of ['ark', 'warframe', 'diablo4', 'minecraft', 'division2', 'pokemongo', 'palworld']) {
    assert.equal(isNoProvisionChannelModule(id), false, id);
  }
  assert.equal(isNoProvisionChannelModule(' RUST '), true);
});

test('ModuleProvisioner.provision and category refuse listed modules without touching Discord, even with a selected category or enabled config', async () => {
  for (const id of LISTED_CATALOG_IDS) {
    const guild = fakeGuild([{ id: 'cat-x', name: 'Whatever', type: ChannelType.GuildCategory }]);
    const provisioner = new ModuleProvisioner({ state: fakeState(), config: { modules: { [id]: { enabled: true } } } });
    await assert.rejects(provisioner.provision(guild, id), (error) => error.code === MODULE_CHANNELS_NOT_PROVISIONED && error.moduleId === id);
    await assert.rejects(provisioner.provision(guild, id, 'cat-x'), (error) => isModuleChannelsNotProvisionedError(error));
    await assert.rejects(provisioner.category(guild, id), (error) => isModuleChannelsNotProvisionedError(error));
    assert.equal(guild.creates.length, 0, `${id} created channels`);
  }
});

test('ModuleProvisioner.category still creates categories for non-listed modules (control)', async () => {
  const guild = fakeGuild();
  const provisioner = new ModuleProvisioner({ state: fakeState(), config: {} });
  const result = await provisioner.category(guild, 'diablo4');
  assert.equal(result.created, true);
  assert.equal(guild.creates.length, 1);
  assert.equal(guild.creates[0].type, ChannelType.GuildCategory);
});

test('bot /nexus repair, repair-all and setup paths (all funnel through provisioner.provision) create nothing for listed modules', async () => {
  // bot.cjs repairModuleIds() iterates enabledModuleIds() (/nexus repair) or every MODULES id
  // (/nexus repair-all, which ignores enabled flags) and calls provisioner.provision();
  // the setup select calls provisionModule() -> provisioner.provision().
  const guild = fakeGuild();
  const provisioner = new ModuleProvisioner({ state: fakeState(), config: {} });
  for (const id of LISTED_CATALOG_IDS) {
    await assert.rejects(provisioner.provision(guild, id), (error) => isModuleChannelsNotProvisionedError(error));
  }
  assert.equal(guild.creates.length, 0);

  const source = fs.readFileSync(path.join(__dirname, '../src/sentinel/bot.cjs'), 'utf8');
  assert.match(source, /async function repairModuleIds[\s\S]*?provisioner\.provision\(interaction\.guild, moduleId\)[\s\S]*?isModuleChannelsNotProvisionedError\(error\)/);
  assert.match(source, /async function provisionModule[\s\S]*?provisioner\.provision\(interaction\.guild, moduleId\)/);
  assert.match(source, /repairAllModules[\s\S]*?MODULES\.map\(\(module\) => module\.id\)/);
});

function adminOpsFor(guild, config) {
  const provisioner = new ModuleProvisioner({ state: fakeState(), config });
  const provisionCalls = [];
  const original = provisioner.provision.bind(provisioner);
  provisioner.provision = async (g, id, categoryId) => { provisionCalls.push(id); return original(g, id, categoryId); };
  const ops = new SentinalAdminOps({ guild, config, state: fakeState(), provisioner, ensureConsole: async () => null });
  return { ops, provisionCalls };
}

test('admin HTTP /v1/repair and /v1/channels/reconcile (reconcileChannels) skip listed modules even when enabled', async () => {
  const modules = {};
  for (const module of MODULES) modules[module.id] = { enabled: LISTED_CATALOG_IDS.includes(module.id) };
  const guild = fakeGuild();
  const { ops, provisionCalls } = adminOpsFor(guild, { modules });

  const all = await ops.reconcileChannels();
  assert.equal(all.ok, true);
  assert.deepEqual(all.modules.map((item) => item.moduleId).sort(), [...LISTED_CATALOG_IDS].sort());
  assert.ok(all.modules.every((item) => item.skipped === true && item.reason === 'channels-not-provisioned'));
  assert.deepEqual(provisionCalls, []);
  assert.equal(guild.creates.length, 0);

  for (const id of LISTED_CATALOG_IDS) {
    const single = await ops.reconcileChannels(id);
    assert.equal(single.ok, true);
    assert.equal(single.modules[0].skipped, true);
  }
  assert.equal(guild.creates.length, 0);

  const inspected = await ops.inspectChannels();
  assert.ok(inspected.modules.every((item) => item.skipped === true));
  const consoles = await ops.refreshConsoles();
  assert.deepEqual(consoles.modules, []);
});

test('module auto-provision extension never queues listed modules and its category bootstrap refuses them', async () => {
  const modules = {};
  for (const module of MODULES) modules[module.id] = { enabled: true };
  const roles = new Map([['role-1', { id: 'role-1' }]]);
  const state = { getModuleSetup: () => null, getAccessRole: () => ({ roleId: 'role-1' }) };
  const { pending, blocked } = modulesNeedingProvision({ modules }, state, new Map(), roles);
  for (const id of REMOVED_GAME_KEYS) {
    assert.equal(pending.includes(id), false, `${id} pending`);
    assert.equal(blocked.some((item) => item.moduleId === id), false, `${id} blocked`);
  }
  assert.ok(pending.includes('warframe'));

  const guild = fakeGuild();
  const provisioner = new ModuleProvisioner({ state: fakeState(), config: { modules } });
  for (const id of LISTED_CATALOG_IDS) {
    await assert.rejects(bootstrapCategoryAccess(guild, provisioner, id, 'role-1'), (error) => isModuleChannelsNotProvisionedError(error));
  }
  assert.equal(guild.creates.length, 0);
});

test('game access roles and the module access menu still include the removed games', () => {
  const ids = new Set(enabledAccessDefinitions({}).map((definition) => definition.moduleId));
  for (const id of LISTED_CATALOG_IDS) assert.ok(ids.has(id), `${id} missing from access menu`);

  const exampleConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../config.example.json'), 'utf8'));
  const fromExample = new Set(enabledAccessDefinitions(exampleConfig).map((definition) => definition.moduleId));
  for (const id of LISTED_CATALOG_IDS) assert.ok(fromExample.has(id), `${id} missing with config.example.json`);
  for (const id of LISTED_CATALOG_IDS) assert.notEqual(exampleConfig.modules?.[id]?.enabled, false, `${id} must not be disabled`);
});
