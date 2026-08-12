'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_PALWORLD_REST_PORT,
  DEFAULT_PALWORLD_RCON_PORT,
  normalizePalworldControl,
  buildPalworldRconMirror,
  classifyPalworldRconCommand
} = require('../shared/palworld-control-profile.cjs');

test('new Palworld control profiles always use REST as primary and RCON is optional', () => {
  const control = normalizePalworldControl({
    game: 'palworld',
    port: 8212,
    protocol: 'http',
    rconEnabled: true,
    rconHost: '10.0.0.5',
    rconPort: 25575
  });
  assert.equal(control.connectionType, 'rest');
  assert.equal(control.port, 8212);
  assert.equal(control.rconEnabled, true);
  assert.equal(control.rconHost, '10.0.0.5');
  assert.equal(control.rconPort, 25575);
});

test('legacy RCON-only Palworld entries migrate to REST primary while preserving the old RCON endpoint', () => {
  const control = normalizePalworldControl({
    game: 'palworld',
    connectionType: 'rcon',
    port: 32145,
    host: 'legacy.example.test'
  });
  assert.equal(control.connectionType, 'rest');
  assert.equal(control.port, DEFAULT_PALWORLD_REST_PORT);
  assert.equal(control.rconEnabled, true);
  assert.equal(control.rconPort, 32145);
  assert.equal(control.restNeedsVerification, true);
});

test('RCON mirror reuses the REST server protected password without changing the primary server', () => {
  const primary = {
    id: 'pal-1', game: 'palworld', connectionType: 'rest', host: 'rest.example.test', port: 8212,
    rconEnabled: true, rconHost: 'rcon.example.test', rconPort: 25575, password: 'protected-admin-password'
  };
  const mirror = buildPalworldRconMirror(primary);
  assert.equal(mirror.connectionType, 'rcon');
  assert.equal(mirror.host, 'rcon.example.test');
  assert.equal(mirror.port, DEFAULT_PALWORLD_RCON_PORT);
  assert.equal(mirror.password, primary.password);
  assert.equal(primary.connectionType, 'rest');
  assert.equal(primary.port, 8212);
});

test('RCON command classifier keeps reads harmless and maps mutations to Nexus Core capabilities', () => {
  assert.deepEqual(
    classifyPalworldRconCommand('Info'),
    { command: 'Info', mutation: false, capability: 'game.server.read', destructive: false, kind: 'info' }
  );
  assert.equal(classifyPalworldRconCommand('ShowPlayers').mutation, false);
  assert.equal(classifyPalworldRconCommand('Save').capability, 'game.server.save');
  assert.equal(classifyPalworldRconCommand('Broadcast Nexus test').capability, 'game.server.broadcast');
  assert.equal(classifyPalworldRconCommand('Shutdown 60 Updating').capability, 'game.server.shutdown');
  assert.equal(classifyPalworldRconCommand('Shutdown 60 Updating').destructive, true);
  assert.equal(classifyPalworldRconCommand('DoExit').capability, 'game.server.stop');
});

test('unknown raw RCON commands fail into the owner-only critical raw capability', () => {
  const classified = classifyPalworldRconCommand('SomeFutureCommand value');
  assert.equal(classified.mutation, true);
  assert.equal(classified.capability, 'game.console.raw');
  assert.equal(classified.destructive, true);
  assert.equal(classified.kind, 'raw');
});
