'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ActivityType, ChannelType, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
const { LAYOUTS } = require('../src/sentinel/module-layouts.cjs');
const { ModuleProvisioner, resolveManagedChannel } = require('../src/sentinel/module-provisioner.cjs');
const { ensureChannel, lockHqChildren } = require('../src/sentinel/nexus-hq.cjs');
const { reconcileModuleAccessPolicy } = require('../src/sentinel/module-access-policy.cjs');
const { withTempVoiceIntents } = require('../src/sentinel/temp-voice-extension.cjs');
const {
  DEFAULT_VOICE_CATEGORY_ID,
  LOBBY_NAME,
  LOBBY_STATUS,
  OWNER_ALLOW,
  PRESERVED_CHANNEL_IDS,
  ROOM_STATUS,
  TempVoiceController,
  buildRoomName,
  isSentinalTempVoiceChannel,
  playingGameName,
  presenceIntentReport,
  resolveTempVoiceConfig,
  vcCommand
} = require('../src/sentinel/temp-voice.cjs');

const GUILD = '1016059608789434408';
const CATEGORY = '1569266940508110928';
const root = path.join(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sentinal-temp-voice-'));
}

function enabledEnv(extra = {}) {
  return {
    SENTINAL_TEMP_VOICE: 'true',
    NEXUS_DISCORD_GUILD_ID: GUILD,
    SENTINAL_TEMP_VOICE_CATEGORY_ID: CATEGORY,
    ...extra
  };
}

function members(ids) {
  return new Map(ids.map((id) => [id, { id }]));
}

function voiceChannel(fields) {
  const channel = {
    type: ChannelType.GuildVoice,
    members: members([]),
    permissionOverwrites: {
      cache: new Map(),
      edit: async () => {},
      delete: async () => {}
    },
    ...fields
  };
  channel.setName = fields.setName || (async (name) => { channel.name = name; });
  channel.setUserLimit = fields.setUserLimit || (async (limit) => { channel.userLimit = limit; });
  channel.delete = fields.delete || (async () => { channel.deleted = true; });
  channel.lockPermissions = fields.lockPermissions || (async () => { throw new Error(`must not lock ${channel.name}`); });
  channel.setParent = fields.setParent || (async () => { throw new Error(`must not move ${channel.name}`); });
  return channel;
}

function controllerFor(env, { schedule, now, graceMs } = {}) {
  let queued = null;
  const controller = new TempVoiceController({
    env,
    dir: tempDir(),
    graceMs,
    now: now || (() => 1_700_000_000_000),
    schedule: schedule || ((fn) => {
      queued = fn;
      return { unref() {} };
    })
  });
  return {
    controller,
    runQueued: async () => {
      const fn = queued;
      queued = null;
      if (fn) await fn();
    }
  };
}

function guildWith(list, { create } = {}) {
  const map = new Map(list.map((item) => [String(item.id), item]));
  return {
    map,
    guild: {
      id: GUILD,
      ownerId: 'guild-owner',
      afkChannelId: 'afk',
      channels: {
        fetch: async (id) => (id ? map.get(String(id)) || null : map),
        create: async (options) => {
          if (create) return create(options);
          const made = voiceChannel({
            id: `created-${map.size + 1}`,
            name: options.name,
            parentId: options.parent,
            permissionOverwrites: options.permissionOverwrites
              ? {
                cache: new Map(options.permissionOverwrites.map((entry) => [entry.id, {
                  allow: { has: (bit) => entry.allow.includes(bit) },
                  deny: { has: () => false }
                }])),
                edit: async () => {},
                delete: async () => {}
              }
              : undefined
          });
          made.createOptions = options;
          map.set(made.id, made);
          return made;
        }
      }
    }
  };
}

test('temporary voice stays off and does not request Guild Presences unless both flags are set', () => {
  const off = resolveTempVoiceConfig({});
  assert.equal(off.enabled, false);
  assert.equal(off.requestPresenceIntent, false);
  assert.equal(off.categoryId, '');
  assert.match(presenceIntentReport(off), /NOT requested/);
  assert.match(presenceIntentReport(off), /did not request|is not true|no presence intent/i);

  const presenceOnly = resolveTempVoiceConfig({ SENTINAL_TEMP_VOICE_PRESENCE: 'true' });
  assert.equal(presenceOnly.requestPresenceIntent, false);
  assert.match(presenceIntentReport(presenceOnly), /NOT requested/);

  const on = resolveTempVoiceConfig(enabledEnv());
  assert.equal(on.enabled, true);
  assert.equal(on.requestPresenceIntent, false);
  assert.equal(on.categoryId, CATEGORY);
  assert.equal(on.graceMs, 45_000);
  assert.match(presenceIntentReport(on), /NOT requested/);
  assert.match(presenceIntentReport(on), /'s Chat/);

  const both = resolveTempVoiceConfig(enabledEnv({ SENTINAL_TEMP_VOICE_PRESENCE: 'true' }));
  assert.equal(both.requestPresenceIntent, true);
  assert.match(presenceIntentReport(both), /IS requested/);
  assert.match(presenceIntentReport(both), /Developer Portal/);
  assert.match(presenceIntentReport(both), /did not request Guild Presences/);

  const invalidLobby = resolveTempVoiceConfig(enabledEnv({ SENTINAL_TEMP_VOICE_LOBBY_ID: 'nope' }));
  assert.equal(invalidLobby.lobbySource, 'invalid');
  const invalidCategory = resolveTempVoiceConfig(enabledEnv({ SENTINAL_TEMP_VOICE_CATEGORY_ID: 'lobby' }));
  assert.equal(invalidCategory.categorySource, 'invalid');
  assert.equal(resolveTempVoiceConfig(enabledEnv({ SENTINAL_TEMP_VOICE_EMPTY_GRACE_MS: '1000' })).graceMs, 30_000);
  assert.equal(resolveTempVoiceConfig(enabledEnv({ SENTINAL_TEMP_VOICE_EMPTY_GRACE_MS: '90000' })).graceMs, 60_000);

  const without = withTempVoiceIntents({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] }, {});
  assert.equal(without.intents.has(GatewayIntentBits.Guilds), true);
  assert.equal(without.intents.has(GatewayIntentBits.GuildVoiceStates), true);
  assert.equal(without.intents.has(GatewayIntentBits.GuildPresences), false);
  const withPresence = withTempVoiceIntents(
    { intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] },
    enabledEnv({ SENTINAL_TEMP_VOICE_PRESENCE: 'true' })
  );
  assert.equal(withPresence.intents.has(GatewayIntentBits.GuildPresences), true);
  assert.equal(withPresence.intents.has(GatewayIntentBits.GuildVoiceStates), true);

  assert.match(read('src/sentinel/bot.cjs'), /Guild Presences is not requested here/);
  assert.doesNotMatch(read('src/sentinel/bot.cjs'), /clientIntents\.push\(GatewayIntentBits\.GuildPresences\)/);
  assert.doesNotMatch(read('src/sentinel/community-intents-extension.cjs'), /GuildPresences/);
  assert.doesNotMatch(read('src/sentinel/guild-members-intent-extension.cjs'), /GuildPresences/);
  assert.match(read('src/sentinel/temp-voice-extension.cjs'), /GatewayIntentBits\.GuildPresences/);
  assert.match(read('src/sentinel/entry.cjs'), /installTempVoiceExtension\(\)/);
  assert.equal(DEFAULT_VOICE_CATEGORY_ID, CATEGORY);
});

test('room names follow presence, stay family-friendly, and fit Discord’s 100 character limit', () => {
  assert.equal(buildRoomName('Ava', ''), "Ava's Chat");
  assert.equal(buildRoomName('Ava', 'Warframe'), "Ava's Warframe");
  assert.equal(buildRoomName('shit', 'Warframe'), "Player's Warframe");
  assert.equal(buildRoomName('Ava', 'fuck'), "Ava's Chat");
  assert.equal(buildRoomName(` ${'A'.repeat(90)} `, 'B'.repeat(80)).length <= 100, true);
  assert.equal(playingGameName({ presence: null }), '');
  assert.equal(playingGameName({ get presence() { throw new Error('intent missing'); } }), '');
  assert.equal(playingGameName({
    presence: { activities: [{ type: ActivityType.Playing, name: 'Deep Rock Galactic' }, { type: ActivityType.Watching, name: 'a stream' }] }
  }), 'Deep Rock Galactic');
  assert.equal(playingGameName({
    presence: { activities: [{ type: ActivityType.Watching, name: 'a stream' }] }
  }), '');
});

test('/vc exposes rename, limit, lock, unlock, and claim', () => {
  const json = vcCommand().toJSON();
  assert.equal(json.name, 'vc');
  assert.equal(json.dm_permission, false);
  const names = json.options.map((option) => option.name);
  assert.deepEqual(names, ['rename', 'limit', 'lock', 'unlock', 'claim']);
  const rename = json.options.find((option) => option.name === 'rename');
  const limit = json.options.find((option) => option.name === 'limit');
  assert.equal(rename.options[0].name, 'name');
  assert.equal(limit.options[0].name, 'n');
  for (const option of json.options) assert.ok(option.description.length > 0 && option.description.length <= 100);
});

test('joining the lobby creates a managed room in the same category and reuses it', async () => {
  const env = enabledEnv();
  const { controller } = controllerFor(env);
  const category = voiceChannel({ id: CATEGORY, name: '🔊 VOICE', type: ChannelType.GuildCategory });
  const lobby = voiceChannel({ id: 'lobby', name: LOBBY_NAME, parentId: CATEGORY, voiceStatus: LOBBY_STATUS });
  const { guild, map } = guildWith([category, lobby]);
  controller.lobbyId = 'lobby';
  const moved = [];
  const member = {
    id: 'user-1',
    displayName: 'Ava',
    user: { id: 'user-1', bot: false, username: 'ava' },
    presence: { activities: [{ type: ActivityType.Playing, name: 'Warframe' }] },
    voice: { setChannel: async (channel) => { moved.push(channel.id); } }
  };
  const created = await controller.handleVoiceState(
    { channelId: null, guild },
    { channelId: 'lobby', guild, member, channel: lobby }
  );
  assert.equal(created.action, 'created');
  assert.equal(created.name, "Ava's Warframe");
  const room = map.get(created.channelId);
  assert.equal(room.parentId, CATEGORY);
  assert.equal(room.voiceStatus, ROOM_STATUS);
  const owner = room.createOptions.permissionOverwrites.find((entry) => entry.id === 'user-1');
  const everyone = room.createOptions.permissionOverwrites.find((entry) => entry.id === GUILD);
  for (const bit of [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.MuteMembers, PermissionFlagsBits.DeafenMembers]) {
    assert.ok(owner.allow.includes(bit));
  }
  assert.ok(OWNER_ALLOW.includes(PermissionFlagsBits.ManageChannels));
  assert.ok(everyone.allow.includes(PermissionFlagsBits.ViewChannel));
  assert.ok(everyone.allow.includes(PermissionFlagsBits.Connect));
  assert.deepEqual(moved, [created.channelId]);
  assert.equal(typeof room.lockPermissions, 'function');

  moved.length = 0;
  const again = await controller.handleVoiceState(
    { channelId: null, guild },
    { channelId: 'lobby', guild, member, channel: lobby }
  );
  assert.equal(again.action, 'moved');
  assert.equal(again.channelId, created.channelId);
  assert.equal([...map.values()].filter((item) => item.createOptions).length, 1);
});

test('a missing or throwing presence falls back to Chat and a disabled feature creates nothing', async () => {
  const { controller } = controllerFor(enabledEnv());
  const category = voiceChannel({ id: CATEGORY, name: 'VOICE', type: ChannelType.GuildCategory });
  const lobby = voiceChannel({ id: 'lobby', name: LOBBY_NAME, parentId: CATEGORY });
  const { guild } = guildWith([category, lobby]);
  controller.lobbyId = 'lobby';
  const member = {
    id: 'user-2',
    displayName: 'Bea',
    user: { bot: false },
    get presence() { throw new Error('GuildPresences unavailable'); },
    voice: { setChannel: async () => {} }
  };
  const created = await controller.handleVoiceState(
    { channelId: null, guild },
    { channelId: 'lobby', guild, member, channel: lobby }
  );
  assert.equal(created.action, 'created');
  assert.equal(created.name, "Bea's Chat");

  let createdCount = 0;
  const off = new TempVoiceController({
    env: { NEXUS_DISCORD_GUILD_ID: GUILD },
    dir: tempDir(),
    schedule: () => ({ unref() {} })
  });
  const quiet = guildWith([category, lobby], { create: async () => { createdCount += 1; throw new Error('must not create'); } });
  const ignored = await off.handleVoiceState(
    { channelId: null, guild: quiet.guild },
    { channelId: 'lobby', guild: quiet.guild, member, channel: lobby }
  );
  assert.equal(ignored.reason, 'disabled');
  assert.equal(createdCount, 0);
});

test('the lobby setup is idempotent, open to everyone, and refuses protected targets', async () => {
  const { controller } = controllerFor(enabledEnv({ SENTINAL_TEMP_VOICE_CATEGORY_ID: '' }));
  const category = voiceChannel({ id: CATEGORY, name: '🔊 VOICE', type: ChannelType.GuildCategory });
  const { guild, map } = guildWith([category]);
  const first = await controller.ensureLobby(guild);
  assert.equal(first.action, 'created');
  const created = map.get(first.channelId);
  assert.equal(created.name, LOBBY_NAME);
  assert.equal(created.parentId, CATEGORY);
  assert.equal(created.voiceStatus, LOBBY_STATUS);
  const everyone = created.createOptions.permissionOverwrites[0];
  assert.equal(everyone.id, GUILD);
  assert.ok(everyone.allow.includes(PermissionFlagsBits.ViewChannel));
  assert.ok(everyone.allow.includes(PermissionFlagsBits.Connect));
  const second = await controller.ensureLobby(guild);
  assert.equal(second.action, 'adopted');
  assert.equal(second.channelId, first.channelId);
  assert.equal([...map.values()].filter((item) => item.createOptions).length, 1);

  const lounge = voiceChannel({
    id: '1569266940508110999',
    name: 'Nexus Lounge',
    parentId: CATEGORY,
    setName: async () => { throw new Error('must not rename lounge'); },
    permissionOverwrites: { edit: async () => { throw new Error('must not edit lounge'); } }
  });
  const protectedController = new TempVoiceController({
    env: enabledEnv({ SENTINAL_TEMP_VOICE_LOBBY_ID: '1569266940508110999' }),
    dir: tempDir(),
    schedule: () => ({ unref() {} })
  });
  const protectedGuild = guildWith([category, lounge], { create: async () => { throw new Error('must not create'); } });
  const refused = await protectedController.ensureLobby(protectedGuild.guild);
  assert.equal(refused.reason, 'protected');

  const staff = voiceChannel({ id: '1569266940508110888', name: '🔒 STAFF', type: ChannelType.GuildCategory });
  const staffController = new TempVoiceController({
    env: enabledEnv({ SENTINAL_TEMP_VOICE_CATEGORY_ID: '1569266940508110888' }),
    dir: tempDir(),
    schedule: () => ({ unref() {} })
  });
  const staffGuild = guildWith([staff], { create: async () => { throw new Error('must not create in staff'); } });
  const staffResult = await staffController.ensureLobby(staffGuild.guild);
  assert.equal(staffResult.reason, 'staff');

  const invalid = new TempVoiceController({
    env: enabledEnv({ SENTINAL_TEMP_VOICE_LOBBY_ID: 'not-a-snowflake' }),
    dir: tempDir(),
    schedule: () => ({ unref() {} })
  });
  const invalidGuild = guildWith([category], { create: async () => { throw new Error('must not create'); } });
  assert.equal((await invalid.ensureLobby(invalidGuild.guild)).reason, 'invalid');
});

test('empty temporary rooms delete after the grace and protected or foreign channels never do', async () => {
  const env = enabledEnv();
  const { controller, runQueued } = controllerFor(env, { graceMs: 45_000 });
  const category = voiceChannel({ id: CATEGORY, name: 'VOICE', type: ChannelType.GuildCategory });
  const room = voiceChannel({ id: 'room', name: "Ava's Chat", parentId: CATEGORY, voiceStatus: ROOM_STATUS, members: members([]) });
  const occupied = voiceChannel({ id: 'busy', name: "Bea's Chat", parentId: CATEGORY, voiceStatus: ROOM_STATUS, members: members(['user-9']) });
  const lounge = voiceChannel({ id: 'lounge', name: 'Nexus Lounge', parentId: CATEGORY, members: members([]) });
  const eventNight = voiceChannel({ id: 'event', name: 'event-night', parentId: CATEGORY, members: members([]) });
  const afk = voiceChannel({ id: 'afk', name: "Someone's Chat", parentId: CATEGORY, members: members([]) });
  const staffRoom = voiceChannel({
    id: 'staff-room',
    name: "Staff Meeting Room",
    parentId: 'staff-cat',
    members: members([])
  });
  const gameRoom = voiceChannel({
    id: 'game-room',
    name: '➕ Join to Create Warframe Squad',
    parentId: CATEGORY,
    members: members([])
  });
  const preservedId = [...PRESERVED_CHANNEL_IDS][0];
  const preserved = voiceChannel({ id: preservedId, name: "Old Lobby", parentId: CATEGORY, members: members([]) });
  const unknown = voiceChannel({ id: 'unknown', name: "Not ours", parentId: CATEGORY, members: members([]) });
  const lobby = voiceChannel({ id: 'lobby', name: LOBBY_NAME, parentId: CATEGORY });
  const { guild } = guildWith([category, room, occupied, lounge, eventNight, afk, staffRoom, gameRoom, preserved, unknown, lobby]);
  controller.lobbyId = 'lobby';
  const row = { ownerId: 'user-1', guildId: GUILD, categoryId: CATEGORY };
  for (const channel of [room, occupied, lounge, eventNight, afk, staffRoom, gameRoom, preserved]) {
    controller.store.upsert({ ...row, channelId: channel.id });
  }
  controller.store.upsert({ ...row, channelId: 'lobby' });
  controller.lobbyId = 'lobby';

  const left = await controller.handleVoiceState(
    { channelId: 'room', guild, channel: room },
    { channelId: null, guild, member: null }
  );
  assert.equal(left.action, 'scheduled');
  assert.equal(room.deleted, undefined);
  await runQueued();
  assert.equal(room.deleted, true);
  assert.equal(controller.store.get('room'), null);

  const stillThere = await controller.deleteIfEmpty(guild, 'busy');
  assert.equal(stillThere.reason, 'occupied');
  assert.equal(occupied.deleted, undefined);

  for (const id of ['lounge', 'event', 'afk', 'staff-room', 'game-room', preservedId]) {
    const result = await controller.deleteIfEmpty(guild, id);
    assert.equal(result.reason, 'protected', id);
    assert.equal(guild.channels.fetch && (await guild.channels.fetch(id)).deleted, undefined, id);
  }
  const foreign = await controller.deleteIfEmpty(guild, 'unknown');
  assert.equal(foreign.reason, 'untracked');
  assert.equal(unknown.deleted, undefined);

  const names = Object.values(LAYOUTS).map((layout) => layout.lobbyBuilder);
  assert.ok(names.length >= 8);
  for (const name of names) {
    const channel = voiceChannel({ id: `layout-${name.length}`, name, parentId: CATEGORY, members: members([]) });
    controller.store.upsert({ ...row, channelId: channel.id });
    const hosted = guildWith([category, channel]);
    const result = await controller.deleteIfEmpty(hosted.guild, channel.id);
    assert.equal(result.reason, 'protected', name);
    assert.equal(channel.deleted, undefined);
  }
});

test('presence renames a solo owner once, and /vc is limited to the owner or staff', async () => {
  const env = enabledEnv({ SENTINAL_TEMP_VOICE_PRESENCE: 'true' });
  const now = 1_700_000_000_000;
  const { controller } = controllerFor(env, { now: () => now });
  assert.equal(controller.config.requestPresenceIntent, true);
  const room = voiceChannel({
    id: 'room',
    name: "Ava's Chat",
    parentId: CATEGORY,
    voiceStatus: ROOM_STATUS,
    members: members(['user-1'])
  });
  let renames = 0;
  room.setName = async (name) => { renames += 1; room.name = name; };
  const { guild } = guildWith([room]);
  controller.store.upsert({
    channelId: 'room',
    ownerId: 'user-1',
    guildId: GUILD,
    categoryId: CATEGORY,
    game: ''
  });
  const member = {
    id: 'user-1',
    displayName: 'Ava',
    voice: { channelId: 'room' },
    presence: { activities: [{ type: ActivityType.Playing, name: 'Helldivers 2' }] }
  };
  const renamed = await controller.handlePresence(null, { guild, userId: 'user-1', member });
  assert.equal(renamed.action, 'renamed');
  assert.equal(room.name, "Ava's Helldivers 2");
  member.presence = { activities: [{ type: ActivityType.Playing, name: 'Warframe' }] };
  const once = await controller.handlePresence(null, { guild, userId: 'user-1', member });
  assert.equal(once.reason, 'once');
  assert.equal(renames, 1);

  const crowded = voiceChannel({
    id: 'crowded',
    name: "Bea's Chat",
    parentId: CATEGORY,
    members: members(['user-2', 'user-3']),
    setName: async () => { throw new Error('must not rename a group'); }
  });
  const crowdedGuild = guildWith([crowded]);
  const crowdedController = new TempVoiceController({
    env,
    dir: tempDir(),
    now: () => now,
    schedule: () => ({ unref() {} })
  });
  crowdedController.store.upsert({ channelId: 'crowded', ownerId: 'user-2', guildId: GUILD, categoryId: CATEGORY, game: '' });
  const skipped = await crowdedController.handlePresence(null, {
    guild: crowdedGuild.guild,
    userId: 'user-2',
    member: { id: 'user-2', displayName: 'Bea', voice: { channelId: 'crowded' }, presence: { activities: [{ type: ActivityType.Playing, name: 'Minecraft' }] } }
  });
  assert.equal(skipped.reason, 'not-alone');

  const limited = voiceChannel({
    id: 'limited',
    name: "Cy's Chat",
    parentId: CATEGORY,
    members: members(['user-4']),
    setName: async () => { throw new Error('must not rename while rate limited'); }
  });
  const limitedGuild = guildWith([limited]);
  const limitedController = new TempVoiceController({
    env,
    dir: tempDir(),
    now: () => now,
    schedule: () => ({ unref() {} })
  });
  limitedController.store.upsert({
    channelId: 'limited',
    ownerId: 'user-4',
    guildId: GUILD,
    categoryId: CATEGORY,
    game: '',
    renames: [now - 1_000, now - 2_000]
  });
  const blocked = await limitedController.handlePresence(null, {
    guild: limitedGuild.guild,
    userId: 'user-4',
    member: { id: 'user-4', displayName: 'Cy', voice: { channelId: 'limited' }, presence: { activities: [{ type: ActivityType.Playing, name: 'Valheim' }] } }
  });
  assert.equal(blocked.reason, 'rate-limit');

  function commandGuild(channel) {
    return {
      id: GUILD,
      ownerId: 'guild-owner',
      afkChannelId: 'afk',
      channels: { fetch: async (id) => (id === channel.id ? channel : null) }
    };
  }
  function command(userId, sub, { staff = false, name, n, channel = room } = {}) {
    return {
      commandName: 'vc',
      user: { id: userId },
      member: { voice: { channelId: channel.id } },
      memberPermissions: { has: () => staff },
      guild: commandGuild(channel),
      options: {
        getSubcommand: () => sub,
        getString: () => name,
        getInteger: () => n
      }
    };
  }

  controller.store.upsert({
    channelId: 'room',
    ownerId: 'user-1',
    guildId: GUILD,
    categoryId: CATEGORY,
    game: 'Helldivers 2',
    autoRenameUsed: true,
    renames: [now]
  });
  room.members = members(['user-1', 'user-8']);
  const denied = await controller.handleCommand(command('user-8', 'rename', { name: 'Squad' }));
  assert.match(denied.content, /owner or staff/);
  const reserved = await controller.handleCommand(command('user-1', 'rename', { name: 'AFK' }));
  assert.match(reserved.content, /reserved/);
  const rude = await controller.handleCommand(command('user-1', 'rename', { name: 'shit' }));
  assert.match(rude.content, /not allowed/);
  const renamedByOwner = await controller.handleCommand(command('user-1', 'rename', { name: 'Ava Squad' }));
  assert.match(renamedByOwner.content, /Ava Squad/);
  assert.equal(room.name, 'Ava Squad');
  const byStaff = await controller.handleCommand(command('mod-1', 'limit', { staff: true, n: 4 }));
  assert.match(byStaff.content, /4/);
  assert.equal(room.userLimit, 4);
  const badLimit = await controller.handleCommand(command('user-1', 'limit', { n: 100 }));
  assert.match(badLimit.content, /0 to 99/);

  const edits = [];
  room.permissionOverwrites.edit = async (id, options) => { edits.push({ id, options }); };
  const locked = await controller.handleCommand(command('user-1', 'lock'));
  assert.match(locked.content, /Locked/);
  assert.equal(edits.some((edit) => edit.id === GUILD && edit.options.Connect === false), true);
  const unlocked = await controller.handleCommand(command('user-1', 'unlock'));
  assert.match(unlocked.content, /Unlocked/);
  assert.equal(edits.some((edit) => edit.id === GUILD && edit.options.Connect === null), true);

  const ownerHere = await controller.handleCommand(command('user-8', 'claim'));
  assert.match(ownerHere.content, /still here/);
  room.members = members(['user-8']);
  const claimed = await controller.handleCommand(command('user-8', 'claim'));
  assert.match(claimed.content, /own this room/);
  assert.equal(controller.store.get('room').ownerId, 'user-8');
  const outsider = await controller.handleCommand(command('user-1', 'rename', { name: 'Nope' }));
  assert.match(outsider.content, /owner or staff/);
});

test('layout repair does not adopt, lock, or delete the lobby or temporary rooms', async () => {
  const tempAfk = voiceChannel({
    id: 'temp-afk',
    name: 'AFK',
    parentId: 'voice',
    voiceStatus: ROOM_STATUS
  });
  const hq = voiceChannel({ id: 'hq', name: '🌐 NEXUS HQ', type: ChannelType.GuildCategory });
  const map = new Map([[tempAfk.id, tempAfk], [hq.id, hq]]);
  const created = [];
  const adopted = await ensureChannel({
    channels: {
      create: async (options) => {
        const channel = voiceChannel({ id: 'real-afk', name: options.name, parentId: options.parent });
        created.push(channel);
        return channel;
      }
    }
  }, hq, {
    key: 'afk',
    name: 'AFK',
    type: ChannelType.GuildVoice,
    aliases: ['afk']
  }, map);
  assert.equal(adopted.channel.id, 'real-afk');
  assert.equal(tempAfk.name, 'AFK');
  assert.equal(created.length, 1);

  const lobby = voiceChannel({ id: 'lobby', name: LOBBY_NAME, parentId: CATEGORY });
  assert.equal(isSentinalTempVoiceChannel(lobby), true);
  assert.equal(isSentinalTempVoiceChannel(voiceChannel({ id: 'plain', name: 'Nexus Lounge', parentId: CATEGORY })), false);

  let locked = 0;
  const marked = voiceChannel({
    id: 'marked',
    name: "Ava's Chat",
    parentId: 'hq',
    voiceStatus: ROOM_STATUS,
    permissionOverwrites: { cache: { values() { return []; } } },
    lockPermissions: async () => { locked += 1; }
  });
  const lockResult = await lockHqChildren({ id: 'hq' }, new Map([[marked.id, marked]]), [
    { id: GUILD, type: 0, allow: [PermissionFlagsBits.ViewChannel], deny: [] }
  ]);
  assert.equal(lockResult.locked, 0);
  assert.equal(locked, 0);

  let edited = false;
  const category = { id: 'cat', name: 'Warframe', type: ChannelType.GuildCategory };
  const room = voiceChannel({
    id: 'policy-room',
    name: "Ava's Chat",
    parentId: 'cat',
    voiceStatus: ROOM_STATUS,
    permissionOverwrites: {
      cache: new Map(),
      edit: async () => { edited = true; }
    }
  });
  const policy = await reconcileModuleAccessPolicy({
    id: GUILD,
    roles: { fetch: async () => new Map([['role-1', { id: 'role-1', name: 'Warframe' }]]) },
    channels: { fetch: async () => { throw new Error('must not fetch'); } }
  }, 'warframe', category, {
    channelsSnapshot: new Map([[category.id, category], [room.id, room]]),
    state: {
      getAccessRole: () => ({ roleId: 'role-1' }),
      getAdminSettings: () => ({}),
      listAccessRoles: () => ({})
    },
    config: {}
  });
  assert.equal(policy.channels.find((item) => item.channelId === 'policy-room').reason, 'temp-voice');
  assert.equal(edited, false);

  const stateRoom = voiceChannel({ id: 'state-room', name: "Ava's Chat", voiceStatus: ROOM_STATUS, members: members([]) });
  const oldRoom = voiceChannel({ id: 'old-room', name: "🎮 Bea's Lobby", members: members([]) });
  const state = {
    lobbies: {
      'state-room': { guildId: GUILD, channelId: 'state-room' },
      'old-room': { guildId: GUILD, channelId: 'old-room' }
    },
    getTempLobby(id) { return this.lobbies[id] || null; },
    removeTempLobby(id) { delete this.lobbies[id]; },
    listTempLobbies() { return { ...this.lobbies }; }
  };
  const provisioner = new ModuleProvisioner({ state, config: {} });
  const client = {
    guilds: {
      fetch: async () => ({
        channels: {
          fetch: async (id) => (id === 'state-room' ? stateRoom : oldRoom)
        }
      })
    }
  };
  await provisioner.cleanupOrphanedLobbies(client);
  assert.equal(stateRoom.deleted, undefined);
  assert.equal(oldRoom.deleted, true);
  assert.equal(state.lobbies['state-room'], undefined);

  const managed = voiceChannel({
    id: 'managed-name',
    name: '➕ Join to Create Warframe Squad',
    type: ChannelType.GuildVoice,
    parentId: '',
    voiceStatus: ROOM_STATUS
  });
  const managedMap = new Map([[managed.id, managed]]);
  managedMap.find = (predicate) => [...managedMap.values()].find(predicate);
  const managedGuild = {
    id: GUILD,
    channels: {
      fetch: async () => managedMap,
      create: async (options) => voiceChannel({ id: 'fresh', name: options.name, parentId: options.parent })
    }
  };
  const resolved = await resolveManagedChannel(
    managedGuild,
    { id: 'game-cat' },
    '➕ Join to Create Warframe Squad',
    ChannelType.GuildVoice
  );
  assert.equal(resolved.created, true);
  assert.equal(resolved.channel.id, 'fresh');
});
