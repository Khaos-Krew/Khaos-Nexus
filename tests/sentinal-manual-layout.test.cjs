'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { loadConfig } = require('../src/shared/config.cjs');
const { ModuleProvisioner, bestCategoryMatch, resolveManagedChannel } = require('../src/sentinel/module-provisioner.cjs');
const { layoutFor } = require('../src/sentinel/module-layouts.cjs');
const {
  hiddenFromEveryone,
  respectsManualLayout,
  shouldPostLayoutMessage
} = require('../src/sentinel/manual-layout.cjs');
const { publishModuleHub } = require('../src/sentinel/module-autoprovision-extension.cjs');

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
    permissionOverwrites: { cache: new Map(Object.entries(fields.views || {}).map(([id, state]) => [id, overwrite(state)])) },
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
    findTempLobbyByOwner: (moduleId, ownerId) => Object.values(lobbies).find((item) => item.moduleId === moduleId && item.ownerId === ownerId) || null,
    getTempLobby: (id) => lobbies[id] || null,
    setTempLobby: (id, value) => { lobbies[id] = value; },
    removeTempLobby: (id) => { delete lobbies[id]; },
    listTempLobbies: () => lobbies
  };
}

function guildFor(list, { create = null } = {}) {
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
          if (create) return create(options);
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

test('manual layout defaults off and can be limited to the main guild', () => {
  assert.equal(respectsManualLayout({}, GUILD), false);
  assert.equal(respectsManualLayout({ discord: { respectManualLayout: false } }, GUILD), false);
  assert.equal(respectsManualLayout({ discord: { respectManualLayout: true } }, GUILD), true);
  assert.equal(respectsManualLayout({
    discord: { respectManualLayout: true, respectManualLayoutGuildIds: [GUILD] }
  }, GUILD), true);
  assert.equal(respectsManualLayout({
    discord: { respectManualLayout: true, respectManualLayoutGuildIds: [GUILD] }
  }, '900000000000000099'), false);
  assert.equal(respectsManualLayout({
    discord: { respectManualLayout: true, respectManualLayoutGuildIds: [GUILD] }
  }, ''), false);

  const previousFlag = process.env.NEXUS_RESPECT_MANUAL_LAYOUT;
  const previousGuilds = process.env.NEXUS_RESPECT_MANUAL_LAYOUT_GUILD_IDS;
  process.env.NEXUS_RESPECT_MANUAL_LAYOUT = 'true';
  process.env.NEXUS_RESPECT_MANUAL_LAYOUT_GUILD_IDS = GUILD;
  try {
    const config = loadConfig();
    assert.equal(config.discord.respectManualLayout, true);
    assert.deepEqual(config.discord.respectManualLayoutGuildIds, [GUILD]);
    assert.equal(respectsManualLayout(config, GUILD), true);
    assert.equal(respectsManualLayout(config, '2000000000000000002'), false);
  } finally {
    if (previousFlag === undefined) delete process.env.NEXUS_RESPECT_MANUAL_LAYOUT;
    else process.env.NEXUS_RESPECT_MANUAL_LAYOUT = previousFlag;
    if (previousGuilds === undefined) delete process.env.NEXUS_RESPECT_MANUAL_LAYOUT_GUILD_IDS;
    else process.env.NEXUS_RESPECT_MANUAL_LAYOUT_GUILD_IDS = previousGuilds;
  }
});

test('repair leaves STAFF consoles and VOICE join-to-create triggers where they are', async () => {
  const layout = layoutFor('minecraft');
  const game = channel({ id: 'game', name: 'Minecraft ⛏️', type: ChannelType.GuildCategory });
  const staff = channel({ id: 'staff', name: '🔒 STAFF', type: ChannelType.GuildCategory });
  const voice = channel({ id: 'voice', name: '🔊 VOICE', type: ChannelType.GuildCategory });
  const consoleChannel = channel({ id: 'console', name: 'minecraft-console', type: ChannelType.GuildText, parentId: 'staff' });
  const backups = channel({ id: 'backups', name: 'minecraft-backups', type: ChannelType.GuildText, parentId: 'staff' });
  const trigger = channel({ id: 'jtc', name: layout.lobbyBuilder, type: ChannelType.GuildVoice, parentId: 'voice' });
  const { guild, created } = guildFor([game, staff, voice, consoleChannel, backups, trigger]);
  const state = memoryState();
  const provisioner = new ModuleProvisioner({ state, config: { discord: { respectManualLayout: false } } });
  const setup = await provisioner.provision(guild, 'minecraft');

  assert.equal(created.some((item) => item.name === 'minecraft-console'), false);
  assert.equal(created.some((item) => item.name === 'minecraft-backups'), false);
  assert.equal(created.some((item) => item.name === layout.lobbyBuilder), false);
  assert.equal(setup.movedChannels.length, 0);
  assert.equal(setup.consoleChannelId, 'console');
  assert.equal(setup.lobbyBuilderChannelId, 'jtc');
  assert.equal(setup.textChannels.find((item) => item.name === 'minecraft-backups').relocated, true);
  assert.ok(created.some((item) => item.name === 'minecraft-server-status' && item.parentId === 'game'));
});

test('the main-guild flag does not recreate unused subchannels and still refreshes in-category roles', async () => {
  const game = channel({ id: 'game', name: 'Minecraft ⛏️', type: ChannelType.GuildCategory });
  const staff = channel({ id: 'staff', name: '🔒 STAFF', type: ChannelType.GuildCategory });
  const consoleChannel = channel({ id: 'console', name: 'minecraft-console', type: ChannelType.GuildText, parentId: 'game' });
  const { guild, created } = guildFor([game, staff, consoleChannel]);
  const provisioner = new ModuleProvisioner({
    state: memoryState(),
    config: { discord: { respectManualLayout: true, respectManualLayoutGuildIds: [GUILD] } }
  });
  const setup = await provisioner.provision(guild, 'minecraft');
  assert.deepEqual(created.map((item) => item.name), []);
  assert.equal(setup.createdChannels.length, 0);
  assert.equal(setup.lobbyBuilderChannelId, '');
  assert.equal(setup.consoleChannelId, 'console');

  const unknownGuild = { ...guild, id: '2000000000000000002' };
  const unknown = await new ModuleProvisioner({
    state: memoryState(),
    config: { discord: { respectManualLayout: true, respectManualLayoutGuildIds: [GUILD] } }
  }).provision(unknownGuild, 'minecraft');
  assert.ok(unknown.createdChannels.includes('minecraft-lfg'));
  assert.ok(unknown.createdChannels.includes(layoutFor('minecraft').lobbyBuilder));
});

test('a channel hidden from everyone is not recreated or posted into', async () => {
  const game = channel({ id: 'game', name: 'Minecraft ⛏️', type: ChannelType.GuildCategory });
  const hidden = channel({
    id: 'hidden-lfg',
    name: 'minecraft-lfg',
    type: ChannelType.GuildText,
    parentId: 'staff',
    guildId: GUILD,
    isTextBased: () => true,
    views: { [GUILD]: false }
  });
  const { guild, created } = guildFor([game, hidden]);
  const result = await resolveManagedChannel(guild, game, 'minecraft-lfg', ChannelType.GuildText, { createMissing: true });
  assert.equal(created.length, 0);
  assert.equal(result.channel.id, 'hidden-lfg');
  assert.equal(result.hidden, true);
  assert.equal(result.created, false);
  assert.equal(result.moved, false);
  assert.equal(hiddenFromEveryone(hidden, GUILD), true);
  assert.equal(shouldPostLayoutMessage(hidden, { categoryId: 'game', guildId: GUILD }), false);
  assert.equal(shouldPostLayoutMessage(channel({
    id: 'console',
    name: 'minecraft-console',
    type: ChannelType.GuildText,
    parentId: 'game',
    views: { [GUILD]: false }
  }), { categoryId: 'game', guildId: GUILD }), true);

  let sent = 0;
  const published = await publishModuleHub({
    channels: { fetch: async () => hidden }
  }, {}, { setConsole() { sent += 1; } }, { categoryId: 'game', consoleChannelId: 'hidden-lfg' }, 'minecraft', { log() {}, warn() {} });
  assert.equal(published.reason, 'layout-post-suppressed');
  assert.equal(sent, 0);
});

test('join-to-create rooms open in the trigger parent, including VOICE', async () => {
  const state = memoryState();
  const provisioner = new ModuleProvisioner({ state });
  const created = [];
  const trigger = { id: 'jtc', parentId: 'voice', type: ChannelType.GuildVoice };
  const guild = {
    id: GUILD,
    channels: {
      create: async (options) => {
        const made = { id: 'temp-1', ...options, type: ChannelType.GuildVoice, parentId: options.parent };
        created.push(made);
        return made;
      },
      fetch: async (id) => (id === 'temp-1' ? created[0] : trigger)
    }
  };
  const member = {
    id: 'player',
    displayName: 'Ada',
    guild,
    voice: { setChannel: async () => {} }
  };
  const setup = { moduleId: 'minecraft', guildId: GUILD, categoryId: 'game', lobbyBuilderChannelId: 'jtc' };
  state.setModuleSetup('minecraft', setup);
  const lobby = await provisioner.createOrReuseLobby(member, setup, trigger);
  assert.equal(lobby.parentId, 'voice');
  assert.equal(created[0].parent, 'voice');
  assert.notEqual(created[0].parent, 'game');
  assert.equal(state.getTempLobby('temp-1').categoryId, 'voice');

  assert.equal(bestCategoryMatch(new Map([
    ['1', { id: '1', name: '🔒 STAFF', type: ChannelType.GuildCategory }],
    ['2', { id: '2', name: '🔊 VOICE', type: ChannelType.GuildCategory }],
    ['3', { id: '3', name: '📌 START HERE', type: ChannelType.GuildCategory }]
  ]), 'minecraft'), null);
});

test('an uncategorized channel can still be filed into its game category', async () => {
  const game = channel({ id: 'game', name: 'Minecraft ⛏️', type: ChannelType.GuildCategory });
  let movedTo = '';
  const orphan = channel({
    id: 'orphan',
    name: 'minecraft-console',
    type: ChannelType.GuildText,
    parentId: '',
    setParent: async (parentId) => { movedTo = parentId; }
  });
  const { guild, created } = guildFor([game, orphan]);
  const result = await resolveManagedChannel(guild, game, 'minecraft-console', ChannelType.GuildText, { createMissing: true });
  assert.equal(result.moved, true);
  assert.equal(movedTo, 'game');
  assert.equal(created.length, 0);
});
