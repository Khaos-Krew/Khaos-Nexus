'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ChannelType } = require('discord.js');
const { loadConfig } = require('../src/shared/config.cjs');
const { layoutFor } = require('../src/sentinel/module-layouts.cjs');
const { ModuleProvisioner } = require('../src/sentinel/module-provisioner.cjs');
const { inspectModuleLayout } = require('../src/sentinel/module-inspector.cjs');
const {
  APPROVED_GAME_CATEGORY_ORDER,
  SLIM_GAME_MODULE_IDS,
  collapseDryRun,
  collapseRemovalNames,
  managedTextChannels,
  playerFacingTextChannels
} = require('../src/sentinel/layout-profile.cjs');
const {
  reconcileServerCategoryOrder,
  serverCategoryOrderPlan,
  structuralCategories,
  voicePinUpdates
} = require('../src/sentinel/category-order.cjs');
const {
  HQ_CHANNELS,
  ensureChannel,
  findHqCategory,
  findInformationCategory,
  shouldRenameHqCategory
} = require('../src/sentinel/nexus-hq.cjs');
const { adminCommandInventory } = require('../src/sentinel/staff-workspace.cjs');

const GUILD = '1016059608789434408';
const VOICE_ID = '1569266940508110928';

function overwrite() {
  return {
    allow: { has: () => false },
    deny: { has: () => false }
  };
}

function channel(fields) {
  return {
    setParent: async () => { throw new Error(`must not move ${fields.name}`); },
    setName: async () => { throw new Error(`must not rename ${fields.name}`); },
    permissionOverwrites: { cache: new Map([[GUILD, overwrite()]]) },
    ...fields
  };
}

function memoryState() {
  const setups = {};
  const lobbies = {};
  return {
    setups,
    lobbies,
    listModuleSetups: () => setups,
    setModuleSetup: (id, value) => { setups[id] = value; },
    getModuleSetup: (id) => setups[id] || null,
    getAccessRole: () => null,
    listAccessRoles: () => ({}),
    getAdminSettings: () => ({}),
    findTempLobbyByOwner: () => null,
    getTempLobby: (id) => lobbies[id] || null,
    setTempLobby: (id, value) => { lobbies[id] = value; },
    removeTempLobby: (id) => { delete lobbies[id]; },
    listTempLobbies: () => lobbies
  };
}

function guildFor(list) {
  const map = new Map(list.map((item) => [String(item.id), item]));
  map.find = (predicate) => [...map.values()].find(predicate);
  const created = [];
  return {
    created,
    guild: {
      id: GUILD,
      channels: {
        fetch: async (id) => {
          if (id === undefined) return map;
          return map.get(String(id)) || null;
        },
        create: async (options) => {
          const made = channel({
            id: `created-${created.length + 1}`,
            name: options.name,
            type: options.type,
            parentId: options.parent
          });
          created.push(made);
          map.set(made.id, made);
          return made;
        }
      },
      roles: { fetch: async () => new Map() }
    }
  };
}

function category(id, name, position) {
  return { id, name, type: ChannelType.GuildCategory, rawPosition: position, position };
}

test('slim layout defaults to hub + lfg and leaves Division, Pokémon GO, and Palworld whole', () => {
  assert.deepEqual([...SLIM_GAME_MODULE_IDS], ['callofduty', 'deadbydaylight', 'diablo4', 'destiny2', 'warframe']);
  assert.equal(APPROVED_GAME_CATEGORY_ORDER[0], 'minecraft');
  assert.equal(APPROVED_GAME_CATEGORY_ORDER.at(-1), 'warframe');
  for (const moduleId of SLIM_GAME_MODULE_IDS) {
    const full = layoutFor(moduleId === 'destiny2' ? 'warframe' : moduleId);
    const facing = playerFacingTextChannels(moduleId, {});
    assert.equal(facing.length, 2, moduleId);
    assert.match(facing[0], /hub$/);
    assert.match(facing[1], /lfg$/);
    if (moduleId !== 'destiny2') assert.ok(full.text.length > facing.length);
  }
  for (const moduleId of ['division2', 'pokemongo', 'palworld', 'minecraft', 'ark']) {
    assert.deepEqual(playerFacingTextChannels(moduleId, {}), layoutFor(moduleId).text);
    assert.deepEqual(collapseRemovalNames(moduleId, {}), []);
  }
  assert.deepEqual(collapseRemovalNames('diablo4', { discord: { slimGameLayout: false } }), []);
  assert.ok(collapseRemovalNames('diablo4', {}).includes('diablo-farming'));
  assert.ok(collapseRemovalNames('callofduty', {}).includes('cod-loadouts'));
  assert.ok(collapseRemovalNames('warframe', {}).includes('warframe-builds'));
  assert.ok(managedTextChannels('diablo4', {}, { respectManual: true }).includes('diablo-lfg'));
  assert.deepEqual(managedTextChannels('minecraft', {}, { respectManual: true }), ['minecraft-console']);
});

test('collapse dry-run lists layout names and never deletes', () => {
  const report = collapseDryRun([
    { id: '1', name: 'diablo-farming', type: ChannelType.GuildText, parentId: 'game' },
    { id: '2', name: 'diablo-farming', type: ChannelType.GuildVoice, parentId: 'voice' },
    { id: '3', name: 'division-builds', type: ChannelType.GuildText, parentId: 'division' },
    { id: '4', name: 'Diablo IV', type: ChannelType.GuildCategory }
  ], {});
  assert.equal(report.dryRun, true);
  assert.equal(report.deletesPerformed, false);
  assert.equal(report.rolesChanged, false);
  const diablo = report.modules.find((item) => item.moduleId === 'diablo4');
  assert.deepEqual(diablo.present.map((item) => item.id), ['1']);
  assert.ok(diablo.keep.includes('diablo-hub'));
  assert.ok(diablo.keep.includes('diablo-lfg'));
  assert.equal(report.modules.some((item) => item.moduleId === 'division2'), false);
  assert.equal(report.modules.some((item) => item.remove.includes('division-builds')), false);
  const empty = collapseDryRun([], { discord: { slimGameLayout: false } });
  assert.equal(empty.modules.every((item) => item.remove.length === 0), true);
});

test('dry-run script prints candidates and refuses a delete mode', () => {
  const script = path.join(__dirname, '../scripts/discord-layout-collapse-dry-run.cjs');
  const listed = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(listed.status, 0);
  assert.match(listed.stdout, /#cod-loadouts/);
  assert.match(listed.stdout, /#diablo-farming/);
  assert.match(listed.stdout, /#destiny-builds/);
  assert.match(listed.stdout, /#warframe-market/);
  assert.match(listed.stdout, /Deletes performed: 0/);
  assert.doesNotMatch(listed.stdout, /division-builds/);

  const refused = spawnSync(process.execPath, [script, '--delete'], { encoding: 'utf8' });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /dry-run only/);

  const file = path.join(os.tmpdir(), `nexus-layout-inventory-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify([
    { id: '99', name: 'dbd-builds', type: ChannelType.GuildText, parent_id: 'dbd' }
  ]));
  const inventoried = spawnSync(process.execPath, [script, '--inventory', file], { encoding: 'utf8' });
  assert.equal(inventoried.status, 0);
  assert.match(inventoried.stdout, /#dbd-builds `99`/);
  assert.match(inventoried.stdout, /Present matches: 1/);
  fs.unlinkSync(file);

  const commands = adminCommandInventory().map((item) => item.command);
  assert.ok(commands.includes('/nexus collapse-dry-run'));
});

test('Diablo auto-provision keeps the builder in Voice and does not recreate farming rooms', async () => {
  const layout = layoutFor('diablo4');
  const game = channel({ id: 'game', name: 'Diablo IV 🔥', type: ChannelType.GuildCategory });
  const voice = channel({ id: VOICE_ID, name: '🔊 VOICE', type: ChannelType.GuildCategory });
  const staff = channel({ id: 'staff', name: '🔒 STAFF', type: ChannelType.GuildCategory });
  const builder = channel({ id: 'jtc', name: layout.lobbyBuilder, type: ChannelType.GuildVoice, parentId: VOICE_ID });
  const hub = channel({ id: 'hub', name: 'diablo-hub', type: ChannelType.GuildText, parentId: 'game' });
  const lfg = channel({ id: 'lfg', name: 'diablo-lfg', type: ChannelType.GuildText, parentId: 'game' });
  const farming = channel({ id: 'farm', name: 'diablo-farming', type: ChannelType.GuildText, parentId: 'game' });
  const { guild, created } = guildFor([game, voice, staff, builder, hub, lfg, farming]);
  const setup = await new ModuleProvisioner({
    state: memoryState(),
    config: {
      discord: {
        respectManualLayout: true,
        respectManualLayoutGuildIds: [GUILD],
        playerVoiceCategoryId: VOICE_ID
      }
    }
  }).provision(guild, 'diablo4');
  assert.deepEqual(created.map((item) => item.name), []);
  assert.equal(setup.movedChannels.length, 0);
  assert.equal(setup.lobbyBuilderChannelId, 'jtc');
  assert.equal(setup.textChannels.some((item) => item.name === 'diablo-farming'), false);
  assert.equal(setup.textChannels.some((item) => item.name === 'diablo-hub'), true);
  assert.equal(setup.textChannels.some((item) => item.name === 'diablo-lfg'), true);
});

test('a missing builder is created in Voice and an in-game builder is not moved there', async () => {
  const layout = layoutFor('diablo4');
  const game = channel({ id: 'game', name: 'Diablo IV 🔥', type: ChannelType.GuildCategory });
  const voice = channel({ id: VOICE_ID, name: '🔊 VOICE', type: ChannelType.GuildCategory });
  const existing = channel({ id: 'jtc', name: layout.lobbyBuilder, type: ChannelType.GuildVoice, parentId: 'game' });
  const kept = guildFor([game, voice, existing]);
  const keptSetup = await new ModuleProvisioner({
    state: memoryState(),
    config: { discord: { slimGameLayout: true, playerVoiceCategoryId: VOICE_ID, respectManualLayout: false } }
  }).provision(kept.guild, 'diablo4');
  assert.equal(kept.created.some((item) => item.name === layout.lobbyBuilder), false);
  assert.equal(keptSetup.lobbyBuilderChannelId, 'jtc');
  assert.equal(keptSetup.movedChannels.includes(layout.lobbyBuilder), false);
  assert.equal(kept.created.some((item) => item.name === 'diablo-builds'), false);
  assert.equal(kept.created.some((item) => item.name === 'diablo-lfg'), true);

  const fresh = guildFor([game, voice]);
  const createdSetup = await new ModuleProvisioner({
    state: memoryState(),
    config: { discord: { slimGameLayout: true, playerVoiceCategoryId: VOICE_ID } }
  }).provision(fresh.guild, 'diablo4');
  const made = fresh.created.find((item) => item.name === layout.lobbyBuilder);
  assert.equal(made.parentId, VOICE_ID);
  assert.notEqual(made.parentId, 'game');
  assert.equal(createdSetup.lobbyBuilderChannelId, made.id);

  const staffAsVoice = guildFor([
    game,
    channel({ id: VOICE_ID, name: '🔒 STAFF', type: ChannelType.GuildCategory }),
    channel({ id: 'staff-voice', name: 'Staff Voice', type: ChannelType.GuildVoice, parentId: VOICE_ID })
  ]);
  const blocked = await new ModuleProvisioner({
    state: memoryState(),
    config: { discord: { playerVoiceCategoryId: VOICE_ID, respectManualLayout: true, respectManualLayoutGuildIds: [GUILD] } }
  }).provision(staffAsVoice.guild, 'diablo4');
  assert.equal(staffAsVoice.created.some((item) => item.type === ChannelType.GuildVoice), false);
  assert.equal(blocked.lobbyBuilderChannelId, '');
});

test('repair leaves console and backup channels in Staff', async () => {
  const cases = [
    ['minecraft', ['minecraft-console', 'minecraft-backups']],
    ['ark', ['ark-console']],
    ['palworld', ['palworld-console', 'palworld-backups']]
  ];
  for (const [moduleId, names] of cases) {
    const game = channel({ id: `${moduleId}-game`, name: layoutFor(moduleId).categoryDisplay, type: ChannelType.GuildCategory });
    const staff = channel({ id: 'staff', name: '🔒 STAFF', type: ChannelType.GuildCategory });
    const managed = names.map((name, index) => channel({
      id: `${moduleId}-${index}`,
      name,
      type: ChannelType.GuildText,
      parentId: 'staff'
    }));
    const { guild, created } = guildFor([game, staff, ...managed]);
    const setup = await new ModuleProvisioner({
      state: memoryState(),
      config: { discord: { respectManualLayout: false, slimGameLayout: true } }
    }).provision(guild, moduleId);
    for (const name of names) {
      assert.equal(created.some((item) => item.name === name), false, name);
      assert.equal(setup.movedChannels.includes(name), false, name);
      assert.equal(setup.textChannels.find((item) => item.name === name).relocated, true, name);
    }
  }
});

test('temporary rooms follow the builder parent instead of the game category', async () => {
  const state = memoryState();
  const provisioner = new ModuleProvisioner({
    state,
    config: { discord: { playerVoiceCategoryId: VOICE_ID } }
  });
  const created = [];
  const guild = {
    id: GUILD,
    channels: {
      create: async (options) => {
        const made = { id: 'temp-1', ...options, type: ChannelType.GuildVoice, parentId: options.parent };
        created.push(made);
        return made;
      },
      fetch: async (id) => (id === 'jtc' ? { id: 'jtc', parentId: VOICE_ID, type: ChannelType.GuildVoice } : null)
    }
  };
  const member = {
    id: 'player',
    displayName: 'Ada',
    guild,
    voice: { setChannel: async () => {} }
  };
  const setup = { moduleId: 'minecraft', guildId: GUILD, categoryId: 'game', lobbyBuilderChannelId: 'jtc' };
  const lobby = await provisioner.createOrReuseLobby(member, setup, null);
  assert.equal(lobby.parentId, VOICE_ID);
  assert.notEqual(created[0].parent, 'game');
  assert.equal(await provisioner.createOrReuseLobby({ ...member, id: 'other' }, { ...setup, moduleId: 'diablo4' }, null), null);
});

test('configured game order puts Minecraft first and Voice directly above Staff', () => {
  const channels = new Map([
    ['voice', category('voice', '🔊 VOICE', 0)],
    ['ark', category('ark', 'ARK Survival Ascended 🦖', 1)],
    ['info', category('info', '📌 INFORMATION', 2)],
    ['mc', category('mc', 'Minecraft ⛏️', 4)],
    ['hq', category('hq', '🌐 COMMUNITY HQ', 3)],
    ['staff', category('staff', '🔒 STAFF', 5)]
  ]);
  const alphabetical = serverCategoryOrderPlan(channels);
  assert.deepEqual(alphabetical.entries.map((entry) => entry.label), [
    'INFORMATION', 'NEXUS HQ', 'ARK Survival Ascended', 'Minecraft', 'VOICE', 'STAFF'
  ]);
  const configured = serverCategoryOrderPlan(channels, { gameOrder: ['minecraft', 'ark'] });
  assert.deepEqual(configured.entries.map((entry) => entry.label), [
    'INFORMATION', 'NEXUS HQ', 'Minecraft', 'ARK Survival Ascended', 'VOICE', 'STAFF'
  ]);
  assert.equal(structuralCategories(channels).information.id, 'info');
  assert.equal(structuralCategories(channels).nexusHq.id, 'hq');
  assert.equal(structuralCategories(channels).voice.id, 'voice');
  assert.equal(findInformationCategory(channels).id, 'info');
  assert.equal(findHqCategory(channels).id, 'hq');
  assert.equal(shouldRenameHqCategory('🌐 COMMUNITY HQ'), false);
  assert.equal(shouldRenameHqCategory('📌 INFORMATION'), true);
});

test('manual layout pins a jumped Voice category without reordering games', async () => {
  const channels = new Map([
    ['voice', category('voice', '🔊 VOICE', 0)],
    ['info', category('info', '📌 INFORMATION', 1)],
    ['mc', category('mc', 'Minecraft ⛏️', 2)],
    ['ark', category('ark', 'ARK Survival Ascended 🦖', 3)],
    ['staff', category('staff', '🔒 STAFF', 4)]
  ]);
  const pin = voicePinUpdates(channels);
  assert.equal(pin.needed, true);
  assert.deepEqual(pin.updates.map((item) => item.channel), ['info', 'mc', 'ark', 'voice', 'staff']);

  const batches = [];
  const guild = {
    id: GUILD,
    channels: {
      cache: channels,
      async fetch() { throw new Error('pin should use the snapshot'); },
      async setPositions(updates) { batches.push(updates); }
    },
    roles: { cache: new Map() }
  };
  const config = {
    discord: {
      respectManualLayout: true,
      respectManualLayoutGuildIds: [GUILD],
      pinPlayerVoice: true,
      gameCategoryOrder: ['minecraft', 'ark'],
      enforceGameCategoryOrder: false
    }
  };
  const corrected = await reconcileServerCategoryOrder(guild, {
    channelsSnapshot: channels,
    rolesSnapshot: new Map(),
    config
  });
  assert.equal(corrected.orderPreserved, true);
  assert.equal(corrected.voicePinned, true);
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0], pin.updates);

  const already = new Map([
    ['info', category('info', '📌 INFORMATION', 0)],
    ['mc', category('mc', 'Minecraft ⛏️', 1)],
    ['voice', category('voice', '🔊 VOICE', 2)],
    ['staff', category('staff', '🔒 STAFF', 3)]
  ]);
  assert.equal(voicePinUpdates(already).needed, false);
  let calls = 0;
  const steady = await reconcileServerCategoryOrder({
    id: GUILD,
    channels: { cache: already, async setPositions() { calls += 1; } },
    roles: { cache: new Map() }
  }, { channelsSnapshot: already, rolesSnapshot: new Map(), config });
  assert.equal(steady.voicePinned, false);
  assert.equal(steady.moved, 0);
  assert.equal(calls, 0);
});

test('enforcing the configured order is opt-in and still places Voice above Staff', async () => {
  const channels = new Map([
    ['voice', category('voice', '🔊 VOICE', 0)],
    ['ark', category('ark', 'ARK Survival Ascended 🦖', 1)],
    ['mc', category('mc', 'Minecraft ⛏️', 2)],
    ['staff', category('staff', '🔒 STAFF', 3)]
  ]);
  const batches = [];
  const guild = {
    id: GUILD,
    channels: {
      cache: channels,
      async setPositions(updates) { batches.push(updates); }
    },
    roles: { cache: new Map() }
  };
  const result = await reconcileServerCategoryOrder(guild, {
    channelsSnapshot: channels,
    rolesSnapshot: new Map(),
    config: {
      discord: {
        respectManualLayout: true,
        respectManualLayoutGuildIds: [GUILD],
        enforceGameCategoryOrder: true,
        gameCategoryOrder: ['approved'],
        pinPlayerVoice: true
      }
    }
  });
  assert.equal(result.orderPreserved, false);
  assert.equal(batches.length, 1);
  assert.deepEqual(result.hierarchy, ['Minecraft', 'ARK Survival Ascended', 'VOICE', 'STAFF']);
  assert.deepEqual(batches[0].map((item) => item.channel), ['mc', 'ark', 'voice', 'staff']);
});

test('Community HQ voice channels stay in Voice and Staff', async () => {
  const hq = channel({ id: 'hq', name: '🌐 COMMUNITY HQ', type: ChannelType.GuildCategory });
  const voice = channel({ id: VOICE_ID, name: '🔊 VOICE', type: ChannelType.GuildCategory });
  const staff = channel({ id: 'staff', name: '🔒 STAFF', type: ChannelType.GuildCategory });
  const lounge = channel({ id: 'lounge', name: 'Nexus Lounge', type: ChannelType.GuildVoice, parentId: VOICE_ID });
  const afk = channel({ id: 'afk', name: 'AFK', type: ChannelType.GuildVoice, parentId: 'staff' });
  const channels = new Map([
    [hq.id, hq],
    [voice.id, voice],
    [staff.id, staff],
    [lounge.id, lounge],
    [afk.id, afk]
  ]);
  const loungeSpec = HQ_CHANNELS.find((item) => item.key === 'lounge');
  const afkSpec = HQ_CHANNELS.find((item) => item.key === 'afk');
  const loungeResult = await ensureChannel({ id: GUILD }, hq, loungeSpec, channels, {
    discord: { respectManualLayout: false, playerVoiceCategoryId: VOICE_ID }
  });
  const afkResult = await ensureChannel({ id: GUILD }, hq, afkSpec, channels, {});
  assert.equal(loungeResult.relocated, true);
  assert.equal(loungeResult.moved, false);
  assert.equal(loungeResult.channel.id, 'lounge');
  assert.equal(afkResult.relocated, true);
  assert.equal(afkResult.moved, false);
});

test('layout env flags default to the approved sidebar without enforcing a reshuffle', () => {
  const keys = [
    'NEXUS_SLIM_GAME_LAYOUT',
    'NEXUS_PLAYER_VOICE_CATEGORY_ID',
    'NEXUS_GAME_CATEGORY_ORDER',
    'NEXUS_ENFORCE_GAME_CATEGORY_ORDER',
    'NEXUS_PIN_PLAYER_VOICE'
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    const defaults = loadConfig();
    assert.equal(defaults.discord.slimGameLayout, true);
    assert.equal(defaults.discord.playerVoiceCategoryId, '');
    assert.deepEqual(defaults.discord.gameCategoryOrder, []);
    assert.equal(defaults.discord.enforceGameCategoryOrder, false);
    assert.equal(defaults.discord.pinPlayerVoice, true);

    process.env.NEXUS_SLIM_GAME_LAYOUT = 'false';
    process.env.NEXUS_PLAYER_VOICE_CATEGORY_ID = VOICE_ID;
    process.env.NEXUS_GAME_CATEGORY_ORDER = 'approved';
    process.env.NEXUS_ENFORCE_GAME_CATEGORY_ORDER = 'false';
    process.env.NEXUS_PIN_PLAYER_VOICE = 'true';
    const pinned = loadConfig();
    assert.equal(pinned.discord.slimGameLayout, false);
    assert.equal(pinned.discord.playerVoiceCategoryId, VOICE_ID);
    assert.deepEqual(pinned.discord.gameCategoryOrder, ['approved']);
    assert.equal(pinned.discord.enforceGameCategoryOrder, false);
    assert.equal(pinned.discord.pinPlayerVoice, true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('module inspection treats a Voice lobby as present and ignores collapsed rooms', async () => {
  const { Collection } = require('discord.js');
  const layout = layoutFor('warframe');
  const channels = new Collection([
    ['game', { id: 'game', name: 'Warframe ⚡', type: ChannelType.GuildCategory }],
    ['hub', { id: 'hub', name: 'warframe-hub', type: ChannelType.GuildText, parentId: 'game' }],
    ['lfg', { id: 'lfg', name: 'warframe-lfg', type: ChannelType.GuildText, parentId: 'game' }],
    ['builds', { id: 'builds', name: 'warframe-builds', type: ChannelType.GuildText, parentId: 'game' }],
    ['voice', { id: VOICE_ID, name: '🔊 VOICE', type: ChannelType.GuildCategory }],
    ['jtc', { id: 'jtc', name: layout.lobbyBuilder, type: ChannelType.GuildVoice, parentId: VOICE_ID }]
  ]);
  const report = await inspectModuleLayout({
    id: GUILD,
    channels: { fetch: async () => channels }
  }, 'warframe', { config: { discord: { slimGameLayout: true, playerVoiceCategoryId: VOICE_ID } } });
  assert.equal(report.missingChannels.includes('warframe-builds'), false);
  assert.equal(report.lobbyBuilder.exists, true);
  assert.equal(report.lobbyBuilder.id, 'jtc');
  assert.deepEqual(report.textChannels.map((item) => item.name), ['warframe-hub', 'warframe-lfg']);
});
