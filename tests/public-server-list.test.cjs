'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PermissionFlagsBits } = require('discord.js');
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
    const ark = rows.find((row) => row.name === 'Genesis Part 1');
    assert.equal(ark.game, 'ARK: Survival Ascended');
    assert.equal(ark.status, 'Online');
    assert.equal(ark.players, '3');
    assert.match(ark.joins[0], /In-game server list: Genesis Part 1/);
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

test('server list setup stores the channel and refuses to invent one', async () => {
  const command = serverListCommand().toJSON();
  assert.equal(command.name, 'serverlist');
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

    const replies = [];
    await handleServerListCommand({
      commandName: 'serverlist',
      isChatInputCommand: () => true,
      memberPermissions: { has: (bit) => bit === PermissionFlagsBits.Administrator },
      options: { getSubcommand: () => 'setup', getChannel: () => ({ id: CHANNEL }) },
      reply: async (payload) => replies.push(payload)
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
    assert.match(replies[0].content, /same message/);

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
