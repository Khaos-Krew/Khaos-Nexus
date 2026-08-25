'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');
const { sanitizeConnection, MAX_TRACKED_SERVERS_PER_MODULE } = require('../src/shared/provider-sync.cjs');
const { trackedServers, trackedServersResponse } = require('../src/backend/tracked-servers.cjs');
const {
  GAME_SERVERS_PANEL_MARKER,
  GAME_SERVERS_PANEL_TITLE,
  ensureGameServersChannel,
  renderGameServersPanel,
  panelPayloadMatches,
  reconcileGameServersPanel
} = require('../src/sentinel/game-servers-panel.cjs');

function category(id, name = 'INFORMATION') {
  return { id, name, type: ChannelType.GuildCategory };
}

function textChannel(id, name, parentId = '') {
  return { id, name, parentId, type: ChannelType.GuildText, isTextBased: () => true };
}

function fakeMessage(id, createdTimestamp, authorId = 'sentinal') {
  const state = { edits: 0, deletes: 0, pins: 0 };
  return {
    id,
    createdTimestamp,
    author: { id: authorId, bot: true },
    pinned: false,
    embeds: [{ title: GAME_SERVERS_PANEL_TITLE, footer: { text: GAME_SERVERS_PANEL_MARKER } }],
    edit: async () => { state.edits += 1; },
    delete: async () => { state.deletes += 1; },
    pin: async () => { state.pins += 1; },
    state
  };
}

test('provider sync accepts multiple tracked servers using the template server schema', () => {
  const template = {
    servers: [{
      name: 'ARK Server', host: '', port: 0, passwordEnv: 'NEXUS_ARK_RCON_PASSWORD',
      restartOnExit: false, restartCommand: '', backupPath: '', mods: []
    }]
  };
  const result = sanitizeConnection({
    servers: [
      { name: 'Ragnarok', host: 'ark-one.internal', port: 27020, mods: ['1'] },
      { name: 'Astraeos', host: 'ark-two.internal', port: 27021, mods: ['2'] }
    ]
  }, template);
  assert.equal(result.servers.length, 2);
  assert.equal(result.servers[0].name, 'Ragnarok');
  assert.equal(result.servers[1].name, 'Astraeos');
  assert.equal(result.servers[1].passwordEnv, 'NEXUS_ARK_RCON_PASSWORD');
  assert.ok(MAX_TRACKED_SERVERS_PER_MODULE >= 2);
});

test('tracked server inventory exposes safe public metadata but not connection details', () => {
  const runtime = {
    config: {
      modules: {
        ark: {
          enabled: true,
          connection: {
            servers: [
              { name: 'Ragnarok', host: '10.0.0.10', port: 27020, passwordEnv: 'SECRET_ENV' },
              { name: 'Astraeos', host: '10.0.0.11', port: 27021, passwordEnv: 'SECRET_ENV' }
            ]
          }
        },
        palworld: {
          enabled: true,
          connection: { host: 'pal.internal', port: 8212, passwordEnv: 'PAL_SECRET' }
        },
        minecraft: {
          enabled: true,
          connection: { servers: [{ name: 'Not Configured', host: '', port: 0, passwordEnv: 'MC_SECRET' }] }
        }
      }
    },
    manifests: () => [
      { id: 'ark', configured: true, connected: true, providerKind: 'ark-rcon-cluster' },
      { id: 'palworld', configured: true, connected: true, providerKind: 'palworld-rest' },
      { id: 'minecraft', configured: false, connected: false, providerKind: 'none' }
    ]
  };

  const servers = trackedServers(runtime);
  assert.equal(servers.length, 3);
  assert.deepEqual(servers.map((server) => server.name), ['Astraeos', 'Ragnarok', 'Palworld']);
  const serialized = JSON.stringify(trackedServersResponse(runtime));
  assert.equal(serialized.includes('10.0.0.10'), false);
  assert.equal(serialized.includes('27020'), false);
  assert.equal(serialized.includes('SECRET_ENV'), false);
  assert.equal(serialized.includes('PAL_SECRET'), false);
});

test('game-servers channel is created under INFORMATION when missing', async () => {
  const info = category('info');
  const created = textChannel('servers', 'game-servers', info.id);
  let createOptions = null;
  const guild = {
    channels: {
      fetch: async () => new Map([[info.id, info]]),
      create: async (options) => { createOptions = options; return created; }
    }
  };
  const result = await ensureGameServersChannel(guild);
  assert.equal(result.created, true);
  assert.equal(result.channel.id, 'servers');
  assert.equal(createOptions.parent, info.id);
  assert.equal(createOptions.name, 'game-servers');
});

test('game server panel groups tracked servers without exposing endpoints', () => {
  const payload = renderGameServersPanel({
    generatedAt: '2026-08-24T22:24:00.000Z',
    servers: [
      { moduleId: 'ark', game: 'ARK: Survival Ascended', name: 'Ragnarok', providerConfigured: true },
      { moduleId: 'ark', game: 'ARK: Survival Ascended', name: 'Astraeos', providerConfigured: true },
      { moduleId: 'palworld', game: 'Palworld', name: 'Palworld', providerConfigured: false }
    ]
  });
  const embed = payload.embeds[0];
  assert.equal(embed.title, GAME_SERVERS_PANEL_TITLE);
  assert.equal(embed.footer.text, GAME_SERVERS_PANEL_MARKER);
  assert.equal(embed.fields[0].name, 'ARK: Survival Ascended');
  assert.match(embed.fields[0].value, /Ragnarok/);
  assert.match(embed.fields[0].value, /Astraeos/);
  assert.match(embed.fields[1].value, /provider setup needed/);
  assert.match(embed.fields.at(-1).value, /automatically checked/i);
  assert.equal(embed.timestamp, undefined);
  assert.equal(JSON.stringify(payload).includes('host'), false);
  assert.equal(JSON.stringify(payload).includes('password'), true); // privacy explanation uses the word; no secret value exists.
});

test('game server panel is stable when only backend generatedAt changes', () => {
  const first = renderGameServersPanel({ generatedAt: '2026-08-24T22:24:00.000Z', servers: [] });
  const later = renderGameServersPanel({ generatedAt: '2026-08-25T01:24:00.000Z', servers: [] });
  assert.deepEqual(first, later);
});

test('game server reconciliation reuses newest canonical panel and removes duplicates', async () => {
  const old = fakeMessage('old', 100);
  const current = fakeMessage('current', 200);
  const other = fakeMessage('other', 300, 'other-bot');
  const channel = {
    client: { user: { id: 'sentinal' } },
    messages: { fetch: async () => new Map([[old.id, old], [current.id, current], [other.id, other]]) }
  };
  const payload = renderGameServersPanel({ servers: [] });
  const result = await reconcileGameServersPanel(channel, payload, { botId: 'sentinal' });
  assert.equal(result.message.id, 'current');
  assert.equal(result.updated, true);
  assert.equal(current.state.edits, 1);
  assert.equal(current.state.pins, 1);
  assert.equal(old.state.deletes, 1);
  assert.equal(other.state.deletes, 0);
  assert.equal(result.duplicatesRemoved, 1);
});

test('game server registry skips Discord edits when tracked-server state is unchanged', async () => {
  const payload = renderGameServersPanel({ servers: [] });
  let edits = 0;
  const message = {
    id: 'current',
    createdTimestamp: 200,
    author: { id: 'sentinal', bot: true },
    pinned: true,
    content: '',
    embeds: payload.embeds.map((embed) => ({ toJSON: () => embed })),
    edit: async () => { edits += 1; }
  };
  const channel = {
    client: { user: { id: 'sentinal' } },
    messages: { fetch: async () => new Map([[message.id, message]]) }
  };
  assert.equal(panelPayloadMatches(message, payload), true);
  const result = await reconcileGameServersPanel(channel, payload, { botId: 'sentinal' });
  assert.equal(result.updated, false);
  assert.equal(edits, 0);
});
