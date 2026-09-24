'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { ChannelType, GatewayIntentBits, MessageFlags } = require('discord.js');
const { ModuleProvisioner } = require('../src/sentinel/module-provisioner.cjs');
const { ArkRconConfigStore, describeRconVault } = require('../src/sentinel/ark-rcon-config-store.cjs');
const { checkRconPrefix } = require('../src/game-bots/ascended-rcon-health.cjs');
const { OWNER_CATEGORY_IDS, installCategoryGate } = require('../src/game-bots/category-gate.cjs');
const { helpText, buildStatusText } = require('../src/game-bots/ops-spine.cjs');
const { gameBotIntentBits } = require('../src/game-bots/start.cjs');
const { handleStageCommand } = require('../src/game-bots/stage-commands.cjs');
const {
  GAME_BOT_JTC_MODULES,
  JoinToCreate,
  channelNameFor,
  installJoinToCreate,
  jtcStatusLine,
  resolveJtcConfig
} = require('../src/game-bots/join-to-create.cjs');
const {
  fissureEmbed,
  groupFissures,
  NightwaveDesk,
  CycleWatch,
  normalizeCycle
} = require('../src/game-bots/cephalon-relay.cjs');
const { parseOfficialStatus, officialEmbed } = require('../src/game-bots/asa-official-status.cjs');
const { SessionListCache, clusterEmbed, parseSessionAllowlist } = require('../src/game-bots/asa-cluster-presence.cjs');

const EOS = '0123456789abcdef0123456789abcdef';
const LOBBY = '1516640233389822001';
const CATEGORY = OWNER_CATEGORY_IDS.cephalon;
const GUILD = '1516640233389822099';

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jtcEnv(extra = {}) {
  return {
    CEPHALON_JTC_LOBBY_CHANNEL_ID: LOBBY,
    CEPHALON_JTC_CATEGORY_ID: CATEGORY,
    NEXUS_DISCORD_GUILD_ID: GUILD,
    ...extra
  };
}

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
      fetch: async (id) => created.find((channel) => channel.id === id) || (id === LOBBY ? { id: LOBBY, parentId: CATEGORY, members: { size: 1 }, delete: async () => { throw new Error('lobby deleted'); } } : null)
    }
  };
}

function member(guild, id = '42', name = 'Nova') {
  const moved = [];
  return {
    id,
    displayName: name,
    guild,
    user: { bot: false, username: name },
    moved,
    voice: { setChannel: async (channel) => { moved.push(String(channel.id || channel)); } }
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

test('game bots declare GuildVoiceStates and JTC config stays inside the category gate', () => {
  const bits = gameBotIntentBits();
  assert.equal(bits.includes(GatewayIntentBits.GuildVoiceStates), true);
  assert.equal(bits.includes(GatewayIntentBits.Guilds), true);
  const configured = resolveJtcConfig('cephalon', jtcEnv());
  assert.equal(configured.configured, true);
  assert.equal(configured.categoryId, CATEGORY);
  const fallback = resolveJtcConfig('ascended', { ASCENDED_JTC_LOBBY_CHANNEL_ID: LOBBY });
  assert.equal(fallback.categoryId, OWNER_CATEGORY_IDS.ascended);
  const sanctuary = resolveJtcConfig('sanctuary', {
    SANCTUARY_JTC_LOBBY_CHANNEL_ID: LOBBY,
    SANCTUARY_DISCORD_CATEGORY_ID: '1541540940471210128'
  });
  assert.equal(sanctuary.categoryId, '1541540940471210128');
  assert.equal(jtcStatusLine('cephalon', {}), 'Join-to-create: lobby not configured.');
  assert.equal(jtcStatusLine('cephalon', jtcEnv()), 'Join-to-create: lobby configured.');
  assert.equal(channelNameFor('cephalon', 'Nova'), "🎮 Nova's Squad");
  assert.deepEqual(GAME_BOT_JTC_MODULES, ['ark', 'warframe', 'diablo4']);
});

test('join-to-create creates, reuses, gates, and deletes empty channels without touching the lobby', async () => {
  const dir = tempDir('jtc');
  const logs = [];
  try {
    const created = [];
    const guild = voiceGuild(created);
    const person = member(guild);
    const lobby = { id: LOBBY, parentId: CATEGORY, deleted: false, members: { size: 0 }, delete: async () => { lobby.deleted = true; } };
    const jtc = new JoinToCreate({
      bot: 'cephalon',
      env: jtcEnv(),
      dir,
      graceMs: 20,
      log: (fields) => logs.push(JSON.stringify(fields))
    });
    const createdResult = await jtc.handleVoiceState({ guild, channelId: null }, joinState(guild, person));
    assert.equal(createdResult.action, 'created');
    assert.equal(created.length, 1);
    assert.equal(created[0].type, ChannelType.GuildVoice);
    assert.equal(created[0].parentId, CATEGORY);
    assert.equal(person.moved[0], created[0].id);
    assert.match(created[0].name, /Nova/);

    const again = await jtc.handleVoiceState({ guild, channelId: null }, joinState(guild, person));
    assert.equal(again.action, 'moved');
    assert.equal(created.length, 1);

    const reloaded = new JoinToCreate({ bot: 'cephalon', env: jtcEnv(), dir, graceMs: 20 });
    const fresh = [];
    const guild2 = voiceGuild(fresh);
    const saved = created[0];
    guild2.channels.fetch = async (id) => (id === saved.id ? saved : null);
    const person2 = member(guild2);
    const restored = await reloaded.handleVoiceState({ guild: guild2, channelId: null }, joinState(guild2, person2));
    assert.equal(restored.action, 'moved');
    assert.equal(fresh.length, 0);
    reloaded.stop();

    const otherCategory = await jtc.handleVoiceState({ guild, channelId: null }, joinState(guild, person, LOBBY, '1516602943670059108'));
    assert.equal(otherCategory.reason, 'category');
    const otherGuild = { ...guild, id: '1000000000000000009' };
    const foreign = await jtc.handleVoiceState({ guild: otherGuild, channelId: null }, joinState(otherGuild, member(otherGuild)));
    assert.equal(foreign.reason, 'guild');
    assert.equal(created.length, 1);

    created[0].members.size = 0;
    const left = await jtc.handleVoiceState(
      { guild, channelId: created[0].id, channel: created[0] },
      { guild, channelId: null, member: person }
    );
    assert.equal(left.action, 'scheduled');
    assert.equal(created[0].deleted, false);
    assert.equal(lobby.deleted, false);
    await wait(40);
    assert.equal(created[0].deleted, true);
    assert.equal(jtc.ownedCount(), 0);
    assert.equal(logs.some((line) => line.includes('Nova') || line.includes('42')), false);
    assert.match(logs.join('\n'), /created/);
    jtc.stop();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('join-to-create is idempotent while a create is in flight and Sentinal skips game-bot modules', async () => {
  const dir = tempDir('jtc-lock');
  try {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const created = [];
    const guild = {
      id: GUILD,
      channels: {
        create: async (options) => {
          await gate;
          const channel = { id: `temp-${created.length + 1}`, name: options.name, parentId: options.parent, type: options.type, members: { size: 1 } };
          created.push(channel);
          return channel;
        },
        fetch: async (id) => created.find((channel) => channel.id === id) || null
      }
    };
    const person = member(guild);
    const jtc = new JoinToCreate({ bot: 'cephalon', env: jtcEnv(), dir, graceMs: 20 });
    const first = jtc.handleVoiceState({ guild, channelId: null }, joinState(guild, person));
    const second = jtc.handleVoiceState({ guild, channelId: null }, joinState(guild, person));
    release();
    const results = await Promise.all([first, second]);
    assert.equal(created.length, 1);
    assert.equal(results.filter((result) => result.action === 'created').length, 1);
    assert.equal(results.filter((result) => result.reason === 'in-flight').length, 1);
    jtc.stop();

    const state = {
      setups: {
        ark: { moduleId: 'ark', guildId: 'g1', lobbyBuilderChannelId: 'lobby' },
        warframe: { moduleId: 'warframe', guildId: 'g1', lobbyBuilderChannelId: 'wf' },
        diablo4: { moduleId: 'diablo4', guildId: 'g1', lobbyBuilderChannelId: 'd4' },
        division2: { moduleId: 'division2', guildId: 'g1', lobbyBuilderChannelId: 'div' }
      },
      lobbies: {},
      listModuleSetups() { return this.setups; },
      getTempLobby(id) { return this.lobbies[id] || null; },
      listTempLobbies() { return { ...this.lobbies }; },
      findTempLobbyByOwner() { return null; },
      setTempLobby(id, value) { this.lobbies[id] = value; },
      removeTempLobby(id) { delete this.lobbies[id]; }
    };
    const provisioner = new ModuleProvisioner({ state });
    const calls = [];
    const sentinalGuild = {
      id: 'g1',
      channels: {
        create: async (options) => {
          calls.push(options.name);
          return { id: 'made', type: options.type, members: { size: 0 } };
        }
      }
    };
    const sentinalMember = { id: '9', displayName: 'Nova', guild: sentinalGuild, voice: { setChannel: async () => {} } };
    for (const channelId of ['lobby', 'wf', 'd4']) {
      await provisioner.handleVoiceState({ channelId: null, guild: sentinalGuild }, { channelId, guild: sentinalGuild, member: sentinalMember });
    }
    assert.equal(calls.length, 0);
    await provisioner.handleVoiceState({ channelId: null, guild: sentinalGuild }, { channelId: 'div', guild: sentinalGuild, member: sentinalMember });
    assert.equal(calls.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cephalon fissures, nightwave, and cycles stay gated, cached, and local', async () => {
  const dir = tempDir('cephalon-board');
  const calls = [];
  const provider = {
    async worldstate(pathname) {
      calls.push(pathname);
      if (pathname === 'fissures') {
        return [{ tier: 'Lith', node: 'Lith, Earth', missionType: 'Capture', eta: '12m', expiry: 'soon', isHard: true, isStorm: false, expired: false }];
      }
      if (pathname === 'nightwave') {
        return { season: 5, phase: 2, activeChallenges: [{ id: 'hunt', title: 'Hunt', desc: 'Defeat enemies', reputation: 1000 }] };
      }
      return { state: pathname === 'cetusCycle' ? 'day' : 'cold', timeLeft: '8m' };
    }
  };
  const edited = [];
  const sent = [];
  const client = {
    channels: {
      fetch: async () => ({
        send: async (body) => {
          sent.push(body);
          return { id: 'msg-1' };
        },
        messages: {
          fetch: async () => ({ edit: async (body) => { edited.push(body); } })
        }
      })
    }
  };
  const context = {
    bot: 'cephalon',
    env: { CEPHALON_FISSURE_CHANNEL_ID: '1516640233389822111', NEXUS_DATA_DIR: dir },
    provider,
    client,
    dir
  };
  try {
    const replies = [];
    const interaction = {
      commandName: 'fissures',
      user: { id: '42' },
      isChatInputCommand: () => true,
      isButton: () => false,
      reply: async (body) => { replies.push(body); }
    };
    assert.equal(await handleStageCommand(interaction, context), true);
    assert.equal(await handleStageCommand(interaction, context), true);
    assert.equal(calls.filter((pathname) => pathname === 'fissures').length, 1);
    assert.match(JSON.stringify(replies[0].embeds[0]), /Lith, Earth/);
    assert.match(JSON.stringify(replies[0].embeds[0]), /12m/);
    assert.match(replies[0].embeds[0].footer.text, /WFCD/);
    assert.equal(sent.length, 1);
    assert.equal(edited.length, 1);
    const grouped = groupFissures([{ tier: 'Axi', node: 'Axi, Void', eta: '1m', isStorm: true }]);
    assert.match(grouped[0].lines[0], /Storm/);
    assert.match(fissureEmbed([]).description, /No open fissures/);

    const night = {
      commandName: 'nightwave',
      user: { id: '42' },
      isChatInputCommand: () => true,
      isButton: () => false,
      reply: async (body) => { replies.push(body); }
    };
    await handleStageCommand(night, context);
    const button = {
      customId: 'cephalon:nw:5:hunt',
      user: { id: '42' },
      isChatInputCommand: () => false,
      isButton: () => true,
      update: async (body) => { replies.push(body); }
    };
    await handleStageCommand(button, context);
    const desk = new NightwaveDesk(dir);
    assert.equal(desk.isDone('42', 5, 'hunt'), true);
    assert.equal(desk.isDone('7', 5, 'hunt'), false);
    desk.toggle('42', 6, 'hunt');
    assert.equal(desk.isDone('42', 5, 'hunt'), true);

    const cycles = {
      commandName: 'cycles',
      user: { id: '42' },
      isChatInputCommand: () => true,
      isButton: () => false,
      reply: async (body) => { replies.push(body); }
    };
    await handleStageCommand(cycles, context);
    await handleStageCommand(cycles, context);
    assert.equal(calls.filter((pathname) => pathname === 'cetusCycle').length, 1);
    assert.match(JSON.stringify(replies.at(-1).embeds[0]), /Cetus/);
    assert.match(JSON.stringify(replies.at(-1).embeds[0]), /Cambion/);

    const watch = new CycleWatch({
      cache: { get: async () => ({ value: [normalizeCycle('cetus', 'Cetus', { state: 'day', timeLeft: '1m' })] }) },
      roles: { cetus: '1516640233389822222' },
      stateFile: path.join(dir, 'cycle-state.json'),
      send: async (ping) => { sent.push(ping); }
    });
    assert.equal((await watch.tick()).length, 0);
    watch.cache.get = async () => ({ value: [normalizeCycle('cetus', 'Cetus', { state: 'night', timeLeft: '2m' })] });
    const pings = await watch.tick();
    assert.equal(pings.length, 1);
    assert.equal(pings[0].state, 'night');
    assert.doesNotMatch(JSON.stringify(pings[0]), new RegExp(EOS));

    const gated = new EventEmitter();
    installCategoryGate(gated, { bot: 'cephalon', env: {} });
    const before = calls.length;
    gated.on('interactionCreate', (item) => { void handleStageCommand(item, context); });
    const denied = {
      guildId: null,
      commandName: 'fissures',
      isChatInputCommand: () => true,
      isButton: () => false,
      reply: async (body) => { replies.push(body); },
      replies
    };
    gated.emit('interactionCreate', denied);
    await flush();
    await flush();
    assert.equal(calls.length, before);
    assert.equal(replies.at(-1).content, 'Use this bot in the Warframe category.');
    assert.equal(replies.at(-1).flags, MessageFlags.Ephemeral);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('official status parses ArkML and the cluster card caches an allowlist without EOS ids', async () => {
  const raw = '[OfficialServerStatus]\nServerStatus=<RichColor Color="0, 1, 0, 1">Online (v93.33)</>\n';
  const parsed = parseOfficialStatus(raw);
  assert.equal(parsed.online, true);
  assert.equal(parsed.version, '93.33');
  assert.doesNotMatch(parsed.summary, /RichColor/);
  assert.equal(parseOfficialStatus('ServerStatus=Offline (v1.2)').online, false);
  assert.match(officialEmbed(parsed).footer.text, /Wildcard CDN/);

  const dir = tempDir('cluster');
  try {
    let fetches = 0;
    let bodyReads = 0;
    const payload = JSON.stringify([
      {
        SessionID: 'NexusGen1',
        SessionName: `Island ${EOS}`,
        MapName: 'TheIsland_WP',
        NumPlayers: 4,
        MaxPlayers: 70,
        DayTime: 'Day 12',
        EOS,
        PlayerList: [EOS]
      },
      { SessionID: 'Other', SessionName: 'Elsewhere', MapName: 'Ragnarok', NumPlayers: 50, MaxPlayers: 70, DayTime: 'Night' }
    ]);
    const cache = new SessionListCache({
      file: path.join(dir, 'cache.json'),
      ttlMs: 60_000,
      now: () => 1_000_000,
      fetchImpl: async () => {
        fetches += 1;
        return {
          ok: true,
          status: 200,
          headers: { get: (name) => (name === 'etag' ? '"v1"' : null) },
          text: async () => {
            bodyReads += 1;
            return payload;
          }
        };
      }
    });
    const first = await cache.load(['NexusGen1']);
    const second = await cache.load(['NexusGen1']);
    assert.equal(fetches, 1);
    assert.equal(bodyReads, 1);
    assert.equal(second.fetched, false);
    assert.equal(first.servers.length, 1);
    assert.equal(first.servers[0].players, 4);
    assert.equal(first.servers[0].map, 'TheIsland_WP');
    assert.match(first.servers[0].day, /Day 12/);
    const card = JSON.stringify(clusterEmbed(first.servers, first));
    assert.match(card, /Island/);
    assert.match(card, /4\/70/);
    assert.doesNotMatch(card, new RegExp(EOS));
    assert.doesNotMatch(card, /Elsewhere/);
    assert.equal(parseSessionAllowlist({ ASCENDED_SESSION_IDS: '' }).length, 0);
    const idle = await cache.load([]);
    assert.equal(idle.reason, 'allowlist-empty');
    assert.equal(fetches, 1);

    const huge = new SessionListCache({
      file: path.join(dir, 'huge.json'),
      ttlMs: 1000,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: (name) => (name === 'content-length' ? String(90 * 1024 * 1024) : null) },
        text: async () => { throw new Error('full list downloaded'); }
      })
    });
    await assert.rejects(() => huge.load(['NexusGen1']), /too large/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('RCON vault survives a new store instance and will not mint a key over ciphertext', async () => {
  const dir = tempDir('rcon-vault');
  const env = {
    NEXUS_DATA_DIR: dir,
    NEXUS_RCON_RAILWAY_ENV_FORBIDDEN: 'true',
    NEXUS_RCON_SOURCE: 'discord_override_store',
    ARK_GEN1_HOST: '203.0.113.9',
    ARK_GEN1_RCON_PORT: '28015',
    ARK_GEN1_RCON_PASSWORD: 'super-secret-rcon'
  };
  try {
    const store = new ArkRconConfigStore(dir);
    store.setEndpoint('ARK_GEN1', { host: '192.0.2.20', port: 30100, actorId: 'owner' });
    store.setPassword('ARK_GEN1', 'from-discord', 'owner');
    const restarted = new ArkRconConfigStore(dir);
    const resolved = restarted.resolve('ARK_GEN1', env);
    assert.equal(resolved.password, 'from-discord');
    assert.equal(resolved.host, '192.0.2.20');
    const health = await checkRconPrefix('ARK_GEN1', {
      store: restarted,
      env,
      execute: async (server) => {
        assert.equal(server.password, 'from-discord');
        return 'No Players Connected';
      }
    });
    assert.equal(health.row.ok, true);
    assert.equal(health.row.configured, true);
    const onDisk = fs.readFileSync(path.join(dir, 'ark-rcon-overrides.json'), 'utf8');
    assert.doesNotMatch(onDisk, /from-discord/);
    assert.equal(describeRconVault(env, dir).readablePasswords, 1);

    const broken = tempDir('rcon-broken');
    fs.writeFileSync(path.join(broken, 'ark-rcon-overrides.json'), `${JSON.stringify({
      version: 1,
      servers: { ARK_GEN1: { host: '192.0.2.20', port: 30100, enabled: true, password: { v: 1, alg: 'aes-256-gcm', iv: 'aa', tag: 'bb', data: 'cc' } } }
    })}\n`);
    const summary = describeRconVault({}, broken);
    assert.equal(summary.unreadable, 1);
    assert.equal(summary.readablePasswords, 0);
    assert.equal(fs.existsSync(path.join(broken, 'ark-rcon-config-secret')), false);
    fs.rmSync(broken, { recursive: true, force: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('help and staff status mention the new boards and JTC without a second economy', async () => {
  const cephalon = helpText('cephalon');
  const ascended = helpText('ascended');
  assert.match(cephalon, /\/fissures/);
  assert.match(cephalon, /\/nightwave/);
  assert.match(cephalon, /\/cycles/);
  assert.match(ascended, /\/official/);
  assert.match(ascended, /\/cluster/);
  assert.match(cephalon, /Nexus Sentinal/);
  assert.match(cephalon, /\/bal/);
  const status = await buildStatusText({
    bot: 'cephalon',
    client: { isReady: () => true },
    env: jtcEnv(),
    probe: async () => ({ label: 'healthy' })
  });
  assert.match(status, /Join-to-create: lobby configured/);
  assert.match(status, /WFCD/);
  assert.doesNotMatch(status, /Nova/);
  const statusDir = tempDir('status-empty');
  const ascendedStatus = await buildStatusText({
    bot: 'ascended',
    client: { isReady: () => true },
    env: { NEXUS_DATA_DIR: statusDir, ASCENDED_SESSION_IDS: 'NexusGen1' }
  });
  fs.rmSync(statusDir, { recursive: true, force: true });
  assert.match(ascendedStatus, /Join-to-create: lobby not configured/);
  assert.match(ascendedStatus, /1 SessionID allowlisted/);
  assert.doesNotMatch(ascendedStatus, /NexusGen1/);
});

test('installed join-to-create listens once and reconciles a missing channel', async () => {
  const dir = tempDir('jtc-install');
  try {
    const client = new EventEmitter();
    client.once = (event, listener) => client.on(event, listener);
    const first = installJoinToCreate(client, { bot: 'sanctuary', env: { SANCTUARY_JTC_LOBBY_CHANNEL_ID: LOBBY, SANCTUARY_JTC_CATEGORY_ID: CATEGORY }, controller: new JoinToCreate({ bot: 'sanctuary', env: { SANCTUARY_JTC_LOBBY_CHANNEL_ID: LOBBY, SANCTUARY_JTC_CATEGORY_ID: CATEGORY }, dir, graceMs: 20 }) });
    const second = installJoinToCreate(client, { bot: 'sanctuary', env: {} });
    assert.equal(second.controller, null);
    const created = [];
    const guild = voiceGuild(created);
    guild.id = 'any';
    const person = member(guild);
    client.emit('voiceStateUpdate', { guild, channelId: null }, joinState(guild, person));
    await flush();
    await flush();
    assert.equal(created.length, 1);
    first.controller.store.upsert({ channelId: 'missing', creatorId: '9', guildId: 'any', categoryId: CATEGORY });
    const reconciled = await first.controller.reconcile({ guilds: { fetch: async () => ({ channels: { fetch: async () => null } }) } });
    assert.equal(reconciled.removed >= 1, true);
    assert.equal(first.controller.store.get(LOBBY), null);
    first.controller.stop();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
