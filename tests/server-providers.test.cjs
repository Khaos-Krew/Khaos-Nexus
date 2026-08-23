'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SourceRconProvider, parseArkPlayers, parseMinecraftPlayers } = require('../src/backend/providers/source-rcon-provider.cjs');
const { PalworldProvider } = require('../src/backend/providers/palworld-provider.cjs');
const { RustProvider, normalizeServerInfo, normalizePlayers } = require('../src/backend/providers/rust-provider.cjs');
const { SatisfactoryProvider, readServerState, normalizeFingerprint } = require('../src/backend/providers/satisfactory-provider.cjs');
const { configuredConnection } = require('../src/backend/providers/server-providers.cjs');

function mockRcon(responses = {}) {
  const commands = [];
  return {
    commands,
    client: {
      async execute(command) {
        commands.push(command);
        return responses[command] ?? 'OK';
      }
    }
  };
}

test('ARK RCON provider maps proven status players save and broadcast commands', async () => {
  const mock = mockRcon({ ListPlayers: '1. Alice, 76561190000000001\n2. Bob, 76561190000000002' });
  const provider = new SourceRconProvider('ark', {}, { client: mock.client });
  const players = await provider.invoke('players');
  await provider.invoke('save');
  await provider.invoke('broadcast', { input: 'Restart in 10 minutes' });
  assert.deepEqual(mock.commands, ['ListPlayers', 'SaveWorld', 'Broadcast Restart in 10 minutes']);
  assert.equal(players.count, 2);
  assert.equal(players.players[0].name, 'Alice');
  assert.deepEqual(provider.supportedActions, ['status', 'players', 'save', 'broadcast']);
});

test('Minecraft RCON provider maps list save-all and say without exposing restart/backups', async () => {
  const mock = mockRcon({ list: 'There are 2 of a max of 20 players online: Steve, Alex' });
  const provider = new SourceRconProvider('minecraft', {}, { client: mock.client });
  const status = await provider.invoke('status');
  await provider.invoke('save');
  await provider.invoke('broadcast', { input: 'Server event starting' });
  assert.equal(status.count, 2);
  assert.equal(status.maxPlayers, 20);
  assert.deepEqual(mock.commands, ['list', 'save-all flush', 'say Server event starting']);
  assert.equal(provider.supportedActions.includes('restart'), false);
  assert.equal(provider.supportedActions.includes('backups'), false);
});

test('RCON player parsers normalize common ARK and Minecraft responses', () => {
  assert.equal(parseArkPlayers('No Players Connected').length, 0);
  assert.deepEqual(parseArkPlayers('1. Kirito, 123')[0], { name: 'Kirito', id: '123' });
  assert.equal(parseMinecraftPlayers('There are 1 of a max of 10 players online: Alex').players[0].name, 'Alex');
});

test('broadcast buttons return usage instead of issuing an empty command', async () => {
  const mock = mockRcon();
  const provider = new SourceRconProvider('ark', {}, { client: mock.client });
  const result = await provider.invoke('broadcast', {});
  assert.match(result.usage, /input:<message>/);
  assert.equal(mock.commands.length, 0);
});

test('Palworld provider exposes only safe catalog actions backed by official REST calls', async () => {
  const calls = [];
  const client = {
    async info() { calls.push('info'); return { version: 'test' }; },
    async metrics() { calls.push('metrics'); return { currentplayernum: 1 }; },
    async players() { calls.push('players'); return { players: [{ name: 'Pal Tamer' }] }; },
    async save() { calls.push('save'); return { ok: true }; },
    async announce(message) { calls.push(`announce:${message}`); return { ok: true }; }
  };
  const provider = new PalworldProvider({}, { client });
  await provider.invoke('status');
  await provider.invoke('players');
  await provider.invoke('save');
  await provider.invoke('broadcast', { input: 'Hello Palpagos' });
  assert.deepEqual(calls, ['info', 'metrics', 'players', 'save', 'announce:Hello Palpagos']);
  assert.deepEqual(provider.supportedActions, ['status', 'players', 'save', 'broadcast']);
});

test('Rust provider maps serverinfo playerlist save and safe say commands', async () => {
  const commands = [];
  const client = {
    async command(command) {
      commands.push(command);
      if (command === 'serverinfo') return JSON.stringify({ Hostname: 'Nexus Rust', Players: 2, MaxPlayers: 100, Framerate: 60 });
      if (command === 'playerlist') return JSON.stringify([{ DisplayName: 'Raider', SteamID: '76561190000000001', Ping: 42 }]);
      return 'OK';
    }
  };
  const provider = new RustProvider({ name: 'Nexus Rust' }, { client });
  const status = await provider.invoke('status');
  const players = await provider.invoke('players');
  await provider.invoke('save');
  await provider.invoke('broadcast', { input: 'Cargo is up' });
  assert.equal(status.serverName, 'Nexus Rust');
  assert.equal(status.players, 2);
  assert.equal(players.players[0].name, 'Raider');
  assert.deepEqual(commands, ['serverinfo', 'playerlist', 'save', 'say "Cargo is up"']);
  assert.deepEqual(provider.supportedActions, ['status', 'players', 'save', 'broadcast']);
});

test('Rust normalizers accept common serverinfo and playerlist shapes', () => {
  assert.equal(normalizeServerInfo(JSON.stringify({ Hostname: 'Test', Players: 3 })).players, 3);
  assert.equal(normalizePlayers(JSON.stringify([{ DisplayName: 'Khaos', SteamID: '76561190000000001' }]))[0].name, 'Khaos');
});

test('Satisfactory provider exposes status players and save through HTTPS API', async () => {
  const calls = [];
  const client = {
    async queryServerState() {
      calls.push('state');
      return { serverGameState: { activeSessionName: 'Nexus Factory', numConnectedPlayers: 2, playerLimit: 8, isGameRunning: true } };
    },
    async save(name) { calls.push(`save:${name || ''}`); return { ok: true }; }
  };
  const provider = new SatisfactoryProvider({}, { client });
  const status = await provider.invoke('status');
  const players = await provider.invoke('players');
  await provider.invoke('save', { input: 'Before Update' });
  assert.equal(status.sessionName, 'Nexus Factory');
  assert.equal(status.state, 'playing');
  assert.equal(players.count, 2);
  assert.deepEqual(calls, ['state', 'state', 'save:Before Update']);
  assert.deepEqual(provider.supportedActions, ['status', 'players', 'save']);
  assert.equal(provider.supportedActions.includes('backups'), false);
  assert.equal(provider.supportedActions.includes('restart'), false);
});

test('Satisfactory state and TLS helpers normalize official API shapes', () => {
  assert.equal(readServerState({ ServerGameState: { ActiveSessionName: 'Factory', NumConnectedPlayers: 3 } }).players, 3);
  assert.throws(() => normalizeFingerprint('AA:BB'), /SHA-256/);
  assert.equal(normalizeFingerprint('A'.repeat(64)), 'A'.repeat(64));
});

test('connection resolver refuses incomplete server credentials', () => {
  assert.equal(configuredConnection({ connection: { host: 'example.test', port: 1234 } }, {}), null);
  assert.deepEqual(configuredConnection({ connection: { host: 'example.test', port: 1234, password: 'secret' } }, {}), {
    host: 'example.test', port: 1234, password: 'secret'
  });
});
