'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  normalizePanelUrl,
  normalizeProvider,
  normalizeHostedControlConfig,
  normalizePowerSignal,
  normalizePterodactylServer,
  normalizePterodactylResources
} = require('../shared/hosted-server-control.cjs');
const { PterodactylClient } = require('../main/services/pterodactyl-client.cjs');
const { HostedServerService } = require('../main/services/hosted-server-service.cjs');

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => payload === undefined ? '' : JSON.stringify(payload)
  };
}

function tempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-hosted-'));
}

function provider(overrides = {}) {
  return normalizeProvider({
    id: 'provider-1',
    name: 'Nexus Panel',
    type: 'pterodactyl',
    baseUrl: 'https://panel.example.com',
    enabled: true,
    requestTimeoutSeconds: 12,
    refreshSeconds: 30,
    ...overrides
  });
}

function store(providerValue, settings = {}) {
  let current = providerValue;
  const config = normalizeHostedControlConfig({ providers: [current], settings });
  return {
    getHostedControlConfig: () => ({ ...config, providers: [current] }),
    getHostedControlPublicConfig: () => ({ ...config, providers: [{ ...current, hasToken: true }] }),
    hasHostedProviderToken: () => true,
    getHostedProviderRuntime: () => ({ provider: current, token: 'ptlc_private_key' }),
    patchHostedProvider: (_id, patch) => { current = normalizeProvider({ ...current, ...patch }); return current; }
  };
}

test('Pterodactyl panel URLs require secure remote transport and strip API suffixes', () => {
  assert.equal(normalizePanelUrl('https://panel.example.com/api/client/'), 'https://panel.example.com');
  assert.equal(normalizePanelUrl('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080');
  assert.throws(() => normalizePanelUrl('http://panel.example.com'), /HTTPS is required/);
  assert.equal(normalizePanelUrl('http://panel.lan:8080', true), 'http://panel.lan:8080');
  assert.throws(() => normalizePanelUrl('https://user:password@panel.example.com'), /Do not include credentials/);
});

test('power actions are restricted to the supported Pterodactyl signals', () => {
  for (const signal of ['start', 'restart', 'stop', 'kill']) assert.equal(normalizePowerSignal(signal), signal);
  assert.throws(() => normalizePowerSignal('reinstall'), /Unsupported/);
  assert.throws(() => normalizePowerSignal('command rm -rf'), /Unsupported/);
});

test('Pterodactyl response normalization exposes safe resource fields', () => {
  const server = normalizePterodactylServer({ attributes: {
    identifier: 'abc123', name: 'Palworld', description: 'Community server', node: 'Node A',
    is_suspended: false, is_installing: false, limits: { memory: 8192, disk: 20480, cpu: 200 }
  } });
  const resources = normalizePterodactylResources({ attributes: {
    current_state: 'running', resources: { memory_bytes: 1024, cpu_absolute: 12.5, disk_bytes: 2048, network_rx_bytes: 300, network_tx_bytes: 400, uptime: 60000 }
  } });
  assert.equal(server.identifier, 'abc123');
  assert.equal(server.limits.memoryMb, 8192);
  assert.equal(resources.currentState, 'running');
  assert.equal(resources.cpuPercent, 12.5);
});

test('Pterodactyl client lists servers, reads resources, and sends typed power signals', async () => {
  const calls = [];
  const client = new PterodactylClient(provider(), 'ptlc_secret', {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.includes('/resources')) return response(200, { attributes: { current_state: 'running', resources: { memory_bytes: 1024 } } });
      if (url.endsWith('/power')) return response(204);
      return response(200, { data: [{ attributes: { identifier: 'abc123', name: 'Palworld', limits: {} } }], meta: { pagination: { total_pages: 1 } } });
    }
  });
  const servers = await client.listServers();
  const resources = await client.resources('abc123');
  const power = await client.power('abc123', 'restart');
  assert.equal(servers[0].name, 'Palworld');
  assert.equal(resources.currentState, 'running');
  assert.equal(power.signal, 'restart');
  assert.match(calls[0].options.headers.Authorization, /^Bearer ptlc_secret$/);
  assert.deepEqual(JSON.parse(calls[2].options.body), { signal: 'restart' });
});

test('Pterodactyl authentication errors are safe and actionable', async () => {
  const client = new PterodactylClient(provider(), 'ptlc_secret', { fetchImpl: async () => response(401, { errors: [{ detail: 'bad token' }] }) });
  await assert.rejects(client.listServers(), /rejected the Client API key/);
});

test('hosted inventory returns action tokens without server identifiers or provider keys', async () => {
  const currentProvider = provider();
  const service = new HostedServerService({
    dataDirectory: tempDirectory(),
    configStore: store(currentProvider),
    logger: { info() {}, warn() {}, error() {} },
    clientFactory: () => ({
      listServers: async () => [{ identifier: 'private-server-id', name: 'Nexus ARK', description: '', node: 'Node A', status: 'offline', suspended: false, installing: false, transferring: false, serverOwner: true, limits: {} }],
      resources: async () => ({ currentState: 'offline', suspended: false, memoryBytes: 0, cpuPercent: 0, diskBytes: 0, networkRxBytes: 0, networkTxBytes: 0, uptimeMs: 0 }),
      power: async () => ({ accepted: true })
    })
  });
  const state = await service.refresh();
  assert.equal(state.snapshot.servers.length, 1);
  assert.match(state.snapshot.servers[0].token, /^hosted-server-/);
  assert.equal(state.snapshot.servers[0].name, 'Nexus ARK');
  assert.doesNotMatch(JSON.stringify(state), /private-server-id|ptlc_private_key/);
});

test('hosted power actions use hidden identifiers and retain only safe history', async () => {
  const calls = [];
  const currentProvider = provider();
  const service = new HostedServerService({
    dataDirectory: tempDirectory(),
    configStore: store(currentProvider),
    logger: { info() {}, warn() {}, error() {} },
    clientFactory: () => ({
      listServers: async () => [{ identifier: 'private-server-id', name: 'Nexus ARK', description: '', node: '', status: 'offline', suspended: false, installing: false, transferring: false, serverOwner: true, limits: {} }],
      resources: async () => ({ currentState: 'offline', suspended: false, memoryBytes: 0, cpuPercent: 0, diskBytes: 0, networkRxBytes: 0, networkTxBytes: 0, uptimeMs: 0 }),
      power: async (identifier, signal) => { calls.push({ identifier, signal }); return { accepted: true }; }
    })
  });
  const refreshed = await service.refresh();
  const result = await service.power({ token: refreshed.snapshot.servers[0].token, signal: 'start', actor: { id: 'owner', name: 'Kirito', role: 'owner' } });
  assert.deepEqual(calls, [{ identifier: 'private-server-id', signal: 'start' }]);
  assert.equal(result.outcome, 'success');
  assert.equal(result.serverName, 'Nexus ARK');
  assert.doesNotMatch(JSON.stringify(result), /private-server-id|ptlc_private_key/);
});

test('hosted server extension enforces owner-only emergency kill and encrypted tokens', () => {
  const root = path.join(__dirname, '..');
  const extension = fs.readFileSync(path.join(root, 'main/hosted-server-extension.cjs'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'renderer/hosted-server.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'main/preload.cjs'), 'utf8');
  assert.match(extension, /signal === 'kill' \? 'owner' : 'operator'/);
  assert.match(extension, /hostedProviderTokens/);
  assert.match(extension, /saveSecrets\(\)/);
  assert.match(extension, /getSecretValues/);
  assert.match(renderer, /Emergency kill/);
  assert.match(renderer, /Client API key/);
  assert.match(preload, /onHostedServer/);
});
