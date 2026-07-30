'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const {
  SatisfactoryApiClient,
  normalizeHost,
  normalizeFingerprint,
  formatFingerprint,
  parseApiPayload,
  parseLightweightResponse,
  readServerState
} = require('../bot/satisfactory-api.cjs');
const { capabilityMapForServer, manifestForServer } = require('../bot/game-adapters/current-server-adapter.cjs');

function lightweightPacket({ cookie = 42n, state = 3, name = 'Khaos Factory', netCl = 12345, flags = 0n } = {}) {
  const nameBytes = Buffer.from(name, 'utf8');
  const packet = Buffer.alloc(26 + 2 + nameBytes.length + 1);
  packet.writeUInt16LE(0xF6D5, 0);
  packet.writeUInt8(1, 2);
  packet.writeUInt8(1, 3);
  packet.writeBigUInt64LE(cookie, 4);
  packet.writeUInt8(state, 12);
  packet.writeUInt32LE(netCl, 13);
  packet.writeBigUInt64LE(flags, 17);
  packet.writeUInt8(0, 25);
  packet.writeUInt16LE(nameBytes.length, 26);
  nameBytes.copy(packet, 28);
  packet.writeUInt8(1, packet.length - 1);
  return packet;
}

test('Satisfactory host and fingerprint validation reject ambiguous connection input', () => {
  assert.equal(normalizeHost('factory.example.com'), 'factory.example.com');
  assert.equal(normalizeHost('[2001:db8::1]'), '2001:db8::1');
  assert.throws(() => normalizeHost('https://factory.example.com:7777/api/v1'), /only the Satisfactory host/i);
  assert.throws(() => normalizeHost('factory.example.com:7777'), /separate port/i);
  const raw = 'aa'.repeat(32);
  assert.equal(normalizeFingerprint(raw), raw.toUpperCase());
  assert.equal(formatFingerprint(raw).split(':').length, 32);
  assert.throws(() => normalizeFingerprint('AA:BB'), /SHA-256/i);
});

test('Satisfactory lightweight query parser distinguishes idle, loading and playing states', () => {
  assert.equal(parseLightweightResponse(lightweightPacket({ state: 1 }), 42n).state, 'idle');
  assert.equal(parseLightweightResponse(lightweightPacket({ state: 2 }), 42n).state, 'loading');
  const playing = parseLightweightResponse(lightweightPacket({ state: 3, flags: 1n }), 42n);
  assert.equal(playing.state, 'playing');
  assert.equal(playing.serverName, 'Khaos Factory');
  assert.equal(playing.serverNetCl, 12345);
  assert.equal(playing.modded, true);
  assert.throws(() => parseLightweightResponse(lightweightPacket(), 99n), /did not match/i);
});

test('Satisfactory API payload parser handles data, no-content and API errors', () => {
  assert.deepEqual(parseApiPayload(200, Buffer.from('{"data":{"Health":"healthy"}}')), { Health: 'healthy' });
  assert.equal(parseApiPayload(204, Buffer.alloc(0)), null);
  assert.throws(() => parseApiPayload(403, Buffer.from('{"errorCode":"forbidden","errorMessage":"No access"}')), (error) => {
    assert.equal(error.status, 403);
    assert.equal(error.code, 'forbidden');
    return true;
  });
  assert.throws(() => parseApiPayload(200, Buffer.from('not-json')), /malformed JSON/i);
});

test('Satisfactory server state normalizer supports observed lower and documented upper property names', () => {
  assert.deepEqual(readServerState({ serverGameState: { activeSessionName: 'Nexus', numConnectedPlayers: 2, playerLimit: 8, isGameRunning: true } }), {
    sessionName: 'Nexus', players: 2, maxPlayers: 8, techTier: 0, activeSchematic: '', gamePhase: '', isGameRunning: true
  });
  assert.equal(readServerState({ ServerGameState: { ActiveSessionName: 'Upper', NumConnectedPlayers: 1 } }).sessionName, 'Upper');
});

test('Satisfactory status preserves loading state without calling unavailable HTTPS functions', async () => {
  const client = new SatisfactoryApiClient({ host: '127.0.0.1', port: 7777, password: 'secret', tlsFingerprint: 'aa'.repeat(32) });
  client.queryLightweight = async () => ({ state: 'loading', serverName: 'Khaos Factory', serverNetCl: 55 });
  client.health = async () => { throw new Error('HTTPS must not be called while loading'); };
  const status = await client.status();
  assert.equal(status.state, 'loading');
  assert.equal(status.apiAvailable, false);
  assert.equal(status.online, true);
});

test('Satisfactory adapter advertises only official and implemented capabilities', () => {
  const server = { id: 'sat-1', name: 'Factory', game: 'satisfactory', host: '127.0.0.1', port: 7777, connectionType: 'https-api', tlsFingerprint: 'aa'.repeat(32) };
  const capabilities = capabilityMapForServer(server);
  for (const capability of ['status', 'health', 'info', 'players', 'settings', 'backup', 'save', 'shutdown', 'stop', 'raw']) {
    assert.equal(capabilities[capability], true, `${capability} should be available`);
  }
  for (const unsupported of ['announce', 'kick', 'ban', 'unban']) assert.equal(capabilities[unsupported], undefined);
  const manifest = manifestForServer(server);
  assert.equal(manifest.gameId, 'satisfactory');
  assert.equal(manifest.transport, 'satisfactory-https');
  assert.equal(manifest.metadata.secureTransport, true);
  assert.equal(manifest.metadata.certificatePinned, true);
  assert.equal(manifest.metadata.lightweightQuery, true);
});

test('Satisfactory module registry adds one implemented dependency-aware module', () => {
  const registry = require('../shared/module-registry.cjs');
  require('../main/satisfactory-module-registry-extension.cjs').install();
  const modules = registry.catalog().filter((module) => module.id === 'satisfactory-server-operations');
  assert.equal(modules.length, 1);
  assert.equal(modules[0].availability, 'implemented');
  assert.deepEqual(modules[0].dependencies, ['game-server-control']);
  const defaults = registry.defaultModuleStates();
  assert.equal(defaults['satisfactory-server-operations'].enabled, true);
  const disabled = registry.mergeModuleStates({ 'satisfactory-server-operations': { enabled: false } });
  assert.equal(registry.buildModuleRuntime(disabled)['satisfactory-server-operations'].reason, 'disabled-by-owner');
  const dependencyOff = registry.mergeModuleStates({
    'game-server-control': { enabled: false },
    'satisfactory-server-operations': { enabled: true }
  });
  const state = registry.buildModuleRuntime(dependencyOff)['satisfactory-server-operations'];
  assert.equal(state.effectiveEnabled, false);
  assert.deepEqual(state.blockedBy, ['game-server-control']);
});

test('Satisfactory extension order preserves module gating and status panel capture', () => {
  const entry = read('main/entry.cjs');
  assert.ok(entry.indexOf('satisfactory-module-registry-extension.cjs') < entry.indexOf('module-foundation-extension.cjs'));
  assert.ok(entry.indexOf('satisfactory-status-panel-extension.cjs') < entry.indexOf('status-panels-extension.cjs'));
  assert.ok(entry.indexOf('rust-module-gate-extension.cjs') < entry.indexOf('satisfactory-main-extension.cjs'));
  assert.ok(entry.indexOf('satisfactory-main-extension.cjs') < entry.indexOf('satisfactory-module-gate-extension.cjs'));
  assert.ok(entry.indexOf('satisfactory-module-gate-extension.cjs') < entry.indexOf("require('./main.cjs')"));
});

test('Satisfactory desktop UI retains protected trust and destructive confirmation controls', () => {
  const ui = read('renderer/satisfactory-api-ui.js');
  const main = read('main/satisfactory-main-extension.cjs');
  assert.doesNotThrow(() => new Function(ui));
  assert.match(ui, /Trust Current Certificate/);
  assert.match(ui, /server\.GenerateAPIToken/);
  assert.match(ui, /RUN RAW COMMAND/);
  assert.match(ui, /Save & Shut Down/);
  assert.match(main, /server:satisfactory-trust-certificate/);
  assert.match(main, /server:satisfactory-action/);
  assert.match(main, /Type the exact server name/);
  assert.match(main, /explicitSecrets: \[server\.password\]/);
});
