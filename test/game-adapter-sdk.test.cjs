'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  BaseGameAdapter,
  GameAdapterRegistry,
  normalizeCapabilityManifest,
  executeAdapterOperation,
  normalizeAdapterError
} = require('../shared/game-adapter-sdk.cjs');
const { GameAdapterFixtureRecorder } = require('../shared/game-adapter-fixtures.cjs');
const { capabilityMapForServer, manifestForServer, createCurrentServerAdapter } = require('../bot/game-adapters/current-server-adapter.cjs');

function adapter(overrides = {}) {
  return new BaseGameAdapter({
    manifest: {
      adapterId: 'test-adapter', gameId: 'test', displayName: 'Test Adapter', transport: 'memory',
      capabilities: { status: true, announce: true, ban: true, metrics: true }
    },
    operations: {
      status: async () => ({ status: 'online', token: 'secret-value', authorization: 'Bearer hidden', sessionCookie: 'private-cookie' }),
      announce: async (payload) => ({ delivered: payload.message }),
      ban: async (payload) => ({ banned: payload.player }),
      metrics: async () => new Promise((resolve) => setTimeout(() => resolve({ fps: 60 }), 400)),
      ...overrides
    }
  });
}

test('capability manifests normalize roles and require explicit custom safety policy', () => {
  const manifest = normalizeCapabilityManifest({
    adapterId: 'rust-web-rcon', gameId: 'rust', displayName: 'Rust WebRCON', transport: 'websocket',
    capabilities: { status: true, ban: true, 'rust.queue': { requiredRole: 'viewer', destructive: false, timeoutMs: 5000 } }
  });
  assert.equal(manifest.capabilities.status.requiredRole, 'viewer');
  assert.equal(manifest.capabilities.ban.requiredRole, 'owner');
  assert.equal(manifest.capabilities.ban.destructive, true);
  assert.equal(manifest.capabilities['rust.queue'].supported, true);
  assert.throws(() => normalizeCapabilityManifest({
    adapterId: 'unsafe-custom', gameId: 'test', capabilities: { 'test.admin': true }
  }), /must declare requiredRole and destructive/i);
});

test('adapter execution enforces roles and redacts every secret-shaped result field', async () => {
  const instance = adapter();
  const status = await executeAdapterOperation(instance, 'status', {}, { role: 'viewer' });
  assert.equal(status.ok, true);
  assert.equal(status.data.token, '[REDACTED]');
  assert.equal(status.data.authorization, '[REDACTED]');
  assert.equal(status.data.sessionCookie, '[REDACTED]');
  await assert.rejects(() => executeAdapterOperation(instance, 'ban', { player: 'bad' }, { role: 'operator' }), (error) => {
    assert.equal(error.code, 'ACCESS_DENIED');
    return true;
  });
  const ban = await executeAdapterOperation(instance, 'ban', { player: 'bad' }, { role: 'owner' });
  assert.equal(ban.data.banned, 'bad');
});

test('unsupported capabilities, timeouts, cancellations and connection failures use stable codes', async () => {
  await assert.rejects(() => executeAdapterOperation(adapter(), 'save', {}, { role: 'operator' }), (error) => error.code === 'CAPABILITY_UNSUPPORTED');
  await assert.rejects(() => executeAdapterOperation(adapter(), 'metrics', {}, { role: 'viewer', timeoutMs: 250 }), (error) => error.code === 'TIMEOUT' && error.retryable);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => executeAdapterOperation(adapter(), 'status', {}, { role: 'viewer', signal: controller.signal }), (error) => error.code === 'CANCELLED');
  const normalized = normalizeAdapterError(new Error('connect ECONNREFUSED 127.0.0.1'));
  assert.equal(normalized.code, 'CONNECTION_FAILED');
});

test('registry refuses duplicates and validates factory identity', () => {
  const registry = new GameAdapterRegistry();
  registry.register({ manifest: adapter().manifest, factory: () => adapter() });
  assert.equal(registry.has('test-adapter'), true);
  assert.equal(registry.list().length, 1);
  assert.throws(() => registry.register({ manifest: adapter().manifest, factory: () => adapter() }), /already registered/i);
  assert.equal(registry.create('test-adapter').manifest.adapterId, 'test-adapter');
});

test('fixture recorder redacts credentials, bounds data, rotates, and can be cleared', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-adapter-fixtures-'));
  try {
    const recorder = new GameAdapterFixtureRecorder({ directory, enabled: true, maxEntryBytes: 4096, maxFileBytes: 8192, now: () => Date.now() });
    const result = recorder.record({
      adapterId: 'test-adapter', gameId: 'test', capability: 'status', requestId: 'req-1',
      request: { password: 'hunter2', authorization: 'Bearer abcdefghijklmnop', nested: { sessionToken: 'token-value' } },
      response: { payload: 'x'.repeat(10000) }
    });
    assert.equal(result.recorded, true);
    assert.equal(result.truncated, true);
    const text = fs.readFileSync(result.filePath, 'utf8');
    assert.equal(text.includes('hunter2'), false);
    assert.equal(text.includes('token-value'), false);
    assert.equal(recorder.list('test-adapter').length, 1);
    assert.equal(recorder.clear('test-adapter').cleared, true);
    assert.equal(recorder.list('test-adapter').length, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('current server bridge declares transport-specific capabilities and delegates typed operations', async () => {
  const palworld = { id: 'pal-1', name: 'Palworld', game: 'palworld', connectionType: 'rest', host: '127.0.0.1', port: 8212 };
  const ark = { id: 'ark-1', name: 'ARK', game: 'ark', connectionType: 'rcon', host: '127.0.0.1', port: 27020 };
  assert.equal(capabilityMapForServer(palworld)['game-data'], true);
  assert.equal(capabilityMapForServer(palworld).raw, undefined);
  assert.equal(capabilityMapForServer(ark).raw, true);
  assert.equal(capabilityMapForServer(ark).unban, undefined);
  assert.equal(manifestForServer(palworld).transport, 'palworld-rest');

  const calls = [];
  const instance = createCurrentServerAdapter(palworld, {
    connectionFactory: () => ({ action: async (action, payload) => { calls.push({ action, payload }); return { action }; } })
  });
  const result = await executeAdapterOperation(instance, 'players', {}, { role: 'viewer' });
  assert.equal(result.data.action, 'players');
  assert.deepEqual(calls, [{ action: 'players', payload: {} }]);
});

test('status panels and Palworld desktop operations use the SDK bridge', () => {
  const statusService = fs.readFileSync(path.join(__dirname, '..', 'main', 'services', 'status-panel-service.cjs'), 'utf8');
  const palworldExtension = fs.readFileSync(path.join(__dirname, '..', 'main', 'palworld-main-extension.cjs'), 'utf8');
  assert.match(statusService, /createCurrentServerAdapter/);
  assert.match(statusService, /executeAdapterOperation\(adapter, 'status'/);
  assert.match(statusService, /executeAdapterOperation\(adapter, 'players'/);
  assert.match(palworldExtension, /createCurrentServerAdapter/);
  assert.match(palworldExtension, /executeAdapterOperation\(adapter, action/);
  assert.match(palworldExtension, /explicitSecrets: \[server\.password\]/);
});
