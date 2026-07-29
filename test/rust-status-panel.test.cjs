'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BaseGameAdapter } = require('../shared/game-adapter-sdk.cjs');
const { normalizeStatusSnapshot, renderStatusPanel } = require('../shared/status-panels.cjs');
const { StatusPanelService } = require('../main/services/status-panel-service.cjs');

const rustServer = {
  id: 'rust-panel-server',
  name: 'Khaos Rust',
  game: 'rust',
  enabled: true,
  connectionType: 'webrcon',
  protocol: 'ws',
  host: '127.0.0.1',
  port: 28016,
  password: 'protected'
};

function service(moduleEnabled = true) {
  const bootstrap = {
    config: {
      discord: { guildId: '1234567890' },
      moduleRuntime: { 'rust-server-operations': { effectiveEnabled: moduleEnabled } },
      servers: [rustServer]
    },
    discordToken: 'token'
  };
  const adapter = new BaseGameAdapter({
    manifest: {
      adapterId: 'rust-panel-adapter',
      gameId: 'rust',
      displayName: 'Rust WebRCON',
      transport: 'rust-webrcon',
      capabilities: { status: true, players: true }
    },
    operations: {
      status: async () => ({
        serverName: 'Khaos Rust', players: 4, maxPlayers: 100, queued: 3, joining: 1,
        entityCount: 125000, map: 'Procedural Map', fps: 59.8, uptimeSeconds: 7200, version: 'protocol-2571'
      }),
      players: async () => ({ players: [{ name: 'Kirito', identifier: '76561198000000001' }] })
    }
  });
  return new StatusPanelService({
    configStore: { getRuntimeBootstrap: () => bootstrap },
    adapterFactory: () => adapter,
    now: () => new Date('2026-07-29T22:00:00.000Z')
  });
}

test('Rust status snapshots retain queue, joining, map and entity data', async () => {
  const snapshot = await service().snapshot({ id: 'rust-panel', serverId: rustServer.id, showPlayerNames: true });
  assert.equal(snapshot.connectionLabel, 'Rust WebRCON');
  assert.equal(snapshot.players, 4);
  assert.equal(snapshot.maxPlayers, 100);
  assert.equal(snapshot.queued, 3);
  assert.equal(snapshot.joining, 1);
  assert.equal(snapshot.entityCount, 125000);
  assert.equal(snapshot.map, 'Procedural Map');
  assert.deepEqual(snapshot.playerNames, ['Kirito']);
});

test('Rust public status embed renders the extended serverinfo fields', () => {
  const snapshot = normalizeStatusSnapshot({
    status: 'online', serverName: 'Khaos Rust', game: 'rust', connectionLabel: 'Rust WebRCON',
    players: 4, maxPlayers: 100, queued: 3, joining: 1, entityCount: 125000,
    map: 'Procedural Map', fps: 59.8, uptimeSeconds: 7200
  });
  const payload = renderStatusPanel({ id: 'rust-panel', title: 'Rust Status' }, snapshot, { includeButtons: false });
  const fields = Object.fromEntries(payload.embeds[0].fields.map((field) => [field.name, field.value]));
  assert.equal(fields.Queued, '3');
  assert.equal(fields.Joining, '1');
  assert.equal(fields.Map, 'Procedural Map');
  assert.equal(fields.Entities, '125000');
  assert.equal(fields['Server FPS'], '59.8');
  assert.equal(fields.Uptime, '2h 0m');
});

test('Rust status panels stop immediately when the Owner disables the module', async () => {
  await assert.rejects(
    () => service(false).snapshot({ id: 'rust-panel', serverId: rustServer.id }),
    /disabled by the Khaos Nexus owner/i
  );
});