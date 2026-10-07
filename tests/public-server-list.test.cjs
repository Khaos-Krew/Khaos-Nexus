'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { HostedServerStore } = require('../src/backend/core/hosted-server-store.cjs');
const { CraftStore } = require('../src/craft/store.cjs');
const { onPublicServersChanged } = require('../src/shared/server-list-notify.cjs');
const { ArkClusterRegistry } = require('../src/sentinel/ark-cluster-registry.cjs');
const { collectPublicServers } = require('../src/sentinel/public-server-inventory.cjs');
const {
  handleServerListCommand,
  listEnabled,
  publishPublicServerList,
  renderPublicServerList,
  serverListCommand
} = require('../src/sentinel/public-server-list.cjs');
const { StateStore } = require('../src/sentinel/state-store.cjs');

const CHANNEL = '1516602943670059108';
const OTHER = '1516640233389822042';
const RCON_HOST = 'rcon.secret.example';
const RCON_PASSWORD = 'super-secret-rcon-password';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-server-list-'));
}

function emptyRuntime() {
  return { config: { modules: {} }, manifests() { return []; } };
}

function listen() {
  const reasons = [];
  const stop = onPublicServersChanged((reason) => reasons.push(reason));
  return { reasons, stop };
}

test('inventory reads ARK, Craft, hosted, and configured servers without secrets', () => {
  const dir = tempDir();
  try {
    const registry = new ArkClusterRegistry(dir);
    registry.upsert({ id: 'gen1', envPrefix: 'ARK_GEN1', name: 'Genesis', mapName: 'Genesis Part 1', enabled: true, runtime: { state: 'online', playerCount: 3, lastCheckedAt: '2026-09-29T00:00:00.000Z' } });
    registry.upsert({ id: 'hidden', envPrefix: 'ARK_MAP2', name: 'Hidden', mapName: 'Hidden Map', enabled: false });
    fs.mkdirSync(registry.dir, { recursive: true });
    fs.writeFileSync(path.join(registry.dir, 'ark-rcon-overrides.json'), JSON.stringify({
      version: 1,
      servers: { ARK_GEN1: { host: RCON_HOST, port: 28015, password: { data: 'ciphertext' } } }
    }));
    const craft = new CraftStore(dir, {});
    craft.setStatusPanel({ channelId: CHANNEL, host: 'play.mc.example', javaPort: 25565, bedrockPort: 19132, kind: 'geyser' });
    craft.saveServer({ name: 'survival', host: RCON_HOST, port: 25575, password: RCON_PASSWORD });
    craft.createListing({ ownerId: '1516602943670059101', name: 'Realm One', edition: 'java', description: 'A quiet realm', slots: 2 });
    const hosted = new HostedServerStore({ filePath: path.join(dir, 'hosted.json') });
    const palServer = hosted.add({
      game: 'Palworld',
      serverType: 'hosted',
      name: 'Community Pal',
      host: 'pal.example.test',
      port: 8211,
      joinInfo: 'pal.example.test:8211',
      joinSecret: 'TOPSECRET',
      adminNotes: 'STAFF ONLY',
      credentialEnv: 'SECRET_ENV',
      public: true
    });
    hosted.update(palServer.id, { trackingState: 'online', playerCount: 4, playerMax: 32 });
    const runtime = {
      config: {
        modules: {
          rust: {
            enabled: true,
            connection: { name: 'Outpost', host: 'rust-admin.example', port: 28016, passwordEnv: 'NEXUS_RUST_RCON_PASSWORD' }
          },
          minecraft: { enabled: true, connection: { servers: [{ name: 'Empty', host: '', port: 0, passwordEnv: 'NEXUS_MINECRAFT_RCON_PASSWORD' }] } }
        }
      },
      manifests() { return []; }
    };
    const rows = collectPublicServers({
      env: { ARK_GEN1_PUBLIC_JOIN: `${RCON_HOST}:7777`, ARK_MAP2_PUBLIC_JOIN: 'play.asa.example:7777' },
      arkRegistry: registry,
      craftStore: craft,
      hostedStore: hosted,
      runtime
    });
    const text = JSON.stringify(rows);
    assert.equal(text.includes(RCON_HOST), false);
    assert.equal(text.includes(RCON_PASSWORD), false);
    assert.equal(text.includes('TOPSECRET'), false);
    assert.equal(text.includes('STAFF ONLY'), false);
    assert.equal(text.includes('SECRET_ENV'), false);
    assert.equal(text.includes('NEXUS_RUST_RCON_PASSWORD'), false);
    assert.equal(text.includes('rust-admin.example'), false);
    assert.equal(text.includes('25575'), false);
    assert.equal(rows.some((row) => row.name === 'Hidden Map'), false);
    assert.equal(rows.some((row) => row.name === 'Genesis Part 1'), false);
    const ark = rows.find((row) => row.name === 'Genesis');
    assert.equal(ark.game, 'ARK: Survival Ascended');
    assert.equal(ark.status, 'Online');
    assert.equal(ark.players, '3');
    assert.equal(ark.joins[0], `In-game server list: Genesis`);
    const mc = rows.find((row) => row.name === 'play.mc.example');
    assert.deepEqual(mc.joins, ['Java play.mc.example:25565', 'Bedrock play.mc.example:19132']);
    assert.equal(mc.kind, 'geyser');
    const realm = rows.find((row) => row.name === 'Realm One');
    assert.equal(realm.kind, 'realm');
    assert.equal(realm.status, '');
    assert.equal(realm.description, 'A quiet realm');
    const pal = rows.find((row) => row.name === 'Community Pal');
    assert.equal(pal.game, 'Palworld');
    assert.deepEqual(pal.joins, ['pal.example.test:8211']);
    assert.equal(pal.status, 'Online');
    const rust = rows.find((row) => row.name === 'Outpost');
    assert.equal(rust.game, 'Rust');
    assert.deepEqual(rust.joins, []);
    const rendered = renderPublicServerList(rows);
    assert.equal(rendered.embeds[0].footer.text, 'Many Worlds One Nexus • servers');
    assert.deepEqual(rendered.allowedMentions, { parse: [] });
    assert.equal(JSON.stringify(rendered).includes(RCON_PASSWORD), false);
    assert.equal(JSON.stringify(rendered).includes('N/A'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ARK rows prefer the registry name and fall back to the map name', () => {
  const dir = tempDir();
  try {
    const registry = new ArkClusterRegistry(path.join(dir, 'ark'));
    registry.upsert({ id: 'gen1', envPrefix: 'ARK_GEN1', name: 'Khaos Nexus (Gen1)', mapName: 'Genesis Part 1', enabled: true });
    const rows = collectPublicServers({
      env: {},
      arkRegistry: registry,
      craftStore: new CraftStore(path.join(dir, 'craft'), {}),
      hostedStore: new HostedServerStore({ filePath: path.join(dir, 'hosted.json') }),
      runtime: emptyRuntime()
    });
    const ark = rows.find((row) => row.id === 'ark:gen1');
    assert.equal(ark.name, 'Khaos Nexus (Gen1)');
    assert.deepEqual(ark.joins, ['In-game server list: Khaos Nexus (Gen1)']);
    assert.equal(JSON.stringify(rows).includes('Genesis Part 1'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('NEXUS_CRAFT_PUBLIC_JOIN lists Nexus Craft when the Craft panel lives in another service', () => {
  const dir = tempDir();
  try {
    const base = {
      arkRegistry: new ArkClusterRegistry(path.join(dir, 'ark')),
      hostedStore: new HostedServerStore({ filePath: path.join(dir, 'hosted.json') }),
      runtime: emptyRuntime()
    };
    const craft = new CraftStore(path.join(dir, 'craft'), {});
    const rows = collectPublicServers({ ...base, craftStore: craft, env: { NEXUS_CRAFT_PUBLIC_JOIN: '172.240.47.65:25588' } });
    const mc = rows.find((row) => row.game === 'Minecraft');
    assert.equal(mc.name, 'Nexus Craft');
    assert.equal(mc.kind, 'java');
    assert.deepEqual(mc.joins, ['Java 172.240.47.65:25588']);
    const renamed = collectPublicServers({ ...base, craftStore: craft, env: { NEXUS_CRAFT_PUBLIC_JOIN: 'Java play.example:25565', NEXUS_CRAFT_PUBLIC_NAME: 'Craft Two' } });
    assert.equal(renamed.find((row) => row.game === 'Minecraft').name, 'Craft Two');
    for (const bad of ['', 'no-port', 'host:0', 'host:99999', ':25565']) {
      const none = collectPublicServers({ ...base, craftStore: craft, env: { NEXUS_CRAFT_PUBLIC_JOIN: bad } });
      assert.equal(none.some((row) => row.game === 'Minecraft'), false, bad);
    }
    craft.setStatusPanel({ channelId: CHANNEL, host: 'panel.mc.example', javaPort: 25565, kind: 'java' });
    const withPanel = collectPublicServers({ ...base, craftStore: craft, env: { NEXUS_CRAFT_PUBLIC_JOIN: '172.240.47.65:25588' } });
    const mcRows = withPanel.filter((row) => row.game === 'Minecraft');
    assert.equal(mcRows.length, 1);
    assert.equal(mcRows[0].name, 'panel.mc.example');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('minecraft listing follows Java and Bedrock field rules', () => {
  const dir = tempDir();
  try {
    const craft = new CraftStore(dir, {});
    craft.setStatusPanel({ channelId: CHANNEL, host: 'bedrock.example', javaPort: 25565, bedrockPort: 19132, kind: 'bedrock' });
    const rows = collectPublicServers({
      env: {},
      arkRegistry: new ArkClusterRegistry(path.join(dir, 'ark')),
      craftStore: craft,
      hostedStore: new HostedServerStore({ filePath: path.join(dir, 'hosted.json') }),
      runtime: emptyRuntime()
    });
    const row = rows.find((item) => item.kind === 'bedrock');
    assert.deepEqual(row.joins, ['Bedrock bedrock.example:19132']);
    assert.equal(JSON.stringify(row).includes('25565'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the server list edits one durable message', async () => {
  const dir = tempDir();
  try {
    const state = new StateStore(dir);
    state.setPublicServerList({ channelId: CHANNEL, messageId: '' });
    const sent = [];
    const edits = [];
    let message = null;
    const channel = {
      id: CHANNEL,
      send: async (body) => {
        sent.push(body);
        message = {
          id: '1516602943670059111',
          author: { id: '1516602943670059999' },
          embeds: body.embeds,
          edit: async (next) => {
            edits.push(next);
            message.embeds = next.embeds;
            return message;
          }
        };
        return message;
      },
      messages: {
        fetch: async (id) => {
          if (id && typeof id === 'object') return message ? new Map([[message.id, message]]) : new Map();
          if (message && String(id) === message.id) return message;
          throw new Error('missing');
        }
      }
    };
    const client = {
      user: { id: '1516602943670059999' },
      channels: { fetch: async (id) => (id === CHANNEL ? channel : null) }
    };
    const shared = {
      env: {},
      state,
      probe: false,
      runtime: emptyRuntime(),
      arkRegistry: new ArkClusterRegistry(path.join(dir, 'ark')),
      craftStore: new CraftStore(path.join(dir, 'craft'), {}),
      hostedStore: new HostedServerStore({ filePath: path.join(dir, 'hosted.json') })
    };
    const first = await publishPublicServerList(client, shared);
    assert.equal(first.created, true);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].allowedMentions, { parse: [] });
    const second = await publishPublicServerList(client, shared);
    assert.equal(second.created, false);
    assert.equal(sent.length, 1);
    assert.equal(edits.length, 1);
    assert.equal(second.messageId, message.id);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function embedChars(embed) {
  const fields = embed.fields || [];
  return (embed.title || '').length
    + (embed.description || '').length
    + (embed.footer?.text || '').length
    + fields.reduce((sum, field) => sum + String(field.name || '').length + String(field.value || '').length, 0);
}

test('a full server list stays inside Discord embed limits and names the overflow', () => {
  const rows = Array.from({ length: 30 }, () => ({
    game: 'G'.repeat(80),
    name: 'N'.repeat(200),
    description: 'D'.repeat(2000),
    joins: [`Java ${'h'.repeat(400)}:25565`],
    status: 'Online',
    players: '20/20',
    kind: 'java'
  }));
  const embed = renderPublicServerList(rows).embeds[0];
  assert.ok(embedChars(embed) <= 6000);
  assert.ok(embed.fields.length <= 25);
  assert.ok(embed.fields.length > 1);
  const overflow = embed.fields[embed.fields.length - 1];
  const match = `${overflow.name}\n${overflow.value}`.match(/\u2026and (\d+) more servers/);
  assert.ok(match);
  assert.equal(Number(match[1]), rows.length - (embed.fields.length - 1));

  const exact = Array.from({ length: 24 }, (_, index) => ({
    game: 'Game',
    name: `Server ${index + 1}`,
    joins: ['play.example:25565']
  }));
  const exactEmbed = renderPublicServerList(exact).embeds[0];
  assert.equal(exactEmbed.fields.length, 24);
  assert.equal(exactEmbed.fields.some((field) => String(field.value).includes('more servers')), false);

  const extra = Array.from({ length: 26 }, (_, index) => ({
    game: 'Game',
    name: `Server ${index + 1}`,
    joins: ['play.example:25565']
  }));
  const extraEmbed = renderPublicServerList(extra).embeds[0];
  assert.equal(extraEmbed.fields.length, 25);
  assert.ok(embedChars(extraEmbed) <= 6000);
  assert.match(extraEmbed.fields[24].value, /\u2026and 2 more servers/);
});

test('server list setup stores the channel and refuses to invent one', async () => {
  const command = serverListCommand().toJSON();
  assert.equal(command.name, 'serverlist');
  assert.equal(command.default_member_permissions, String(PermissionFlagsBits.ManageGuild));
  assert.equal(listEnabled({}), true);
  assert.equal(listEnabled({ NEXUS_PUBLIC_SERVER_LIST_ENABLED: 'off' }), false);
  const dir = tempDir();
  try {
    const state = new StateStore(dir);
    const sent = [];
    const client = {
      user: { id: '1516602943670059999' },
      channels: {
        fetch: async () => ({
          send: async (body) => {
            sent.push(body);
            return { id: '1516602943670059111', author: { id: '1516602943670059999' }, embeds: body.embeds, edit: async () => {} };
          },
          messages: { fetch: async () => { throw new Error('missing'); } }
        })
      }
    };
    const denied = [];
    await handleServerListCommand({
      commandName: 'serverlist',
      isChatInputCommand: () => true,
      memberPermissions: { has: () => false },
      options: { getSubcommand: () => 'setup', getChannel: () => ({ id: CHANNEL }) },
      reply: async (payload) => denied.push(payload)
    }, { env: {}, state, config: { discord: {} }, client });
    assert.match(denied[0].content, /staff/);
    assert.equal(state.getPublicServerList().channelId, '');

    const edits = [];
    const deferred = [];
    await handleServerListCommand({
      commandName: 'serverlist',
      isChatInputCommand: () => true,
      memberPermissions: { has: (bit) => bit === PermissionFlagsBits.Administrator },
      options: { getSubcommand: () => 'setup', getChannel: () => ({ id: CHANNEL }) },
      deferReply: async (payload) => deferred.push(payload),
      editReply: async (payload) => edits.push(payload),
      reply: async () => { throw new Error('setup should defer before probing'); }
    }, {
      env: {},
      state,
      config: { discord: {} },
      client,
      probe: false,
      runtime: emptyRuntime(),
      arkRegistry: new ArkClusterRegistry(path.join(dir, 'ark')),
      craftStore: new CraftStore(path.join(dir, 'craft'), {}),
      hostedStore: new HostedServerStore({ filePath: path.join(dir, 'hosted.json') })
    });
    assert.equal(state.getPublicServerList().channelId, CHANNEL);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].allowedMentions, { parse: [] });
    assert.equal(deferred[0].flags, MessageFlags.Ephemeral);
    assert.match(edits[0].content, /same message/);

    const blocked = [];
    await handleServerListCommand({
      commandName: 'serverlist',
      isChatInputCommand: () => true,
      memberPermissions: { has: (bit) => bit === PermissionFlagsBits.Administrator },
      options: { getSubcommand: () => 'setup', getChannel: () => ({ id: OTHER }) },
      reply: async (payload) => blocked.push(payload)
    }, { env: { NEXUS_PUBLIC_SERVER_LIST_CHANNEL_ID: CHANNEL }, state, config: { discord: {} }, client });
    assert.match(blocked[0].content, /NEXUS_PUBLIC_SERVER_LIST_CHANNEL_ID/);
    assert.equal(state.getPublicServerList().channelId, CHANNEL);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('concurrent server list updates post once', async () => {
  const dir = tempDir();
  try {
    const state = new StateStore(dir);
    state.setPublicServerList({ channelId: CHANNEL, messageId: '' });
    let sends = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const channel = {
      id: CHANNEL,
      send: async (body) => {
        sends += 1;
        await gate;
        return {
          id: '1516602943670059111',
          author: { id: '1516602943670059999' },
          embeds: body.embeds,
          edit: async () => {}
        };
      },
      messages: { fetch: async () => { throw new Error('missing'); } }
    };
    const client = {
      user: { id: '1516602943670059999' },
      channels: { fetch: async () => channel }
    };
    const shared = {
      env: {},
      state,
      probe: false,
      runtime: emptyRuntime(),
      arkRegistry: new ArkClusterRegistry(path.join(dir, 'ark')),
      craftStore: new CraftStore(path.join(dir, 'craft'), {}),
      hostedStore: new HostedServerStore({ filePath: path.join(dir, 'hosted.json') })
    };
    const pending = Promise.all([
      publishPublicServerList(client, shared),
      publishPublicServerList(client, shared),
      publishPublicServerList(client, shared)
    ]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sends, 1);
    release();
    const results = await pending;
    assert.equal(sends, 1);
    assert.equal(results[0], results[1]);
    assert.equal(results[1], results[2]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('server list refresh defers before probing', async () => {
  const dir = tempDir();
  try {
    const state = new StateStore(dir);
    state.setPublicServerList({ channelId: CHANNEL, messageId: '' });
    const craft = new CraftStore(path.join(dir, 'craft'), {});
    craft.setStatusPanel({ channelId: CHANNEL, host: 'play.example', javaPort: 25565, kind: 'java' });
    const order = [];
    const client = {
      user: { id: '1516602943670059999' },
      channels: {
        fetch: async () => ({
          send: async (body) => ({
            id: '1516602943670059111',
            author: { id: '1516602943670059999' },
            embeds: body.embeds,
            edit: async () => {}
          }),
          messages: { fetch: async () => { throw new Error('missing'); } }
        })
      }
    };
    await handleServerListCommand({
      commandName: 'serverlist',
      isChatInputCommand: () => true,
      memberPermissions: { has: (bit) => bit === PermissionFlagsBits.Administrator },
      options: { getSubcommand: () => 'refresh' },
      deferReply: async (payload) => {
        order.push('defer');
        assert.equal(payload.flags, MessageFlags.Ephemeral);
      },
      editReply: async () => { order.push('edit'); },
      reply: async () => { order.push('reply'); }
    }, {
      env: {},
      state,
      config: { discord: {} },
      client,
      probeServerStatus: async () => {
        order.push('probe');
        return { java: { offline: true } };
      },
      runtime: emptyRuntime(),
      arkRegistry: new ArkClusterRegistry(path.join(dir, 'ark')),
      craftStore: craft,
      hostedStore: new HostedServerStore({ filePath: path.join(dir, 'hosted.json') })
    });
    assert.deepEqual(order, ['defer', 'probe', 'edit']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('adding or removing a public server notifies the list and runtime updates do not', () => {
  const dir = tempDir();
  const heard = listen();
  try {
    const registry = new ArkClusterRegistry(dir);
    registry.upsert({ id: 'gen1', envPrefix: 'ARK_GEN1', name: 'Genesis', mapName: 'Genesis Part 1', enabled: true });
    registry.updateRuntime('gen1', { state: 'online', playerCount: 2, lastCheckedAt: '2026-09-29T00:00:00.000Z' });
    registry.remove('gen1');
    const hosted = new HostedServerStore({ filePath: path.join(dir, 'hosted.json') });
    const added = hosted.add({ game: 'Valheim', serverType: 'dedicated', name: 'Meadows', host: 'vh.example', port: 2456, joinInfo: 'vh.example:2456', public: true });
    hosted.update(added.id, { playerCount: 1 });
    hosted.remove(added.id);
    assert.deepEqual(heard.reasons, ['ark-add', 'ark-remove', 'hosted-add', 'hosted-remove']);
  } finally {
    heard.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
