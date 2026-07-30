'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  RustWebRconClient,
  rustWebRconUrl,
  normalizeRustPlayers,
  safeRustArgument,
  steam64,
  rawCommand,
  redactRustError
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

test('Rust WebRCON URL encodes passwords, supports IPv6 and rejects combined endpoints', () => {
  assert.equal(rustWebRconUrl(server), 'ws://127.0.0.1:28016/p%40ss%20word%2Fsecret');
  assert.equal(rustWebRconUrl({ ...server, host: '::1' }), 'ws://[::1]:28016/p%40ss%20word%2Fsecret');
  assert.equal(rustWebRconUrl({ ...server, host: '[::1]' }), 'ws://[::1]:28016/p%40ss%20word%2Fsecret');
  assert.throws(() => rustWebRconUrl({ ...server, host: 'ws://127.0.0.1:28016' }), /only the Rust server host/i);
  assert.throws(() => rustWebRconUrl({ ...server, host: 'rust.example.com:28016' }), /separate port field/i);
  assert.throws(() => rustWebRconUrl({ ...server, host: '[::1]:28016' }), /separate port field/i);
  assert.throws(() => rustWebRconUrl({ ...server, port: 70000 }), /between 1 and 65535/i);
});

test('Rust error redaction removes raw, encoded and URL-embedded passwords', () => {
  const url = rustWebRconUrl(server);
  const result = redactRustError(new Error(`Unable to connect to ${url}; password=${server.password}`), server.password);
  assert.equal(result.message.includes(server.password), false);
  assert.equal(result.message.includes(encodeURIComponent(server.password)), false);
  assert.match(result.message, /\[REDACTED\]/);
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
    connectionFactory: () => ({ action: async (action, payload, options) => { calls.push({ action, payload, options }); return { players: [] }; } })
  });
  const result = await executeAdapterOperation(adapter, 'players', {}, { role: 'viewer', explicitSecrets: [server.password] });
  assert.equal(result.ok, true);
  assert.equal(calls[0].action, 'players');
  assert.deepEqual(calls[0].payload, {});
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test('ServerConnection delegates typed and legacy-compatible Rust operations', async () => {
  const commands = [];
  const MockWebSocket = webSocketMock((socket, sent) => {
    commands.push(sent.Message);
    const message = sent.Message === 'serverinfo'
      ? JSON.stringify({ Hostname: 'Khaos Rust', Players: 1, MaxPlayers: 100 })
      : sent.Message === 'playerlist'
        ? JSON.stringify([{ SteamID: '76561198000000001', DisplayName: 'Kirito', Ping: 30 }])
        : 'Saved';
    socket.emit('message', { data: JSON.stringify({ Identifier: sent.Identifier, Message: message, Type: 'Generic', Stacktrace: '' }) });
  });
  const connection = new ServerConnection(server, { rust: { WebSocketImpl: MockWebSocket, timeoutMs: 1000 } });
  assert.equal(await connection.action('save'), 'Saved');
  assert.match(await connection.execute('status'), /Khaos Rust/);
  assert.match(await connection.execute('list'), /Kirito/);
  assert.deepEqual(commands, ['save', 'serverinfo', 'playerlist']);
});

test('Rust graceful shutdown saves first and accepts the expected quit disconnect', async () => {
  const commands = [];
  const MockWebSocket = webSocketMock((socket, sent) => {
    commands.push(sent.Message);
    if (sent.Message === 'save') {
      socket.emit('message', { data: JSON.stringify({ Identifier: sent.Identifier, Message: 'Saved', Type: 'Generic', Stacktrace: '' }) });
    } else {
      socket.close(1001, 'server shutting down');
    }
  });
  const client = new RustWebRconClient(server, { WebSocketImpl: MockWebSocket, timeoutMs: 1000 });
  const result = await client.action('shutdown');
  assert.deepEqual(commands, ['save', 'quit']);
  assert.match(result, /save completed and shutdown/i);
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

test('Rust integration retains unique UI and shutdown behavior while shared runtime owns health and maintenance', () => {
  const root = path.join(__dirname, '..');
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const rustMain = read('main/rust-main-extension.cjs');
  const rustGate = read('main/rust-module-gate-extension.cjs');
  const sharedRuntime = read('main/game-adapter-runtime-extension.cjs');
  assert.match(read('main/entry.cjs'), /rust-main-extension\.cjs/);
  assert.match(rustMain, /RUN RAW COMMAND/);
  assert.doesNotMatch(rustMain, /patchSchedulerService|filterRustWhenDisabled|async checkServers|async runMaintenance|autonomyCommand|rustAutonomyConnection/);
  assert.match(rustGate, /patchSchedulerShutdown/);
  assert.doesNotMatch(rustGate, /function wrap\(|checkServers|runMaintenance/);
  assert.match(sharedRuntime, /assertModule\('operator-console', 'Run game-server health checks'/);
  assert.match(sharedRuntime, /assertModule\('operator-console', 'Run Maintenance Mode'/);
  assert.match(read('renderer/rust-webrcon-ui.js'), /Rust WebRCON Operations/);
  assert.match(read('renderer/rust-webrcon-ui.js'), /rcon\.web 1/);
  assert.match(read('main/services/status-panel-service.cjs'), /Rust WebRCON/);
  assert.match(read('main/services/player-console-service.cjs'), /game-module-policy\.cjs/);
  assert.match(read('shared/game-module-policy.cjs'), /rust-server-operations/);
  assert.match(read('bot/index.cjs'), /moduleForServer/);
  assert.match(read('bot/commands.cjs'), /Steam64 ID/);
});