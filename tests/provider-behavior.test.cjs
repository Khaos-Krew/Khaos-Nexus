'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SourceRconProvider } = require('../src/backend/providers/source-rcon-provider.cjs');
const { PalworldProvider, parseShutdownInput, parseUserInput } = require('../src/backend/providers/palworld-provider.cjs');
const { RustProvider, safeRustArgument } = require('../src/backend/providers/rust-provider.cjs');
const { SatisfactoryProvider, readServerState } = require('../src/backend/providers/satisfactory-provider.cjs');
const { calculatorsAction } = require('../src/backend/providers/idleon-provider.cjs');
const { parseCollectionCommand, parseOfficialNews } = require('../src/backend/providers/division2-provider.cjs');
const { marketSlug } = require('../src/backend/providers/warframe-provider.cjs');

function fakeRcon(responses, calls) {
  return {
    execute: async (command) => {
      calls.push(command);
      return Object.prototype.hasOwnProperty.call(responses, command) ? responses[command] : 'OK';
    }
  };
}

test('ARK cluster provider fans safe actions across servers and requires targeting for moderation', async () => {
  const islandCalls = [];
  const ragCalls = [];
  const provider = new SourceRconProvider('ark', {
    servers: [
      { name: 'Island', host: '127.0.0.1', port: 27020, password: 'x', restartOnExit: true },
      { name: 'Ragnarok', host: '127.0.0.1', port: 27021, password: 'x', restartOnExit: true }
    ]
  }, {
    clients: {
      island: fakeRcon({ ListPlayers: '1. Alice,111' }, islandCalls),
      ragnarok: fakeRcon({ ListPlayers: 'No Players Connected' }, ragCalls)
    }
  });

  const status = await provider.invoke('status');
  assert.equal(status.serverCount, 2);
  assert.equal(status.servers[0].count, 1);
  const broadcast = await provider.invoke('broadcast', { input: 'Hello cluster' });
  assert.equal(broadcast.results.length, 2);
  assert.equal(islandCalls.includes('Broadcast Hello cluster'), true);
  assert.equal(ragCalls.includes('Broadcast Hello cluster'), true);
  await assert.rejects(() => provider.invoke('kick', { input: 'Alice' }), /server prefix/);
  await provider.invoke('kick', { input: 'island|Alice' });
  assert.equal(islandCalls.includes('KickPlayer Alice'), true);
});

test('Palworld provider maps official moderation, snapshot, and supervised restart inputs', async () => {
  const calls = [];
  const client = {
    info: async () => ({ name: 'Palworld' }), metrics: async () => ({ serverfps: 60 }), players: async () => ({ players: [] }),
    settings: async () => ({ bIsUseBackupSaveData: true }), save: async () => ({ ok: true }), announce: async (message) => ({ message }),
    kick: async (...args) => { calls.push(['kick', ...args]); return { ok: true }; },
    ban: async (...args) => { calls.push(['ban', ...args]); return { ok: true }; },
    unban: async (...args) => { calls.push(['unban', ...args]); return { ok: true }; },
    snapshot: async () => ({ Time: 'Day 1', FPS: 60, ActorData: [{ UnitType: 'Pal' }, { UnitType: 'Pal' }, { UnitType: 'Player' }] }),
    shutdown: async (...args) => { calls.push(['shutdown', ...args]); return { ok: true }; }
  };
  const provider = new PalworldProvider({ restartViaShutdown: true }, { client });
  const snapshot = await provider.invoke('snapshot');
  assert.equal(snapshot.actorCount, 3);
  assert.equal(snapshot.counts.Pal, 2);
  await provider.invoke('kick', { input: 'steam_123|Maintenance' });
  assert.deepEqual(calls[0], ['kick', 'steam_123', 'Maintenance']);
  const restart = await provider.invoke('restart', { input: '45|Restarting' });
  assert.equal(restart.restartExpected, true);
  assert.deepEqual(calls.at(-1), ['shutdown', 45, 'Restarting']);
  assert.deepEqual(parseUserInput({ input: 'abc|reason' }), { userid: 'abc', message: 'reason' });
  assert.deepEqual(parseShutdownInput({ input: '30|bye' }), { waittime: 30, message: 'bye' });
});

test('Rust arguments reject command chaining and moderation uses quoted targets', async () => {
  assert.throws(() => safeRustArgument('name;quit'), /semicolons/);
  const commands = [];
  const provider = new RustProvider({}, { client: { command: async (command) => { commands.push(command); return 'OK'; } } });
  await provider.invoke('ban', { input: 'Player One|Rule violation' });
  assert.equal(commands[0], 'ban "Player One" "Rule violation"');
});

test('Satisfactory provider maps state, saves, commands, load and supervised restart', async () => {
  const calls = [];
  const client = {
    queryServerState: async () => ({ serverGameState: { activeSessionName: 'Factory', numConnectedPlayers: 2, playerLimit: 8, isGameRunning: true } }),
    save: async (name) => ({ saved: name }), enumerateSessions: async () => ({ sessions: ['Factory'] }),
    getServerOptions: async () => ({ options: {} }), getAdvancedGameSettings: async () => ({ settings: {} }),
    loadGame: async (...args) => { calls.push(['load', ...args]); return { ok: true }; },
    runCommand: async (command) => { calls.push(['command', command]); return { ok: true }; },
    shutdown: async () => { calls.push(['shutdown']); return { ok: true }; }
  };
  const provider = new SatisfactoryProvider({ restartViaShutdown: true }, { client });
  const status = await provider.invoke('status');
  assert.equal(status.players, 2);
  assert.equal(readServerState({ serverGameState: { activeSessionName: 'X', isGameRunning: true } }).sessionName, 'X');
  await provider.invoke('command', { input: 'ShowDebug' });
  await provider.invoke('load-save', { input: 'Factory' });
  const restart = await provider.invoke('restart');
  assert.equal(restart.restartExpected, true);
  assert.deepEqual(calls, [['command', 'ShowDebug'], ['load', 'Factory', false], ['shutdown']]);
});

test('companion helpers parse user workflows without inventing game data', () => {
  assert.deepEqual(parseCollectionCommand('add St. Elmo'), { op: 'add', value: 'St. Elmo' });
  assert.deepEqual(parseCollectionCommand('remove St. Elmo'), { op: 'remove', value: 'St. Elmo' });
  const calc = calculatorsAction({ input: 'kills 500|1000|50' });
  assert.equal(calc.remaining, 500);
  assert.equal(calc.minutes, 10);
  assert.equal(marketSlug('Arcane Energize'), 'arcane_energize');
  const news = parseOfficialNews('<a href="/en-us/game/the-division/the-division-2/news-updates/abc/test">Test Headline</a>');
  assert.equal(news[0].title, 'Test Headline');
});
