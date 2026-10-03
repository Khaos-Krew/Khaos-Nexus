'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { ChannelType, Events, OverwriteType, PermissionFlagsBits } = require('discord.js');
const { ensureVanguardChannels, installVanguard } = require('../../src/game-bots/vanguard/entry.cjs');
const { MEMBER_ROLE_WARNING, channelAccessOverwrites, provisionChannels, runSetup } = require('../../src/game-bots/vanguard/commands/setup.cjs');

const CATEGORY = '1516640233389822042';
const OUTSIDE = '1516602943670059108';
const GUILD = '1516640233389822001';
const IDS = [
  '1516640233389822101',
  '1516640233389822102',
  '1516640233389822103',
  '1516640233389822104',
  '1516640233389822105'
];

function makeGuild(channels, created) {
  return {
    id: GUILD,
    channels: {
      fetch: async () => ({ values: () => channels.values() }),
      create: async (options) => {
        const channel = {
          id: IDS[created.length],
          name: options.name,
          parentId: options.parent,
          type: options.type
        };
        created.push({ ...options });
        channels.push(channel);
        return channel;
      }
    }
  };
}

test('startup creates only missing channels inside the gate and enables join-to-create', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanguard-provision-'));
  const env = {
    VANGUARD_DATA_DIR: dir,
    NEXUS_DATA_DIR: dir,
    VANGUARD_DISCORD_CATEGORY_ID: CATEGORY,
    VANGUARD_GUILD_ID: GUILD,
    VANGUARD_JTC_CATEGORY_ID: OUTSIDE
  };
  const channels = [
    { id: '1516640233389822999', name: 'lfg', parentId: OUTSIDE, type: ChannelType.GuildText },
    { id: '1516640233389822888', name: 'panels', parentId: CATEGORY, type: ChannelType.GuildText }
  ];
  const created = [];
  const guild = makeGuild(channels, created);
  const client = new EventEmitter();
  client.guilds = { fetch: async (id) => {
    assert.equal(id, GUILD);
    return guild;
  } };
  const entry = fs.readFileSync(path.join(__dirname, '../../src/game-bots/vanguard/entry.cjs'), 'utf8');
  assert.match(entry, /await ensureVanguardChannels\(ctx\)/);
  try {
    const ctx = installVanguard(client, { env });
    assert.equal(client.listeners(Events.VoiceStateUpdate).length, 1);
    assert.equal(ctx.jtc.config.configured, false);

    const first = await ensureVanguardChannels(ctx);
    assert.equal(first.ok, true);
    assert.deepEqual(created.map((item) => item.name), ['lfg', 'fireteam-finder', 'staff-alerts', 'lobby']);
    assert.ok(created.every((item) => item.parent === CATEGORY));
    assert.ok(created.every((item) => item.parent !== OUTSIDE));
    assert.ok(first.reused.includes('panels'));
    assert.equal(ctx.jtc.config.configured, true);
    assert.equal(ctx.jtc.config.lobbyId, IDS[3]);
    assert.equal(ctx.jtc.config.categoryId, CATEGORY);
    assert.equal(client.listeners(Events.VoiceStateUpdate).length, 1);
    const stored = ctx.channelStore.read()[GUILD];
    assert.equal(stored.lfg, IDS[0]);
    assert.equal(stored.panels, '1516640233389822888');
    assert.equal(stored.jtcLobby, IDS[3]);

    const second = await ensureVanguardChannels(ctx);
    assert.equal(second.ok, true);
    assert.deepEqual(second.created, []);
    assert.equal(created.length, 4);
    assert.ok(second.reused.includes('lfg'));
    assert.ok(second.pinned.includes('lobby'));
    assert.equal(ctx.jtc.config.lobbyId, IDS[3]);
    assert.equal(ctx.jtc.config.categoryId, CATEGORY);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('staff-alerts are private and panels are read-only, including channels that already exist', async () => {
  const STAFF_ROLE = '1516640233389822777';
  const BOT = '111111111111111111';
  const PANELS = '1516640233389822888';
  const edits = [];
  function track(channel) {
    channel.permissionOverwrites = {
      edit: async (id, perms, extra) => {
        edits.push({ channel: channel.name, id, perms, type: extra?.type });
      }
    };
    return channel;
  }
  const panels = track({ id: PANELS, name: 'panels', parentId: CATEGORY, type: ChannelType.GuildText });
  const channels = [panels];
  const created = [];
  const guild = {
    id: GUILD,
    roles: { everyone: { id: GUILD } },
    members: { me: { id: BOT } },
    channels: {
      fetch: async () => ({ values: () => channels.values() }),
      create: async (options) => {
        const channel = track({
          id: IDS[created.length],
          name: options.name,
          parentId: options.parent,
          type: options.type,
          createdOverwrites: options.permissionOverwrites || null
        });
        created.push(channel);
        channels.push(channel);
        return channel;
      }
    }
  };
  const env = { VANGUARD_STAFF_ROLE_IDS: STAFF_ROLE };
  const first = await provisionChannels({
    guild,
    env,
    categoryId: CATEGORY,
    saved: {},
    botId: BOT
  });
  assert.equal(first.ok, true);
  assert.ok(first.reused.includes('panels'));
  assert.ok(first.created.includes('staff-alerts'));
  const staff = created.find((channel) => channel.name === 'staff-alerts');
  const staffCreate = staff.createdOverwrites;
  assert.ok(staffCreate.some((row) => row.id === GUILD && row.deny.includes(PermissionFlagsBits.ViewChannel)));
  assert.ok(staffCreate.some((row) => row.id === BOT && row.allow.includes(PermissionFlagsBits.SendMessages)));
  assert.ok(staffCreate.some((row) => row.id === STAFF_ROLE && row.type === OverwriteType.Role && row.allow.includes(PermissionFlagsBits.ViewChannel)));
  assert.equal(created.find((channel) => channel.name === 'panels'), undefined);
  assert.equal(created.find((channel) => channel.name === 'lfg').createdOverwrites, null);
  const panelEdit = edits.find((row) => row.channel === 'panels' && row.id === GUILD);
  assert.equal(panelEdit.perms.SendMessages, false);
  assert.equal(panelEdit.perms.ViewChannel, true);
  assert.match(first.warnings.join('\n'), /Destiny 2 role was not found/);
  const staffEveryone = edits.find((row) => row.channel === 'staff-alerts' && row.id === GUILD);
  assert.equal(staffEveryone.perms.ViewChannel, false);
  const staffRole = edits.find((row) => row.channel === 'staff-alerts' && row.id === STAFF_ROLE);
  assert.equal(staffRole.perms.ViewChannel, true);
  const before = edits.length;
  const second = await provisionChannels({
    guild,
    env,
    categoryId: CATEGORY,
    saved: first.resolved,
    botId: BOT
  });
  assert.equal(second.ok, true);
  assert.equal(second.created.length, 0);
  assert.ok(edits.length > before);
  const again = edits.filter((row) => row.channel === 'staff-alerts' && row.id === GUILD);
  assert.ok(again.length >= 2);
  assert.ok(again.every((row) => row.perms.ViewChannel === false));
  const pinnedEdits = edits.length;
  const pinned = await provisionChannels({
    guild,
    env: { ...env, VANGUARD_STAFF_ALERT_CHANNEL_ID: first.resolved.staffAlerts },
    categoryId: CATEGORY,
    saved: first.resolved,
    botId: BOT
  });
  assert.ok(pinned.pinned.includes('staff-alerts'));
  assert.ok(edits.length > pinnedEdits);
});

test('panels lock to Destiny 2 when that role exists and stay visible when it does not', async () => {
  const STAFF_ROLE = '1516640233389822777';
  const BOT = '111111111111111111';
  const MEMBER = '1516640233389822666';
  const ENV_ROLE = '1516640233389822555';
  const locked = channelAccessOverwrites('panels', {
    everyoneId: GUILD,
    botId: BOT,
    staffRoleIds: [STAFF_ROLE],
    memberRoleId: MEMBER
  });
  const everyone = locked.find((row) => row.id === GUILD);
  assert.deepEqual(everyone.deny, ['ViewChannel', 'SendMessages']);
  assert.deepEqual(everyone.clear, ['ReadMessageHistory']);
  assert.equal(everyone.allow, undefined);
  const member = locked.find((row) => row.id === MEMBER);
  assert.deepEqual(member.allow, ['ViewChannel', 'ReadMessageHistory']);
  assert.deepEqual(member.deny, ['SendMessages', 'AddReactions', 'CreatePublicThreads']);
  const staff = locked.find((row) => row.id === STAFF_ROLE);
  assert.deepEqual(staff.allow, ['ViewChannel', 'ReadMessageHistory']);
  const bot = locked.find((row) => row.id === BOT);
  assert.ok(bot.allow.includes('AttachFiles'));
  assert.ok(bot.allow.includes('ViewChannel'));
  const open = channelAccessOverwrites('panels', { everyoneId: GUILD, botId: BOT, staffRoleIds: [STAFF_ROLE] });
  assert.equal(open.find((row) => row.id === GUILD).deny.includes('ViewChannel'), false);
  assert.equal(open.find((row) => row.id === GUILD).allow.includes('ViewChannel'), true);

  const edits = [];
  const alerts = [];
  function track(channel) {
    channel.permissionOverwrites = {
      edit: async (id, perms) => { edits.push({ channel: channel.name, id, perms }); }
    };
    return channel;
  }
  const panels = track({ id: '1516640233389822888', name: 'panels', parentId: CATEGORY, type: ChannelType.GuildText });
  const guild = {
    id: GUILD,
    roles: {
      everyone: { id: GUILD },
      cache: new Map([
        [MEMBER, { id: MEMBER, name: 'DESTINY 2' }],
        ['1516640233389822444', { id: '1516640233389822444', name: 'Destiny 2 Veterans' }]
      ])
    },
    channels: {
      fetch: async () => ({ values: () => [panels].values() }),
      create: async (options) => track({
        id: IDS[0],
        name: options.name,
        parentId: options.parent,
        type: options.type,
        createdOverwrites: options.permissionOverwrites || null
      })
    }
  };
  const named = await provisionChannels({
    guild,
    env: { VANGUARD_STAFF_ROLE_IDS: STAFF_ROLE },
    categoryId: CATEGORY,
    saved: {
      lfg: '1516640233389822101',
      fireteamFinder: '1516640233389822102',
      panels: panels.id,
      staffAlerts: '1516640233389822103',
      jtcLobby: '1516640233389822104'
    },
    botId: BOT,
    alert: async (text) => { alerts.push(text); }
  });
  assert.equal(named.warnings.length, 0);
  assert.equal(alerts.length, 0);
  const deny = edits.find((row) => row.channel === 'panels' && row.id === GUILD);
  assert.equal(deny.perms.ViewChannel, false);
  assert.equal(deny.perms.SendMessages, false);
  assert.equal(deny.perms.ReadMessageHistory, null);
  const memberEdit = edits.find((row) => row.channel === 'panels' && row.id === MEMBER);
  assert.equal(memberEdit.perms.ViewChannel, true);
  assert.equal(memberEdit.perms.ReadMessageHistory, true);
  assert.equal(memberEdit.perms.SendMessages, false);
  assert.equal(memberEdit.perms.AddReactions, false);
  assert.equal(memberEdit.perms.CreatePublicThreads, false);
  const staffEdit = edits.find((row) => row.channel === 'panels' && row.id === STAFF_ROLE);
  assert.equal(staffEdit.perms.ViewChannel, true);
  assert.equal(staffEdit.perms.ReadMessageHistory, true);
  const botEdit = edits.find((row) => row.channel === 'panels' && row.id === BOT);
  assert.equal(botEdit.perms.AttachFiles, true);
  assert.equal(botEdit.perms.SendMessages, true);

  edits.length = 0;
  const fromEnv = await provisionChannels({
    guild,
    env: { VANGUARD_STAFF_ROLE_IDS: STAFF_ROLE, VANGUARD_MEMBER_ROLE_ID: ENV_ROLE },
    categoryId: CATEGORY,
    saved: named.resolved,
    botId: BOT
  });
  assert.equal(fromEnv.warnings.length, 0);
  assert.equal(edits.some((row) => row.channel === 'panels' && row.id === ENV_ROLE && row.perms.ViewChannel === true), true);
  assert.equal(edits.some((row) => row.channel === 'panels' && row.id === MEMBER), false);

  const missingAlerts = [];
  const missing = await provisionChannels({
    guild: { ...guild, roles: { everyone: { id: GUILD }, cache: new Map() } },
    env: { VANGUARD_STAFF_ROLE_IDS: STAFF_ROLE },
    categoryId: CATEGORY,
    saved: named.resolved,
    botId: BOT,
    alert: async (text) => { missingAlerts.push(text); }
  });
  assert.deepEqual(missing.warnings, [MEMBER_ROLE_WARNING]);
  assert.match(missingAlerts.join('\n'), /Destiny 2 role was not found/);
  const kept = edits.filter((row) => row.channel === 'panels' && row.id === GUILD).at(-1);
  assert.equal(kept.perms.ViewChannel, true);
  assert.equal(kept.perms.SendMessages, false);
});

test('env-pinned channels outside the category are not rewritten', async () => {
  const OUTSIDE_PANELS = '1516640233389822555';
  const INSIDE_STAFF = '1516640233389822666';
  const alerts = [];
  const edits = [];
  function track(channel) {
    channel.permissionOverwrites = {
      edit: async (id) => { edits.push({ channel: channel.id, id }); }
    };
    return channel;
  }
  const panels = track({ id: OUTSIDE_PANELS, name: 'panels', parentId: OUTSIDE, type: ChannelType.GuildText });
  const staff = track({ id: INSIDE_STAFF, name: 'staff-alerts', parentId: CATEGORY, type: ChannelType.GuildText });
  const inside = [
    { id: '1516640233389822101', name: 'lfg', parentId: CATEGORY, type: ChannelType.GuildText },
    { id: '1516640233389822102', name: 'fireteam-finder', parentId: CATEGORY, type: ChannelType.GuildText },
    { id: '1516640233389822105', name: 'lobby', parentId: CATEGORY, type: ChannelType.GuildVoice }
  ];
  const guild = {
    id: GUILD,
    channels: {
      fetch: async () => ({ values: () => [panels, staff, ...inside].values() }),
      create: async () => { throw new Error('should reuse or pin'); }
    }
  };
  const result = await provisionChannels({
    guild,
    env: {
      VANGUARD_PANELS_CHANNEL_ID: OUTSIDE_PANELS,
      VANGUARD_STAFF_ALERT_CHANNEL_ID: INSIDE_STAFF
    },
    categoryId: CATEGORY,
    saved: {},
    botId: '111111111111111111',
    alert: async (text) => { alerts.push(text); }
  });
  assert.equal(result.ok, true);
  assert.ok(result.skipped.includes('panels'));
  assert.ok(result.pinned.includes('staff-alerts'));
  assert.equal(edits.some((row) => row.channel === OUTSIDE_PANELS), false);
  assert.equal(edits.some((row) => row.channel === INSIDE_STAFF), true);
  assert.match(alerts.join('\n'), /not in the Vanguard category/);
});

test('a permission failure on one channel does not stop the rest', async () => {
  const PANELS = '1516640233389822888';
  const panels = {
    id: PANELS,
    name: 'panels',
    parentId: CATEGORY,
    type: ChannelType.GuildText,
    permissionOverwrites: {
      edit: async () => { throw new Error('Missing Permissions'); }
    }
  };
  const created = [];
  const guild = {
    id: GUILD,
    roles: { everyone: { id: GUILD } },
    channels: {
      fetch: async () => ({ values: () => [panels].values() }),
      create: async (options) => {
        const channel = {
          id: IDS[created.length],
          name: options.name,
          parentId: options.parent,
          type: options.type,
          permissionOverwrites: { edit: async () => {} }
        };
        created.push(channel.name);
        return channel;
      }
    }
  };
  const alerts = [];
  const result = await provisionChannels({
    guild,
    env: {},
    categoryId: CATEGORY,
    saved: {},
    botId: '111111111111111111',
    alert: async (text) => { alerts.push(text); }
  });
  assert.equal(result.ok, false);
  assert.ok(result.failed.includes('panels'));
  assert.ok(created.includes('staff-alerts'));
  assert.ok(created.includes('lobby'));
  assert.match(alerts.join('\n'), /Permission update failed on panels/);
  assert.equal(result.resolved.staffAlerts, IDS[created.indexOf('staff-alerts')]);
});

test('startup fail-closes when the category is missing or invalid', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanguard-provision-closed-'));
  try {
    for (const categoryValue of [undefined, 'nope']) {
      const env = {
        VANGUARD_DATA_DIR: dir,
        NEXUS_DATA_DIR: dir,
        VANGUARD_GUILD_ID: GUILD,
        VANGUARD_JTC_CATEGORY_ID: OUTSIDE,
        VANGUARD_JTC_LOBBY_CHANNEL_ID: '1516640233389822777'
      };
      if (categoryValue !== undefined) env.VANGUARD_DISCORD_CATEGORY_ID = categoryValue;
      let fetched = 0;
      const client = new EventEmitter();
      client.guilds = {
        fetch: async () => {
          fetched += 1;
          return { channels: { fetch: async () => { throw new Error('fetched'); }, create: async () => { throw new Error('created'); } } };
        }
      };
      const ctx = installVanguard(client, { env });
      const result = await ensureVanguardChannels(ctx);
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'fail-closed');
      assert.equal(fetched, 0);
      assert.equal(ctx.jtc.config.configured, false);
      assert.equal(ctx.channelStore.read()[GUILD], undefined);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('staff /vanguard setup reruns provisioning and other members do not', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanguard-provision-setup-'));
  const env = {
    VANGUARD_DATA_DIR: dir,
    NEXUS_DATA_DIR: dir,
    VANGUARD_DISCORD_CATEGORY_ID: CATEGORY,
    VANGUARD_GUILD_ID: GUILD
  };
  const channels = [];
  const created = [];
  const guild = makeGuild(channels, created);
  const client = new EventEmitter();
  const replies = [];
  const edits = [];
  const interaction = {
    guildId: GUILD,
    guild,
    user: { id: '42' },
    memberPermissions: { has: () => false },
    reply: async (body) => { replies.push(body); },
    deferReply: async () => { throw new Error('non-staff deferred'); },
    editReply: async () => { throw new Error('non-staff edited'); }
  };
  try {
    const ctx = installVanguard(client, { env });
    await runSetup(interaction, ctx);
    assert.match(replies[0].content, /restricted to Nexus staff/);
    assert.equal(created.length, 0);

    interaction.memberPermissions = { has: (bit) => bit === PermissionFlagsBits.Administrator };
    interaction.reply = async () => { throw new Error('staff replied'); };
    interaction.deferReply = async () => {};
    interaction.editReply = async (body) => { edits.push(body); };
    await runSetup(interaction, ctx);
    assert.deepEqual(created.map((item) => item.name), ['lfg', 'fireteam-finder', 'panels', 'staff-alerts', 'lobby']);
    assert.ok(created.every((item) => item.parent === CATEGORY));
    assert.match(edits[0].content, /Created: lfg, fireteam-finder, panels, staff-alerts, lobby/);
    assert.equal(ctx.jtc.config.configured, true);
    assert.equal(ctx.jtc.config.categoryId, CATEGORY);
    assert.equal(client.listeners(Events.VoiceStateUpdate).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
