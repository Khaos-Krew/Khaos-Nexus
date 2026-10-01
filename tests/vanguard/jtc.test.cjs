'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Events } = require('discord.js');
const {
  GAME_BOT_JTC_MODULES,
  JoinToCreate,
  OWNER_JTC_LOBBY_IDS,
  channelNameFor,
  installJoinToCreate,
  resolveJtcConfig
} = require('../../src/game-bots/join-to-create.cjs');
const { applyJtcLobby, installVanguardJtc, vanguardJtcConfig } = require('../../src/game-bots/vanguard/jtc.cjs');
const { installVanguard } = require('../../src/game-bots/vanguard/entry.cjs');
const { publishRuntimeChannels } = require('../../src/game-bots/vanguard/commands/setup.cjs');
const { Scheduler } = require('../../src/game-bots/vanguard/scheduler.cjs');

const LOBBY = '1541540961937526916';
const CATEGORY = '1516640233389822042';
const OVERRIDE = '1516602943670059108';
const GUILD = '1516640233389822001';

test('vanguard join-to-create reuses the shared module and has no baked lobby', () => {
  assert.deepEqual(OWNER_JTC_LOBBY_IDS, {
    cephalon: '1540877236184424500',
    ascended: '1540867019979890829',
    sanctuary: '1541540961937526916'
  });
  assert.deepEqual(GAME_BOT_JTC_MODULES, ['ark', 'warframe', 'diablo4']);
  assert.equal(resolveJtcConfig('cephalon', {}).lobbyId, '1540877236184424500');

  const unset = vanguardJtcConfig({});
  assert.equal(unset.bot, 'vanguard');
  assert.equal(unset.lobbyId, '');
  assert.equal(unset.lobbySource, 'unset');
  assert.equal(unset.configured, false);

  const invalid = resolveJtcConfig('vanguard', { VANGUARD_JTC_LOBBY_CHANNEL_ID: 'nope', VANGUARD_DISCORD_CATEGORY_ID: CATEGORY });
  assert.equal(invalid.lobbySource, 'invalid');
  assert.equal(invalid.configured, false);

  const ready = vanguardJtcConfig({
    VANGUARD_JTC_LOBBY_CHANNEL_ID: LOBBY,
    VANGUARD_DISCORD_CATEGORY_ID: CATEGORY
  });
  assert.equal(ready.configured, true);
  assert.equal(ready.lobbyId, LOBBY);
  assert.equal(ready.categoryId, CATEGORY);
  assert.equal(ready.lobbySource, 'env');

  const name = channelNameFor('vanguard', 'Nova');
  assert.equal(name, "\uD83C\uDFAE Nova's Fireteam");
  assert.doesNotMatch(name, /destiny|vanguard/i);
});

test('installing vanguard join-to-create listens once and can adopt a setup lobby', () => {
  const client = new EventEmitter();
  const env = { VANGUARD_DISCORD_CATEGORY_ID: CATEGORY };
  const first = installVanguardJtc(client, env);
  const second = installJoinToCreate(client, { bot: 'vanguard', env });
  assert.equal(first.controller.config.configured, false);
  assert.equal(second.controller, null);
  assert.equal(client.listeners(Events.VoiceStateUpdate).length, 1);

  env.VANGUARD_JTC_LOBBY_CHANNEL_ID = LOBBY;
  const updated = applyJtcLobby(first.controller, env);
  assert.equal(updated.configured, true);
  assert.equal(updated.lobbyId, LOBBY);
  assert.equal(first.controller.config.categoryId, CATEGORY);
});

function voiceGuild(created) {
  return {
    id: GUILD,
    channels: {
      create: async (options) => {
        const channel = {
          id: `temp-${created.length + 1}`,
          name: options.name,
          parentId: options.parent,
          type: options.type,
          members: { size: 1 },
          deleted: false,
          delete: async () => { channel.deleted = true; }
        };
        created.push(channel);
        return channel;
      },
      fetch: async (id) => created.find((channel) => channel.id === id) || (id === LOBBY ? { id: LOBBY, parentId: CATEGORY, members: { size: 1 } } : null)
    }
  };
}

function member(guild, id = '42', name = 'Nova') {
  return {
    id,
    displayName: name,
    guild,
    user: { bot: false, username: name },
    voice: { setChannel: async () => {} }
  };
}

function joinState(guild, person, channelId = LOBBY, parentId = CATEGORY) {
  return {
    guild,
    channelId,
    channel: { id: channelId, parentId, members: { size: 1 } },
    member: person
  };
}

test('gate unset + override set \u2192 JTC off', async () => {
  const cephalon = resolveJtcConfig('cephalon', { CEPHALON_JTC_CATEGORY_ID: OVERRIDE });
  assert.equal(cephalon.categoryId, OVERRIDE);

  const unsetGate = resolveJtcConfig('vanguard', {
    VANGUARD_JTC_LOBBY_CHANNEL_ID: LOBBY,
    VANGUARD_JTC_CATEGORY_ID: OVERRIDE
  });
  assert.equal(unsetGate.categoryId, '');
  assert.equal(unsetGate.configured, false);

  const aliasOnly = resolveJtcConfig('vanguard', {
    VANGUARD_JTC_LOBBY_CHANNEL_ID: LOBBY,
    VANGUARD_CATEGORY_ID: CATEGORY,
    VANGUARD_JTC_CATEGORY_ID: OVERRIDE
  });
  assert.equal(aliasOnly.categoryId, '');
  assert.equal(aliasOnly.configured, false);

  const invalidGate = resolveJtcConfig('vanguard', {
    VANGUARD_DISCORD_CATEGORY_ID: 'nope',
    VANGUARD_JTC_LOBBY_CHANNEL_ID: LOBBY,
    VANGUARD_JTC_CATEGORY_ID: OVERRIDE
  });
  assert.equal(invalidGate.categoryId, '');
  assert.equal(invalidGate.configured, false);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanguard-jtc-off-'));
  try {
    const created = [];
    const guild = voiceGuild(created);
    const person = member(guild);
    const off = new JoinToCreate({
      bot: 'vanguard',
      env: {
        VANGUARD_JTC_LOBBY_CHANNEL_ID: LOBBY,
        VANGUARD_JTC_CATEGORY_ID: OVERRIDE,
        NEXUS_DATA_DIR: dir
      },
      dir,
      log: () => {}
    });
    const ignored = await off.handleVoiceState({}, joinState(guild, person, LOBBY, OVERRIDE));
    assert.equal(ignored.action, 'ignored');
    assert.equal(ignored.reason, 'unconfigured');
    assert.equal(created.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('override != gate \u2192 no channels created outside the gate', async () => {
  const matched = resolveJtcConfig('vanguard', {
    VANGUARD_DISCORD_CATEGORY_ID: CATEGORY,
    VANGUARD_JTC_CATEGORY_ID: CATEGORY,
    VANGUARD_JTC_LOBBY_CHANNEL_ID: LOBBY
  });
  assert.equal(matched.configured, true);
  assert.equal(matched.categoryId, CATEGORY);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanguard-jtc-gate-'));
  try {
    const created = [];
    const guild = voiceGuild(created);
    const person = member(guild);
    const jtc = new JoinToCreate({
      bot: 'vanguard',
      env: {
        VANGUARD_DISCORD_CATEGORY_ID: CATEGORY,
        VANGUARD_JTC_CATEGORY_ID: OVERRIDE,
        VANGUARD_JTC_LOBBY_CHANNEL_ID: LOBBY,
        NEXUS_DATA_DIR: dir
      },
      dir,
      log: () => {}
    });
    assert.equal(jtc.config.configured, true);
    assert.equal(jtc.config.categoryId, CATEGORY);
    const outside = await jtc.handleVoiceState({}, joinState(guild, person, LOBBY, OVERRIDE));
    assert.equal(outside.action, 'ignored');
    assert.equal(outside.reason, 'category');
    assert.equal(created.length, 0);
    const inside = await jtc.handleVoiceState({}, joinState(guild, person, LOBBY, CATEGORY));
    assert.equal(inside.action, 'created');
    assert.equal(created.length, 1);
    assert.equal(created[0].parentId, CATEGORY);
    for (const channel of created) assert.notEqual(channel.parentId, OVERRIDE);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a setup-created lobby turns join-to-create on through one install inside the gate', async () => {
  const startSource = fs.readFileSync(path.join(__dirname, '../../src/game-bots/start.cjs'), 'utf8');
  assert.match(startSource, /key !== 'vanguard'\) installJoinToCreate/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanguard-jtc-setup-'));
  const env = {
    VANGUARD_DATA_DIR: dir,
    NEXUS_DATA_DIR: dir,
    VANGUARD_DISCORD_CATEGORY_ID: CATEGORY,
    VANGUARD_JTC_CATEGORY_ID: OVERRIDE
  };
  const client = new EventEmitter();
  try {
    const ctx = installVanguard(client, { env });
    assert.equal(ctx.jtc.config.configured, false);
    assert.equal(client.listeners(Events.VoiceStateUpdate).length, 1);

    publishRuntimeChannels(env, { jtcLobby: LOBBY }, ctx.jtc);
    assert.equal(env.VANGUARD_JTC_LOBBY_CHANNEL_ID, LOBBY);
    assert.equal(ctx.jtc.config.configured, true);
    assert.equal(ctx.jtc.config.lobbyId, LOBBY);
    assert.equal(ctx.jtc.config.categoryId, CATEGORY);
    assert.equal(client.listeners(Events.VoiceStateUpdate).length, 1);

    const created = [];
    const guild = voiceGuild(created);
    const person = member(guild);
    const outside = await ctx.jtc.handleVoiceState({}, joinState(guild, person, LOBBY, OVERRIDE));
    assert.equal(outside.reason, 'category');
    assert.equal(created.length, 0);
    const inside = await ctx.jtc.handleVoiceState({}, joinState(guild, person, LOBBY, CATEGORY));
    assert.equal(inside.action, 'created');
    assert.equal(created[0].parentId, CATEGORY);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the vanguard scheduler runs ready work and ticks one at a time', async () => {
  const scheduler = new Scheduler();
  const order = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = scheduler.run(async () => {
    order.push('start');
    await gate;
    order.push('end');
  });
  const second = scheduler.run(async () => {
    order.push('second');
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['start']);
  release();
  await first;
  await second;
  assert.deepEqual(order, ['start', 'end', 'second']);
  scheduler.stop();
  const skipped = await scheduler.run(async () => {
    order.push('late');
  });
  assert.equal(skipped.skipped, true);
  assert.deepEqual(order, ['start', 'end', 'second']);
});
