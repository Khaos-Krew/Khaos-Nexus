'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  RustWebRconClient,
  rustWebRconUrl,
  normalizeRustServerInfo,
  normalizeRustPlayers,
  safeRustArgument,
  steam64,
  rawCommand
} = require('../bot/rust-webrcon.cjs');
const { ServerConnection, isRustWebRcon } = require('../bot/server-client.cjs');
const { capabilityMapForServer, manifestForServer, createCurrentServerAdapter } = require('../bot/game-adapters/current-server-adapter.cjs');
const { executeAdapterOperation } = require('../shared/game-adapter-sdk.cjs');
const { normalizeRustPlayers: normalizeConsoleRustPlayers } = require('../shared/player-console.cjs');
const { catalog, moduleDecisionForChannel, defaultModuleStates, buildModuleRuntime } = require('../shared/module-registry.cjs');

function webSocketMock(handler) {
  return class MockWebSocket {
    static instances = [];

    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.listeners = new Map();
      MockWebSocket.instances.push(this);
      queueMicrotask(() => {
        this.readyState = 1;
        this.emit('open', {});
      });
    }

    addEventListener(event, listener) {
      const list = this.listeners.get(event) || [];
      list.push(listener);
      this.listeners.set(event, list);
    }

    removeEventListener(event, listener) {
      const list = this.listeners.get(event) || [];
      this.listeners.set(event, list.filter((entry) => entry !== listener));
    }

    emit(event, value, extra) {
      for (const listener of this.listeners.get(event) || []) listener(value, extra);
    }

    send(value) {
      handler(this, JSON.parse(value));
    }

    close(code = 1000, reason = '') {
      this.readyState = 3;
      this.emit('close', { code, reason });
    }
  };
}

const server = {
  id: 'rust-1',
  name: 'Khaos Rust',
  game: 'rust',
  host: '127.0.0.1',
  port: 28016,
  password: 'p@ss word/secret',
  protocol: 'ws',
  connectionType: 'webrcon'
};

test('Rust WebRCON URL encodes the password and validates endpoints', () => {
  assert.equal(rustWebRconUrl(server), 'ws://127.0.0.1:28016/p%40ss%20word%2Fsecret');
  assert.throws(() => rustWebRconUrl({ ...server, host: 'ws://127.0.0.1:28016' }), /only the Rust server host/i);
  assert.throws(() => rustWebRconUrl({ ...server, port: 70000 }), /between 1 and 65535/i);
});

test('Rust WebRCON matches response identifiers and ignores unsolicited packets', async () => {
  let request;
  const MockWebSocket = webSocketMock((socket, sent) => {
    request = sent;
    socket.emit('message', { data: JSON.stringify({ Identifier: sent.Identifier + 1, Message: 'unsolicited', Type: 'Generic', Stacktrace: '' }) });
    socket.emit('message', { data: JSON.stringify({
      Identifier: sent.Identifier,
      Message: JSON.stringify({ Hostname: 'Khaos Rust', Players: 3, MaxPlayers: 100, Queued: 2, Framerate: 59.9, Uptime: 3600 }),
      Type: 'Generic',
      Stacktrace: ''
    }) });
  });
  const client = new RustWebRconClient(server, { WebSocketImpl: MockWebSocket, timeoutMs: 1000 });
  const result = await client.action('status');
  assert.equal(request.Message, 'serverinfo');
  assert.equal(request.Name, 'Khaos Nexus');
  assert.equal(result.serverName, 'Khaos Rust');
  assert.equal(result.players, 3);
  assert.equal(result.maxPlayers, 100);
  assert.equal(result.queued, 2);
  assert.equal(result.fps, 59.9);
});

test('Rust playerlist JSON normalizes Steam64 players without IP addresses', async () => {
  const players = [
    { SteamID: '76561198000000001', DisplayName: 'Kirito', Ping: 42, Address: '192.0.2.50:1234', ConnectedSeconds: 125 },
    { SteamID: 'invalid', DisplayName: 'Invalid' }
  ];
  const MockWebSocket = webSocketMock((socket, sent) => {
    socket.emit('message', { data: JSON.stringify({ Identifier: sent.Identifier, Message: JSON.stringify(players), Type: 'Generic', Stacktrace: '' }) });
  });
  const client = new RustWebRconClient(server, { WebSocketImpl: MockWebSocket, timeoutMs: 1000 });
  const result = await client.action('players');
  assert.equal(result.players.length, 1);
  assert.deepEqual(result.players[0], {
    name: 'Kirito',
    identifier: '76561198000000001',
    steamId: '76561198000000001',
    ping: 42,
    connectedSeconds: 125,
    violationLevel: null,
    health: null,
    accountType: 'Steam'
  });
  assert.equal(JSON.stringify(result).includes('192.0.2.50'), false);
  assert.equal(normalizeRustPlayers(players).length, 1);
  assert.equal(normalizeConsoleRustPlayers({ players }).length, 1);
});

test('Rust typed commands reject command injection and invalid Steam IDs', () => {
  assert.equal(safeRustArgument('Maintenance soon', 'Message'), '"Maintenance soon"');
  assert.throws(() => safeRustArgument('hello; quit', 'Message'), /semicolons/i);
  assert.throws(() => safeRustArgument('hello\nquit', 'Message'), /line breaks/i);
  assert.equal(steam64('76561198000000001'), '76561198000000001');
  assert.throws(() => steam64('Kirito'), /Steam64/i);
  assert.equal(rawCommand('serverinfo'), 'serverinfo');
  assert.throws(() => rawCommand('serverinfo\nquit'), /single line/i);
});

test('Rust transport errors redact the protected password and support cancellation', async () => {
  const ClosingWebSocket = webSocketMock((socket) => socket.close(1008, `invalid password ${server.password}`));
  const client = new RustWebRconClient(server, { WebSocketImpl: ClosingWebSocket, timeoutMs: 1000 });
  await assert.rejects(() => client.action('status'), (error) => {
    assert.equal(error.code, 'AUTH_FAILED');
    assert.equal(error.message.includes(server.password), false);
    assert.match(error.message, /rejected/i);
    return true;
  });

  const controller = new AbortController();
  controller.abort();
  const IdleWebSocket = webSocketMock(() => {});
  const cancelled = new RustWebRconClient(server, { WebSocketImpl: IdleWebSocket, timeoutMs: 1000 });
  await assert.rejects(() => cancelled.action('status', {}, { signal: controller.signal }), (error) => error.code === 'CANCELLED');
});

test('Rust adapter advertises only implemented vanilla-safe capabilities', async () => {
  assert.equal(isRustWebRcon(server), true);
  const capabilities = capabilityMapForServer(server);
  for (const capability of ['status', 'info', 'players', 'announce', 'save', 'kick', 'ban', 'unban', 'shutdown', 'stop', 'raw']) {
    assert.equal(capabilities[capability], true, `${capability} should be advertised`);
  }
  assert.equal(capabilities.metrics, undefined);
  assert.equal(manifestForServer(server).transport, 'rust-webrcon');

  const calls = [];
  const adapter = createCurrentServerAdapter(server, {
    connectionFactory: () => ({ action: async (action, payload) => { calls.push({ action, payload }); return { players: [] }; } })
  });
  const result = await executeAdapterOperation(adapter, 'players', {}, { role: 'viewer', explicitSecrets: [server.password] });
  assert.equal(result.ok, true);
  assert.equal(calls[0].action, 'players');
});

test('ServerConnection delegates Rust operations to the WebRCON client', async () => {
  const MockWebSocket = webSocketMock((socket, sent) => {
    socket.emit('message', { data: JSON.stringify({ Identifier: sent.Identifier, Message: 'Saved', Type: 'Generic', Stacktrace: '' }) });
  });
  const connection = new ServerConnection(server, { rust: { WebSocketImpl: MockWebSocket, timeoutMs: 1000 } });
  assert.equal(await connection.action('save'), 'Saved');
  assert.equal(MockWebSocket.instances.length, 1);
});

test('Rust module is implemented, dependency-aware, and gates operations without hiding repair configuration', () => {
  const module = catalog().find((item) => item.id === 'rust-server-operations');
  assert.equal(module.availability, 'implemented');
  assert.deepEqual(module.dependencies, ['game-server-control']);

  const states = defaultModuleStates();
  states['rust-server-operations'].enabled = true;
  states['game-server-control'].enabled = false;
  const runtime = buildModuleRuntime(states);
  assert.equal(runtime['rust-server-operations'].effectiveEnabled, false);
  assert.deepEqual(runtime['rust-server-operations'].blockedBy, ['game-server-control']);

  assert.deepEqual(moduleDecisionForChannel('server:rust-action'), { allOf: ['rust-server-operations'] });
  assert.deepEqual(moduleDecisionForChannel('server:save', [{ server: { game: 'rust' } }]), { allOf: ['game-server-control'] });
});

test('Rust integration source retains UI, scheduler, player, status-panel and Discord boundaries', () => {
  const root = path.join(__dirname, '..');
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  assert.match(read('main/entry.cjs'), /rust-main-extension\.cjs/);
  assert.match(read('main/rust-main-extension.cjs'), /patchSchedulerService/);
  assert.match(read('main/rust-main-extension.cjs'), /RUN RAW COMMAND/);
  assert.match(read('renderer/rust-webrcon-ui.js'), /Rust WebRCON Operations/);
  assert.match(read('renderer/rust-webrcon-ui.js'), /rcon\.web 1/);
  assert.match(read('main/services/status-panel-service.cjs'), /Rust WebRCON/);
  assert.match(read('main/services/player-console-service.cjs'), /rust-server-operations/);
  assert.match(read('bot/index.cjs'), /rust-server-operations/);
  assert.match(read('bot/commands.cjs'), /Steam64 ID/);
});