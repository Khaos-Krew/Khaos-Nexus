'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DiscordStudioService } = require('../main/services/discord-studio-service.cjs');

function fixture(options = {}) {
  const calls = [];
  const studio = {
    templates: [{ id: 'default-server-status', name: 'Status', kind: 'server-status', title: '{{server.name}}', description: '{{status.summary}}', color: '#e3264f', useStatusColor: true, timestamp: true, fields: [], buttons: [] }],
    panels: [{ id: 'panel-one', name: 'Panel', serverId: 'server-one', guildId: '1234567890', channelId: '2234567890', messageId: options.messageId || '', templateId: 'default-server-status', enabled: true, refreshSeconds: 300, includePlayers: true, includeMetrics: true, publishedAt: null }]
  };
  const configStore = {
    getRuntimeBootstrap() {
      return { discordToken: 'token', config: { discord: { guildId: '1234567890' }, servers: [{ id: 'server-one', name: 'Nexus Palworld', game: 'palworld', connectionType: 'rest', host: 'private-host', port: 8212, password: 'secret', enabled: true }] } };
    },
    getDiscordStudio() { return JSON.parse(JSON.stringify(studio)); },
    getConfig() { return { discordStudio: studio }; },
    setDiscordPanelPublication(id, patch) { Object.assign(studio.panels.find((panel) => panel.id === id), patch); calls.push(['publication', id, patch]); }
  };
  const rest = {
    async get(route) { calls.push(['get', route]); return [{ id: '2234567890', name: 'server-status', type: 0, position: 1 }, { id: '3234567890', name: 'voice', type: 2, position: 2 }]; },
    async post(route, request) { calls.push(['post', route, request.body]); return { id: 'message-new' }; },
    async patch(route, request) { calls.push(['patch', route, request.body]); return { id: options.messageId || 'message-existing' }; },
    async delete(route) { calls.push(['delete', route]); }
  };
  const connection = {
    async action(action) {
      calls.push(['server', action]);
      if (options.serverError) throw new Error(options.serverError);
      if (action === 'status') return { info: { version: '1.0' }, metrics: { currentplayernum: 2, maxplayernum: 32, serverfps: 60, serverframetime: 16.7, uptime: 3600 } };
      if (action === 'players') return { players: [{ name: 'Kirito', userId: 'private' }, { name: 'Asuna', userId: 'private2' }] };
      throw new Error('Unexpected action');
    }
  };
  const service = new DiscordStudioService({
    configStore,
    logger: { info() {}, warn() {}, error() {} },
    restFactory: () => rest,
    connectionFactory: () => connection,
    now: () => new Date('2026-07-23T08:00:00Z')
  });
  return { service, calls, studio };
}

test('channel discovery returns text channels only', async (t) => {
  const { service } = fixture(); t.after(() => service.stop());
  const channels = await service.listChannels();
  assert.deepEqual(channels, [{ id: '2234567890', name: 'server-status', type: 'text', parentId: '', position: 1 }]);
});

test('preview publishes a mention-safe embed', async (t) => {
  const { service, calls } = fixture(); t.after(() => service.stop());
  await service.previewTemplate('2234567890', { id: 'preview', name: 'Preview', title: 'Hello', description: '@everyone', color: '#ff0000' });
  const post = calls.find((call) => call[0] === 'post');
  assert.deepEqual(post[2].allowed_mentions, { parse: [] });
  assert.equal(post[2].embeds[0].title, 'Hello');
});

test('first status publication creates a message and stores its ID', async (t) => {
  const { service, calls, studio } = fixture(); t.after(() => service.stop());
  const result = await service.refreshPanel('panel-one');
  assert.equal(result.runtime.status, 'online');
  assert.equal(studio.panels[0].messageId, 'message-new');
  const post = calls.find((call) => call[0] === 'post');
  assert.equal(JSON.stringify(post[2]).includes('secret'), false);
  assert.equal(JSON.stringify(post[2]).includes('private-host'), false);
  assert.equal(JSON.stringify(post[2]).includes('private2'), false);
});

test('published status panel edits the existing Discord message', async (t) => {
  const { service, calls } = fixture({ messageId: '423456789012345678' }); t.after(() => service.stop());
  await service.refreshPanel('panel-one');
  assert.ok(calls.some((call) => call[0] === 'patch'));
  assert.equal(calls.some((call) => call[0] === 'post'), false);
});

test('server failures publish an offline status instead of exposing an exception', async (t) => {
  const { service, calls } = fixture({ serverError: 'Connection timed out for private-host' }); t.after(() => service.stop());
  const result = await service.refreshPanel('panel-one');
  assert.equal(result.runtime.status, 'offline');
  const post = calls.find((call) => call[0] === 'post');
  assert.equal(post[2].embeds[0].color, 0xe3264f);
  assert.match(post[2].embeds[0].description, /timed out/i);
  assert.equal(JSON.stringify(post[2]).includes('private-host'), false);
});
