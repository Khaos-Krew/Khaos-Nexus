'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { ChannelType, Events, PermissionFlagsBits } = require('discord.js');
const { ensureVanguardChannels, installVanguard } = require('../../src/game-bots/vanguard/entry.cjs');
const { runSetup } = require('../../src/game-bots/vanguard/commands/setup.cjs');

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
