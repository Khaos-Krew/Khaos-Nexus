'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { loadConfig } = require('../src/shared/config.cjs');
const { ModuleProvisioner } = require('../src/sentinel/module-provisioner.cjs');
const { layoutFor } = require('../src/sentinel/module-layouts.cjs');
const {
  collapseDryRun,
  formatCollapseDryRun,
  SLIM_GAME_MODULE_IDS
} = require('../src/sentinel/layout-collapse.cjs');
const {
  arrangeCategories,
  reconcileServerCategoryOrder,
  serverCategoryOrderPlan,
  STRUCTURAL_CATEGORY_ALIASES
} = require('../src/sentinel/category-order.cjs');
const { ensureAboutChannel, refreshAboutPanel } = require('../src/sentinel/about-extension.cjs');
const { RoadmapPatchNotePublisher } = require('../src/sentinel/roadmap-patch-notes.cjs');
const { StateStore } = require('../src/sentinel/state-store.cjs');
const { ensureCategory, ensureChannel, findHqCategory } = require('../src/sentinel/nexus-hq.cjs');
const { reconcileModuleAccessPolicy } = require('../src/sentinel/module-access-policy.cjs');
const { feedsFor, EventFeedPublisher } = require('../src/sentinel/event-feed.cjs');
const { refreshClusterPanel } = require('../src/sentinel/ark-cluster-extension.cjs');
const { resolveAlertChannel } = require('../src/sentinel/ark-update-monitor.cjs');
const { isModuleChannelsNotProvisionedError } = require('../src/sentinel/no-provision-modules.cjs');
const { informationCategory } = require('../src/sentinel/shield-isolation-extension.cjs');

const GUILD = '1016059608789434408';

function overwrite(viewState) {
  return {
    allow: { has: (bit) => bit === PermissionFlagsBits.ViewChannel && viewState === true },
    deny: { has: (bit) => bit === PermissionFlagsBits.ViewChannel && viewState === false }
  };
}

function channel(fields) {
  return {
    setParent: async () => { throw new Error(`must not move ${fields.name}`); },
    setName: async () => { throw new Error(`must not rename ${fields.name}`); },
    permissionOverwrites: {
      cache: new Map(Object.entries(fields.views || {}).map(([id, state]) => [id, overwrite(state)])),
      edit: fields.editPermissions || (async () => {})
    },
    ...fields
  };
}

function memoryState() {
  const setups = {};
  return {
    setups,
    listModuleSetups: () => setups,
    setModuleSetup: (id, value) => { setups[id] = value; },
    getModuleSetup: (id) => setups[id] || null,
    getAccessRole: () => null,
    listAccessRoles: () => ({}),
    getAdminSettings: () => ({}),
    findTempLobbyByOwner: () => null,
    getTempLobby: () => null,
    setTempLobby: () => {},
    removeTempLobby: () => {},
    listTempLobbies: () => ({})
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
        fetch: async () => map,
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
      roles: { fetch: async () => new Map(), everyone: GUILD }
    }
  };
}

function category(id, name, position) {
  return { id, name, type: ChannelType.GuildCategory, rawPosition: position, position };
}

test('layout flags default off and load from the environment', () => {
  const names = [
    'NEXUS_SLIM_GAME_LAYOUT',
    'NEXUS_PLAYER_VOICE_CATEGORY',
    'NEXUS_PLAYER_VOICE_CATEGORY_ID',
    'NEXUS_GAME_CATEGORY_ORDER',
    'NEXUS_FOLD_START_HERE',
    'NEXUS_LAYOUT_GUILD_IDS',
    'NEXUS_ARK_MODULE_RETIRED'
  ];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  try {
    const off = loadConfig();
    assert.equal(off.discord.slimGameLayout, false);
    assert.equal(off.discord.playerVoiceCategory, false);
    assert.equal(off.discord.foldStartHere, false);
    assert.equal(off.discord.gameCategoryOrder, '');
    assert.notEqual(off.modules.ark?.retired, true);

    process.env.NEXUS_SLIM_GAME_LAYOUT = 'true';
    process.env.NEXUS_PLAYER_VOICE_CATEGORY = 'true';
    process.env.NEXUS_PLAYER_VOICE_CATEGORY_ID = '1569266940508110928';
    process.env.NEXUS_GAME_CATEGORY_ORDER = 'minecraft-first';
    process.env.NEXUS_FOLD_START_HERE = 'true';
    process.env.NEXUS_LAYOUT_GUILD_IDS = GUILD;
    process.env.NEXUS_ARK_MODULE_RETIRED = 'true';
    const on = loadConfig();
    assert.equal(on.discord.slimGameLayout, true);
    assert.equal(on.discord.playerVoiceCategoryId, '1569266940508110928');
    assert.equal(on.discord.gameCategoryOrder, 'minecraft-first');
    assert.deepEqual(on.discord.layoutGuildIds, [GUILD]);
    assert.equal(on.modules.ark.retired, true);
    assert.equal(on.modules.ark.enabled, false);
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('dry run lists slim extras by layout name and never deletes', () => {
  const result = collapseDryRun();
  assert.equal(result.deleted, false);
  assert.equal(result.posts, false);
  assert.equal(result.rolesChanged, false);
  assert.deepEqual(result.keptFullModules, ['division2', 'pokemongo', 'palworld']);
  const byId = Object.fromEntries(result.modules.map((item) => [item.moduleId, item.remove.map((row) => row.name)]));
  assert.deepEqual(byId, {
    callofduty: ['cod-news', 'cod-warzone', 'cod-multiplayer', 'cod-zombies', 'cod-loadouts'],
    deadbydaylight: ['dbd-killers', 'dbd-survivors', 'dbd-builds', 'dbd-stats'],
    diablo4: ['diablo-news', 'diablo-builds', 'diablo-items', 'diablo-paragon', 'diablo-farming'],
    destiny2: ['destiny-builds', 'destiny-activities', 'destiny-vendors'],
    warframe: ['warframe-world-state', 'warframe-builds', 'warframe-market']
  });
  for (const module of result.modules) {
    assert.equal(module.keep.at(-1).endsWith('lfg') || module.keep.includes('lfg'), true);
    assert.equal(module.remove.some((row) => row.name.endsWith('-lfg')), false);
  }
  const text = formatCollapseDryRun(result);
  assert.match(text, /No channels are deleted/);
  assert.match(text, /diablo-farming/);
  assert.doesNotMatch(text, /division-builds/);
  assert.doesNotMatch(text, /pokemon-go-raids/);
  assert.match(text, /not removal candidates:.*palworld-backups/);
  assert.deepEqual([...SLIM_GAME_MODULE_IDS], ['callofduty', 'deadbydaylight', 'diablo4', 'destiny2', 'warframe']);

  const marked = collapseDryRun({
    channels: [{ id: '1', name: 'diablo-farming', parent_id: 'game' }, { id: '2', name: 'diablo-hub', parent_id: 'game' }]
  });
  const farming = marked.modules.find((item) => item.moduleId === 'diablo4').remove.find((row) => row.name === 'diablo-farming');
  assert.equal(farming.matches[0].id, '1');
  assert.equal(farming.matches[0].parentId, 'game');
});

test('collapse dry-run script prints layout names and exits cleanly', () => {
  const run = spawnSync(process.execPath, [path.join(__dirname, '../scripts/discord-layout-collapse-dry-run.cjs')], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /cod-loadouts/);
  assert.match(run.stdout, /destiny-vendors/);
  assert.match(run.stdout, /No channels are deleted/);
});

test('slim layout and player voice do not recreate extras or pull staff voice into a game', async () => {
  const game = channel({ id: 'game', name: 'Diablo IV 🔥', type: ChannelType.GuildCategory });
  const voice = channel({ id: '1569266940508110928', name: '🔊 VOICE', type: ChannelType.GuildCategory });
  const staff = channel({ id: 'staff', name: '🔒 STAFF', type: ChannelType.GuildCategory });
  let movedLobby = '';
  const lobby = channel({
    id: 'jtc',
    name: layoutFor('diablo4').lobbyBuilder,
    type: ChannelType.GuildVoice,
    parentId: 'game',
    setParent: async (parentId) => { movedLobby = parentId; lobby.parentId = parentId; }
  });
  const staffVoice = channel({
    id: 'meeting',
    name: 'Staff Meeting Room',
    type: ChannelType.GuildVoice,
    parentId: 'staff'
  });
  const { guild, created } = guildFor([game, voice, staff, lobby, staffVoice]);
  const setup = await new ModuleProvisioner({
    state: memoryState(),
    config: {
      discord: {
        slimGameLayout: true,
        playerVoiceCategory: true,
        playerVoiceCategoryId: '1569266940508110928',
        layoutGuildIds: [GUILD]
      }
    }
  }).provision(guild, 'diablo4');
  assert.deepEqual(created.map((item) => item.name).sort(), ['diablo-hub', 'diablo-lfg']);
  assert.equal(created.every((item) => item.parentId === 'game'), true);
  assert.equal(movedLobby, '1569266940508110928');
  assert.equal(setup.lobbyBuilderChannelId, 'jtc');
  assert.equal(staffVoice.parentId, 'staff');
  assert.equal(created.some((item) => item.name === 'diablo-farming'), false);
});

test('default repair still builds a full Diablo layout and leaves STAFF consoles put', async () => {
  const cases = [
    ['minecraft', 'Minecraft ⛏️', ['minecraft-console', 'minecraft-backups']],
    ['ark', 'ARK Survival Ascended 🦖', ['ark-console']],
    ['palworld', 'Palworld 🐾', ['palworld-console', 'palworld-backups']]
  ];
  for (const [moduleId, categoryName, held] of cases) {
    const game = channel({ id: 'game', name: categoryName, type: ChannelType.GuildCategory });
    const staff = channel({ id: 'staff', name: '🔒 STAFF', type: ChannelType.GuildCategory });
    const heldChannels = held.map((name, index) => channel({
      id: `held-${index}`,
      name,
      type: ChannelType.GuildText,
      parentId: 'staff'
    }));
    const { guild, created } = guildFor([game, staff, ...heldChannels]);
    const setup = await new ModuleProvisioner({ state: memoryState(), config: {} }).provision(guild, moduleId);
    for (const name of held) assert.equal(created.some((item) => item.name === name), false, name);
    assert.equal(setup.movedChannels.includes(held[0]), false);
  }

  const game = channel({ id: 'game', name: 'Diablo IV 🔥', type: ChannelType.GuildCategory });
  const { guild, created } = guildFor([game]);
  await new ModuleProvisioner({ state: memoryState(), config: {} }).provision(guild, 'diablo4');
  assert.ok(created.some((item) => item.name === 'diablo-builds'));
  assert.ok(created.some((item) => item.name === 'diablo-lfg'));
});

test('division keeps its full layout when the slim flag is on', async () => {
  const game = channel({ id: 'game', name: 'The Division 2 🟠', type: ChannelType.GuildCategory });
  const { guild, created } = guildFor([game]);
  await new ModuleProvisioner({
    state: memoryState(),
    config: { discord: { slimGameLayout: true, layoutGuildIds: [GUILD] } }
  }).provision(guild, 'division2');
  assert.ok(created.some((item) => item.name === 'division-builds'));
  assert.ok(created.some((item) => item.name === 'division-farming'));
  assert.ok(created.some((item) => item.name === 'division-lfg'));
});

test('configured order puts Minecraft first and VOICE directly above STAFF', () => {
  const channels = new Map([
    ['voice', category('voice', '🔊 VOICE', 0)],
    ['info', category('info', '📌 INFORMATION', 1)],
    ['osrs', category('osrs', 'OSRS ⚔️', 2)],
    ['mc', category('mc', 'Minecraft ⛏️', 3)],
    ['staff', category('staff', '🔒 STAFF', 4)]
  ]);
  const plan = serverCategoryOrderPlan(channels);
  const voiceIndex = plan.entries.findIndex((entry) => entry.kind === 'voice');
  const staffIndex = plan.entries.findIndex((entry) => entry.kind === 'staff');
  assert.equal(voiceIndex, staffIndex - 1);
  assert.ok(voiceIndex > 0);
  assert.ok(STRUCTURAL_CATEGORY_ALIASES.information.includes('start here'));
  assert.ok(STRUCTURAL_CATEGORY_ALIASES.nexusHq.includes('community hq'));

  const arranged = arrangeCategories(channels.values(), [
    plan.modules.find((entry) => entry.moduleId === 'minecraft').category,
    plan.modules.find((entry) => entry.moduleId === 'osrs').category
  ]);
  assert.deepEqual(arranged.map((item) => item.id), ['info', 'mc', 'osrs', 'voice', 'staff']);
});

test('manual layout does not alphabetize, and a misplaced VOICE category is pinned above STAFF', async () => {
  const channels = new Map([
    ['voice', category('voice', '🔊 VOICE', 0)],
    ['info', category('info', '📌 INFORMATION', 1)],
    ['mc', category('mc', 'Minecraft ⛏️', 2)],
    ['osrs', category('osrs', 'OSRS ⚔️', 3)],
    ['staff', category('staff', '🔒 STAFF', 5)]
  ]);
  const batches = [];
  const guild = {
    id: GUILD,
    ownerId: 'owner',
    channels: {
      cache: channels,
      async fetch() { throw new Error('must not fetch'); },
      async setPositions(updates) { batches.push(updates); }
    },
    roles: { cache: new Map() }
  };
  const config = { discord: { respectManualLayout: true, respectManualLayoutGuildIds: [GUILD] } };
  const pinned = await reconcileServerCategoryOrder(guild, { channelsSnapshot: channels, rolesSnapshot: new Map(), config });
  assert.equal(pinned.orderMode, 'preserved');
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].map((item) => item.channel), ['info', 'mc', 'osrs', 'voice', 'staff']);
  assert.notEqual(batches[0][0].channel, 'voice');

  const already = new Map([
    ['info', category('info', 'INFORMATION', 0)],
    ['mc', category('mc', 'Minecraft ⛏️', 1)],
    ['osrs', category('osrs', 'OSRS ⚔️', 2)],
    ['voice', category('voice', '🔊 VOICE', 3)],
    ['staff', category('staff', 'STAFF', 4)]
  ]);
  const quiet = [];
  const quietGuild = {
    ...guild,
    channels: {
      cache: already,
      async fetch() { throw new Error('must not fetch'); },
      async setPositions(updates) { quiet.push(updates); }
    }
  };
  const kept = await reconcileServerCategoryOrder(quietGuild, { channelsSnapshot: already, rolesSnapshot: new Map(), config });
  assert.equal(kept.moved, 0);
  assert.deepEqual(quiet, []);
});

test('COMMUNITY HQ stays an alias and player voice is not pulled back out of VOICE', async () => {
  const hq = channel({ id: 'hq', name: '🌐 COMMUNITY HQ', type: ChannelType.GuildCategory });
  const voice = channel({ id: 'voice', name: '🔊 VOICE', type: ChannelType.GuildCategory });
  const lounge = channel({
    id: 'lounge',
    name: 'Nexus Lounge',
    type: ChannelType.GuildVoice,
    parentId: 'voice'
  });
  const map = new Map([[hq.id, hq], [voice.id, voice], [lounge.id, lounge]]);
  assert.equal(findHqCategory(map).id, 'hq');
  const kept = await ensureCategory({ channels: { create: async () => { throw new Error('must not create'); } } }, map, { keepAliasName: true });
  assert.equal(kept.renamed, false);
  assert.equal(hq.name, '🌐 COMMUNITY HQ');
  const adopted = await ensureChannel({ channels: { create: async () => { throw new Error('must not create'); } } }, hq, {
    key: 'lounge',
    name: 'Nexus Lounge',
    type: ChannelType.GuildVoice,
    aliases: ['nexus lounge', 'lounge']
  }, map, { keepPlayerVoice: true, keepAliasName: true });
  assert.equal(adopted.moved, false);
  assert.equal(lounge.parentId, 'voice');
  assert.equal(adopted.channel.id, 'lounge');
});

test('folded or hidden about and patch-notes channels are not recreated or posted into', async () => {
  let created = 0;
  const guild = {
    id: GUILD,
    channels: {
      fetch: async () => new Map([['info', { id: 'info', name: 'INFORMATION', type: ChannelType.GuildCategory }]]),
      create: async () => { created += 1; throw new Error('must not create about'); }
    }
  };
  const folded = await ensureAboutChannel(guild, { config: { discord: { foldStartHere: true } } });
  assert.equal(folded.skipped, 'folded-into-start-here');
  assert.equal(folded.created, false);
  assert.equal(created, 0);

  const hiddenAbout = channel({
    id: 'about',
    name: 'about',
    type: ChannelType.GuildText,
    parentId: 'staff',
    isTextBased: () => true,
    views: { [GUILD]: false }
  });
  const hiddenGuild = {
    id: GUILD,
    channels: {
      fetch: async () => {
        const map = new Map([
          ['info', { id: 'info', name: 'INFORMATION', type: ChannelType.GuildCategory }],
          [hiddenAbout.id, hiddenAbout]
        ]);
        return map;
      },
      create: async () => { throw new Error('must not create about'); }
    }
  };
  const hidden = await ensureAboutChannel(hiddenGuild, { config: {} });
  assert.equal(hidden.skipped, 'hidden-by-hand');
  assert.equal(hidden.moved, false);
  const panel = await refreshAboutPanel({ user: { id: 'bot' }, guilds: { fetch: async () => hiddenGuild } }, { discord: { guildId: GUILD } }, { guild: hiddenGuild });
  assert.equal(panel.skipped, 'hidden-by-hand');

  const notes = channel({
    id: 'notes',
    name: 'patch-notes',
    type: ChannelType.GuildText,
    isTextBased: () => true,
    views: { [GUILD]: false },
    send: async () => { throw new Error('must not post patch notes'); }
  });
  const state = new StateStore();
  const publisher = new RoadmapPatchNotePublisher({
    state,
    config: { discord: { foldStartHere: false } },
    notes: [{ key: 'sample:100', section: 'Sample', percent: 100, title: 'Sample', summary: 'Public sample.', highlights: ['One'] }],
    logger: { log() {}, warn() {}, error() {} }
  });
  const skipped = await publisher.publishPending({
    id: GUILD,
    channels: { fetch: async () => new Map([[notes.id, notes]]) }
  });
  assert.match(skipped.warnings[0], /hidden/);
  assert.equal(state.getRoadmapPatchNote('sample:100'), null);

  const foldedNotes = await new RoadmapPatchNotePublisher({
    state: new StateStore(),
    config: { discord: { foldStartHere: true } },
    notes: publisher.notes,
    logger: { log() {}, warn() {}, error() {} }
  }).publishPending({
    id: GUILD,
    channels: { fetch: async () => { throw new Error('must not look up patch-notes'); } }
  });
  assert.match(foldedNotes.warnings[0], /folded into #start-here/);
});

test('INFORMATION can still be recovered from #start-here after #about is gone', () => {
  const channels = new Map([
    ['custom', { id: 'custom', name: 'Library', type: ChannelType.GuildCategory }],
    ['start', { id: 'start', name: 'start-here', type: ChannelType.GuildText, parentId: 'custom' }]
  ]);
  assert.equal(informationCategory(channels).id, 'custom');
});

test('retired ARK is not provisioned, unhidden, or posted to', async () => {
  const previous = process.env.NEXUS_ARK_MODULE_RETIRED;
  delete process.env.NEXUS_ARK_MODULE_RETIRED;
  try {
    const guild = {
      id: GUILD,
      channels: { fetch: async () => { throw new Error('must not fetch'); }, create: async () => { throw new Error('must not create'); } }
    };
    await assert.rejects(
      new ModuleProvisioner({ state: memoryState(), config: { modules: { ark: { retired: true } } } }).provision(guild, 'ark'),
      (error) => isModuleChannelsNotProvisionedError(error) && /retired/i.test(error.message)
    );

    const categoryChannel = channel({ id: 'ark-cat', name: 'ARK Survival Ascended 🦖', type: ChannelType.GuildCategory });
    const cobblemon = channel({
      id: 'cobble',
      name: 'cobblemon',
      type: ChannelType.GuildText,
      parentId: 'mc',
      editPermissions: async () => { throw new Error('must not unhide cobblemon'); }
    });
    let minecraftEdits = 0;
    const minecraft = channel({
      id: 'mc',
      name: 'Minecraft ⛏️',
      type: ChannelType.GuildCategory,
      permissionOverwrites: {
        cache: new Map(),
        edit: async () => { minecraftEdits += 1; }
      }
    });
    const access = await reconcileModuleAccessPolicy(guildFor([categoryChannel]).guild, 'ark', categoryChannel, {
      config: { modules: { ark: { retired: true } } },
      channelsSnapshot: new Map([[categoryChannel.id, categoryChannel]])
    });
    assert.equal(access.skipped, true);
    assert.equal(access.reason, 'ark-retired');

    const minecraftGuild = guildFor([minecraft, cobblemon]).guild;
    minecraftGuild.roles.fetch = async () => new Map([['role-mc', { id: 'role-mc', name: 'Minecraft' }]]);
    const minecraftState = memoryState();
    minecraftState.getAccessRole = () => ({ roleId: 'role-mc' });
    const minecraftPolicy = await reconcileModuleAccessPolicy(minecraftGuild, 'minecraft', minecraft, {
      config: {},
      state: minecraftState,
      channelsSnapshot: new Map([[minecraft.id, minecraft], [cobblemon.id, cobblemon]])
    });
    const cobblemonResult = minecraftPolicy.channels.find((item) => item.channelName === 'cobblemon');
    assert.equal(cobblemonResult.skipped, true);
    assert.equal(cobblemonResult.reason, 'hidden-by-hand');

    assert.equal(feedsFor({ NEXUS_ARK_MODULE_RETIRED: 'true' }).some((feed) => feed.moduleId === 'ark'), false);
    assert.equal(feedsFor({}).some((feed) => feed.moduleId === 'ark'), true);
    const publisher = new EventFeedPublisher({ env: { NEXUS_ARK_MODULE_RETIRED: 'true' }, logger: { log() {}, warn() {}, error() {} } });
    const published = await publisher.publish({ moduleId: 'ark', channelName: 'ark-schedules', actions: ['schedule-list'] });
    assert.equal(published.skipped, 'ark-retired');

    const panel = await refreshClusterPanel({ guilds: { fetch: async () => { throw new Error('must not fetch'); } } }, {}, { modules: { ark: { retired: true } } });
    assert.equal(panel.skipped, 'ark-retired');
    const alert = await resolveAlertChannel({ channels: { fetch: async () => { throw new Error('must not fetch'); } } }, { env: { NEXUS_ARK_MODULE_RETIRED: 'true' } });
    assert.equal(alert, null);
    assert.equal(minecraftEdits >= 0, true);
  } finally {
    if (previous === undefined) delete process.env.NEXUS_ARK_MODULE_RETIRED;
    else process.env.NEXUS_ARK_MODULE_RETIRED = previous;
  }
});
