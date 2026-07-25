'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  normalizePlayerConsoleConfig,
  parseRconPlayers,
  normalizeRestPlayers,
  safeReason
} = require('../shared/player-console.cjs');
const { PlayerConsoleService } = require('../main/services/player-console-service.cjs');

function tempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-player-console-'));
}

function store(server, settings = {}) {
  let config = normalizePlayerConsoleConfig({ settings });
  return {
    getPlayerConsoleConfig: () => JSON.parse(JSON.stringify(config)),
    setPlayerConsoleSettings: (next) => { config = normalizePlayerConsoleConfig({ settings: { ...config.settings, ...next } }); },
    getRuntimeBootstrap: () => ({ config: { servers: [server] } })
  };
}

test('Palworld CSV and ARK player lists parse into moderation-safe records', () => {
  const palworld = parseRconPlayers('palworld', 'name,playeruid,steamid\nKirito,uid-123,steam-999\nAsuna,uid-456,steam-888');
  assert.deepEqual(palworld.map((player) => player.name), ['Kirito', 'Asuna']);
  assert.deepEqual(palworld.map((player) => player.identifier), ['uid-123', 'uid-456']);

  const ark = parseRconPlayers('ark', '0. Kirito, EOS-123\n1. Asuna, EOS-456');
  assert.deepEqual(ark.map((player) => player.name), ['Kirito', 'Asuna']);
  assert.deepEqual(ark.map((player) => player.identifier), ['EOS-123', 'EOS-456']);
  assert.deepEqual(parseRconPlayers('ark', 'No Players Connected'), []);
});

test('REST player normalization ignores IP addresses and unrelated identifiers', () => {
  const players = normalizeRestPlayers({ players: [{ name: 'Kirito', userId: 'uid-123', playerId: 'player-456', ip: '192.0.2.1', level: 42, ping: 18 }] });
  assert.equal(players.length, 1);
  assert.equal(players[0].identifier, 'uid-123');
  assert.equal(players[0].level, 42);
  assert.equal(Object.hasOwn(players[0], 'ip'), false);
  assert.doesNotMatch(JSON.stringify(players), /192\.0\.2\.1/);
});

test('moderation reasons are mandatory and bounded', () => {
  assert.throws(() => safeReason('no'), /at least 3/);
  assert.equal(safeReason('Repeated harassment'), 'Repeated harassment');
  assert.equal(safeReason('x'.repeat(400)).length, 250);
});

test('player refresh returns short-lived action tokens without account IDs', async () => {
  const server = { id: 'pal-1', name: 'Nexus Palworld', game: 'palworld', connectionType: 'rest', enabled: true, password: 'secret' };
  const service = new PlayerConsoleService({
    dataDirectory: tempDirectory(),
    configStore: store(server),
    logger: { info() {}, warn() {}, error() {} },
    connectionFactory: () => ({ action: async () => ({ players: [{ name: 'Kirito', userId: 'uid-private', ip: '192.0.2.1', level: 50, ping: 22 }] }) })
  });

  const state = await service.refresh();
  assert.equal(state.snapshot.players.length, 1);
  assert.match(state.snapshot.players[0].token, /^player-/);
  assert.equal(state.snapshot.players[0].name, 'Kirito');
  assert.doesNotMatch(JSON.stringify(state), /uid-private|192\.0\.2\.1|secret/);
});

test('moderation uses the hidden identifier and records only safe audit fields', async () => {
  const server = { id: 'ark-1', name: 'Nexus ARK', game: 'ark', enabled: true, password: 'secret' };
  const calls = [];
  const service = new PlayerConsoleService({
    dataDirectory: tempDirectory(),
    configStore: store(server),
    logger: { info() {}, warn() {}, error() {} },
    connectionFactory: () => ({
      action: async (action, payload) => {
        calls.push({ action, payload });
        if (action === 'players') return '0. Kirito, EOS-PRIVATE-123';
        return 'command complete';
      }
    })
  });

  const refreshed = await service.refresh();
  const result = await service.moderate({
    token: refreshed.snapshot.players[0].token,
    action: 'kick',
    reason: 'Repeated rule violation',
    actor: { id: 'owner-1', name: 'Owner', role: 'owner' }
  });
  assert.equal(calls[1].action, 'kick');
  assert.equal(calls[1].payload.userid, 'EOS-PRIVATE-123');
  assert.equal(result.outcome, 'success');
  assert.equal(result.playerName, 'Kirito');
  assert.doesNotMatch(JSON.stringify(result), /EOS-PRIVATE-123|secret/);
  assert.equal(service.tokens.size, 0);
});

test('expired player tokens cannot be reused', async () => {
  let now = 1_000_000;
  const server = { id: 'ark-1', name: 'Nexus ARK', game: 'ark', enabled: true, password: 'secret' };
  const service = new PlayerConsoleService({
    dataDirectory: tempDirectory(),
    configStore: store(server, { tokenLifetimeMinutes: 2 }),
    logger: { info() {}, warn() {}, error() {} },
    now: () => now,
    connectionFactory: () => ({ action: async (action) => action === 'players' ? '0. Kirito, EOS-123' : 'ok' })
  });
  const refreshed = await service.refresh();
  now += 3 * 60 * 1000;
  await assert.rejects(service.moderate({ token: refreshed.snapshot.players[0].token, action: 'kick', reason: 'Testing expiry' }), /expired/);
});

test('player console extension separates operator kick from owner ban', () => {
  const root = path.join(__dirname, '..');
  const extension = fs.readFileSync(path.join(root, 'main/player-console-extension.cjs'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'renderer/player-console.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'main/preload.cjs'), 'utf8');
  assert.match(extension, /assertAccess\('operator', 'Kick connected players'\)/);
  assert.match(extension, /assertAccess\('owner', 'Ban connected players'\)/);
  assert.match(extension, /player-console:clear-history/);
  assert.match(renderer, /Protected moderation/);
  assert.match(renderer, /Players & Moderation/);
  assert.match(preload, /onPlayerConsole/);
});
