'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeStatusPanel,
  normalizeStatusPanelsConfig,
  parseStatusButtonId,
  validateStatusPanelPayload,
  renderStatusPanel,
  dueForRefresh
} = require('../shared/status-panels.cjs');
const { StatusPanelService, discordError, parseRconPlayers } = require('../main/services/status-panel-service.cjs');

test('status panel normalization bounds refresh and strips invalid Discord IDs', () => {
  const panel = normalizeStatusPanel({
    id: 'primary-panel', name: '  Main Status  ', guildId: 'not-an-id', channelId: '1234567890',
    messageId: '123', refreshMinutes: 999, color: 'FF0044', title: '', description: '', showPlayerNames: true
  });
  assert.equal(panel.id, 'primary-panel');
  assert.equal(panel.name, 'Main Status');
  assert.equal(panel.guildId, '');
  assert.equal(panel.channelId, '1234567890');
  assert.equal(panel.messageId, '');
  assert.equal(panel.refreshMinutes, 60);
  assert.equal(panel.color, '#ff0044');
  assert.equal(panel.title, 'Server Status');
  assert.equal(panel.showPlayerNames, true);
});

test('status panel config deduplicates IDs and buttons parse safely', () => {
  const config = normalizeStatusPanelsConfig({ panels: [
    { id: 'same', name: 'First' },
    { id: 'same', name: 'Second' }
  ] });
  assert.equal(config.panels.length, 1);
  assert.deepEqual(parseStatusButtonId('kn-status:refresh:same'), { action: 'refresh', panelId: 'same' });
  assert.equal(parseStatusButtonId('kn-status:restart:same'), null);
});

test('rendered status panel exposes names only when privacy option is enabled', () => {
  const snapshot = {
    status: 'online', serverName: 'Nexus Palworld', game: 'palworld', connectionLabel: 'Palworld REST',
    players: 2, maxPlayers: 16, playerNames: [
      { name: 'Kirito', userId: 'private-user-id', ip: '192.0.2.1' },
      { accountName: 'Asuna', playerId: 'private-player-id' }
    ], checkedAt: '2026-07-24T12:00:00.000Z'
  };
  const privatePayload = renderStatusPanel({ id: 'panel', showPlayerNames: false }, snapshot);
  const privateText = JSON.stringify(privatePayload);
  assert.doesNotMatch(privateText, /Kirito|Asuna|private-user-id|192\.0\.2\.1/);
  assert.match(privateText, /2 \/ 16/);

  const publicPayload = renderStatusPanel({ id: 'panel', showPlayerNames: true }, snapshot);
  const publicText = JSON.stringify(publicPayload);
  assert.match(publicText, /Kirito/);
  assert.match(publicText, /Asuna/);
  assert.doesNotMatch(publicText, /private-user-id|private-player-id|192\.0\.2\.1/);
});

test('status panel buttons use validated Discord emoji instead of the rejected text glyph', () => {
  const payload = renderStatusPanel({ id: 'palworld-panel' }, {
    status: 'online', serverName: 'Nexus Palworld', game: 'palworld', connectionLabel: 'Palworld REST'
  });
  assert.equal(payload.components[0].components[0].emoji.name, '🔄');
  assert.equal(payload.components[0].components[1].emoji.name, '👥');
  assert.doesNotThrow(() => validateStatusPanelPayload(payload));
  assert.doesNotMatch(JSON.stringify(payload), /↻/);
});

test('status panel payload validation rejects a text symbol before Discord is called', () => {
  assert.throws(
    () => validateStatusPanelPayload({
      components: [{
        type: 1,
        components: [{ type: 2, style: 1, label: 'Refresh', custom_id: 'kn-status:refresh:panel', emoji: { name: '↻' } }]
      }]
    }),
    (error) => error.code === 'STATUS_PANEL_PAYLOAD_INVALID' && error.field === 'components[0].components[0].emoji.name'
  );
});

test('status panel payload validation reports malformed action rows precisely', () => {
  assert.throws(
    () => validateStatusPanelPayload({ components: [[{ type: 2, style: 1, label: 'Refresh', custom_id: 'kn-status:refresh:panel' }]] }),
    (error) => error.code === 'STATUS_PANEL_PAYLOAD_INVALID' && error.field === 'components[0]'
  );
});

test('Discord invalid-form errors map to a redacted status-panel field path', () => {
  const error = discordError({
    code: 50035,
    status: 400,
    rawError: {
      message: 'Invalid Form Body',
      errors: {
        components: { 0: { components: { 0: { emoji: { name: { _errors: [{ code: 'COMPONENT_INVALID_EMOJI', message: 'Invalid emoji' }] } } } } } }
      }
    }
  });
  assert.equal(error.code, 'STATUS_PANEL_PAYLOAD_REJECTED');
  assert.equal(error.field, 'components.0.components.0.emoji.name');
  assert.match(error.message, /components\.0\.components\.0\.emoji\.name/);
  assert.doesNotMatch(error.message, /token|password|secret/i);
});

test('status panel send boundary refuses invalid payloads without a REST call', async () => {
  let posts = 0;
  const service = new StatusPanelService({
    configStore: { getRuntimeBootstrap: () => ({ discordToken: 'token', config: { discord: {}, servers: [] } }) },
    restFactory: () => ({ post: async () => { posts += 1; return { id: 'message' }; } })
  });
  await assert.rejects(
    () => service.sendMessage('222222', {
      components: [{ type: 1, components: [{ type: 2, style: 1, label: 'Refresh', custom_id: 'kn-status:refresh:panel', emoji: { name: '↻' } }] }]
    }),
    (error) => error.code === 'STATUS_PANEL_PAYLOAD_INVALID'
  );
  assert.equal(posts, 0);
});

test('automatic refresh only runs for enabled published panels that are due', () => {
  const now = new Date('2026-07-24T12:10:00.000Z').getTime();
  assert.equal(dueForRefresh({ enabled: true, channelId: '123456', messageId: '654321', refreshMinutes: 5, lastRefreshedAt: '2026-07-24T12:00:00.000Z' }, now), true);
  assert.equal(dueForRefresh({ enabled: true, channelId: '123456', messageId: '654321', refreshMinutes: 15, lastRefreshedAt: '2026-07-24T12:00:00.000Z' }, now), false);
  assert.equal(dueForRefresh({ enabled: false, channelId: '123456', messageId: '654321' }, now), false);
  assert.equal(dueForRefresh({ enabled: true, channelId: '', messageId: '' }, now), false);
});

test('RCON player parsing returns names without platform identifiers', () => {
  assert.deepEqual(parseRconPlayers('0. Kirito, 76561198000000001\n1. Asuna, 76561198000000002'), ['Kirito', 'Asuna']);
  assert.deepEqual(parseRconPlayers('No Players Connected'), []);
});

test('status panel service publishes and refreshes a persistent public-safe Palworld message', async () => {
  const calls = [];
  const rest = {
    get: async () => [{ id: '222222', name: 'server-status', type: 0, position: 1 }],
    post: async (route, body) => { calls.push({ method: 'post', route, body }); return { id: '333333' }; },
    patch: async (route, body) => { calls.push({ method: 'patch', route, body }); return { id: '333333' }; },
    delete: async () => {}
  };
  const configStore = {
    getRuntimeBootstrap: () => ({
      discordToken: 'token',
      config: {
        discord: { guildId: '111111' },
        servers: [{ id: 'pal-1', name: 'Nexus Palworld', game: 'palworld', connectionType: 'rest', host: '127.0.0.1', port: 8212, password: 'secret' }]
      }
    })
  };
  const service = new StatusPanelService({
    configStore,
    restFactory: () => rest,
    connectionFactory: () => ({ action: async (action) => action === 'status'
      ? { info: { servername: 'Nexus Palworld', version: 'v1.0' }, metrics: { currentplayernum: 1, maxplayernum: 16, serverfps: 60, uptime: 600 } }
      : { players: [{ name: 'Kirito', userId: 'private-id', ip: '192.0.2.10' }] } }),
    now: () => new Date('2026-07-24T12:00:00.000Z')
  });

  const result = await service.publish({
    id: 'pal-status', name: 'Palworld', serverId: 'pal-1', guildId: '111111', channelId: '222222',
    title: 'Palworld Status', showPlayerNames: false, refreshMinutes: 5
  });
  assert.equal(result.messageId, '333333');
  assert.equal(result.snapshot.status, 'online');
  assert.equal(calls[0].method, 'post');
  const sent = JSON.stringify(calls[0].body);
  assert.match(sent, /Palworld Status/);
  assert.match(sent, /1 \/ 16/);
  assert.match(sent, /🔄/);
  assert.doesNotMatch(sent, /↻/);
  assert.doesNotMatch(sent, /private-id|192\.0\.2\.10|secret/);

  await service.refresh({
    id: 'pal-status', name: 'Palworld', serverId: 'pal-1', guildId: '111111', channelId: '222222', messageId: '333333',
    title: 'Palworld Status', showPlayerNames: false, refreshMinutes: 5
  });
  assert.equal(calls[1].method, 'patch');
  assert.doesNotThrow(() => validateStatusPanelPayload(calls[1].body.body));
});
