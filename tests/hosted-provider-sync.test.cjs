'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BackendRuntime } = require('../src/backend/core/runtime.cjs');
const { SentinalAdminClient } = require('../src/desktop/sentinal-admin-client.cjs');
const { sanitizeProviderModules } = require('../src/shared/provider-sync.cjs');
const { HostedProviderStore, bootstrapHostedProviderStore } = require('../src/railway/hosted-provider-store.cjs');

const root = path.resolve(__dirname, '..');
const template = JSON.parse(fs.readFileSync(path.join(root, 'config.example.json'), 'utf8'));

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-hosted-provider-')); }

test('hosted provider sanitizer accepts connection metadata but rejects arbitrary command and credential-key replacement', () => {
  const modules = sanitizeProviderModules({
    ark: {
      enabled: true,
      connection: { servers: [{ name: 'Primary', host: 'ark.example.test', port: 27020, passwordEnv: 'NEXUS_EVIL', restartCommand: 'shutdown /s', backupPath: 'C:/safe/backups' }] }
    },
    definitelyNotAModule: { enabled: true, connection: { host: 'bad' } }
  }, template);

  assert.equal(modules.ark.connection.servers[0].host, 'ark.example.test');
  assert.equal(modules.ark.connection.servers[0].port, 27020);
  assert.equal(modules.ark.connection.servers[0].passwordEnv, template.modules.ark.connection.servers[0].passwordEnv);
  assert.equal(modules.ark.connection.servers[0].restartCommand, template.modules.ark.connection.servers[0].restartCommand);
  assert.equal(Object.prototype.hasOwnProperty.call(modules, 'definitelyNotAModule'), false);
});

test('hosted provider secrets are encrypted at rest and can be applied with the matching admin key', () => {
  const dir = tempDir();
  const name = 'NEXUS_PALWORLD_REST_PASSWORD';
  const secret = 'provider-secret-value-that-must-not-be-stored-in-plaintext';
  delete process.env[name];
  const store = new HostedProviderStore({ root: dir, token: 'a'.repeat(64), templateConfig: template });
  const status = store.configure({
    modules: { palworld: { enabled: true, connection: { host: '10.1.2.3', port: 8212, protocol: 'http', apiPath: '/v1/api', username: 'admin' } } },
    secrets: { [name]: secret }
  });
  const raw = fs.readFileSync(store.file, 'utf8');
  assert.equal(raw.includes(secret), false);
  assert.deepEqual(status.configuredSecrets, [{ name, configured: true }]);
  assert.equal(JSON.stringify(status).includes(secret), false);
  assert.equal(process.env[name], secret);
  delete process.env[name];
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hosted provider bootstrap honors NEXUS_DATA_DIR for persistent config and runtime files', () => {
  const dir = tempDir();
  const dataDir = path.join(dir, 'mounted-data');
  const previousDataDir = process.env.NEXUS_DATA_DIR;
  const previousConfig = process.env.NEXUS_CONFIG;
  process.env.NEXUS_DATA_DIR = dataDir;
  try {
    const hosted = bootstrapHostedProviderStore({ root: dir, token: 'a'.repeat(64), templateConfig: template });
    assert.equal(hosted.store.file, path.join(dataDir, 'hosted-provider-config.json'));
    assert.equal(hosted.runtimeFile, path.join(dataDir, 'hosted-runtime-config.json'));
    assert.equal(process.env.NEXUS_CONFIG, hosted.runtimeFile);
    assert.equal(fs.existsSync(hosted.runtimeFile), true);
  } finally {
    if (previousDataDir === undefined) delete process.env.NEXUS_DATA_DIR;
    else process.env.NEXUS_DATA_DIR = previousDataDir;
    if (previousConfig === undefined) delete process.env.NEXUS_CONFIG;
    else process.env.NEXUS_CONFIG = previousConfig;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('wrong hosted admin key cannot decrypt persisted provider credentials', () => {
  const dir = tempDir();
  const name = 'NEXUS_PALWORLD_REST_PASSWORD';
  delete process.env[name];
  const first = new HostedProviderStore({ root: dir, token: 'a'.repeat(64), templateConfig: template });
  first.configure({ modules: { palworld: { connection: { host: '10.2.3.4', port: 8212 } } }, secrets: { [name]: 'top-secret' } });
  delete process.env[name];
  const wrong = new HostedProviderStore({ root: dir, token: 'b'.repeat(64), templateConfig: template });
  const applied = wrong.applySecrets();
  assert.deepEqual(applied.applied, []);
  assert.ok(applied.failed.includes(name));
  assert.equal(process.env[name], undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hosted store rejects secrets outside provider credential allowlist', () => {
  const dir = tempDir();
  const store = new HostedProviderStore({ root: dir, token: 'a'.repeat(64), templateConfig: template });
  assert.throws(() => store.configure({ modules: {}, secrets: { NEXUS_SENTINEL_TOKEN: 'must-not-sync' } }), /not allowed/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hosted acceptance evidence stores sanitized result metadata without provider payload data', () => {
  const dir = tempDir();
  const store = new HostedProviderStore({ root: dir, token: 'a'.repeat(64), templateConfig: template });
  store.configure({ modules: { palworld: { connection: { host: '10.3.4.5', port: 8212 } } } });
  store.recordValidation('palworld', {
    ok: true,
    results: [{ name: 'Palworld', ok: true, code: 'PASS', providerKind: 'palworld-rest', latencyMs: 12.4, message: 'Status probe passed.', data: { password: 'never-store-this' } }]
  });
  const status = store.status();
  assert.equal(status.lastValidations.palworld.ok, true);
  assert.equal(status.lastValidations.palworld.latencyMs, 12);
  assert.equal(Object.prototype.hasOwnProperty.call(status.lastValidations.palworld, 'data'), false);
  assert.equal(fs.readFileSync(store.file, 'utf8').includes('never-store-this'), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('backend runtime can replace provider instances live without replacing shared services', () => {
  const runtime = new BackendRuntime({ config: template, providers: {}, services: { scheduler: { invoke() {} } } });
  const provider = { connected: true, providerKind: 'test-provider', supportedActions: ['status'], async invoke() { return {}; } };
  const manifests = runtime.replaceProviders(template, { palworld: provider });
  const palworld = manifests.find((item) => item.id === 'palworld');
  assert.equal(palworld.configured, true);
  assert.equal(palworld.connected, true);
  assert.equal(runtime.services.scheduler.invoke instanceof Function, true);
});

test('desktop hosted provider client uses authenticated provider endpoints and only serializes supplied secrets', async () => {
  process.env.NEXUS_SENTINAL_ADMIN_TOKEN = 't'.repeat(64);
  const requests = [];
  const client = new SentinalAdminClient({ discord: { sentinalAdminUrl: 'https://sentinal.example.test', sentinalAdminTokenEnv: 'NEXUS_SENTINAL_ADMIN_TOKEN' } }, {
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { status: 200, async json() { return { ok: true, configuredSecrets: [] }; } };
    }
  });
  await client.configureProviders({ palworld: { enabled: true } }, { NEXUS_PALWORLD_REST_PASSWORD: 'provider-only' });
  await client.validateHostedProvider('palworld');
  const syncBody = JSON.parse(requests[0].options.body);
  assert.equal(syncBody.secrets.NEXUS_PALWORLD_REST_PASSWORD, 'provider-only');
  assert.equal(Object.prototype.hasOwnProperty.call(syncBody.secrets, 'NEXUS_SENTINAL_ADMIN_TOKEN'), false);
  assert.match(requests[0].url, /\/v1\/providers\/config$/);
  assert.match(requests[1].url, /\/v1\/providers\/validate$/);
  delete process.env.NEXUS_SENTINAL_ADMIN_TOKEN;
});

test('Railway runtime bootstraps hosted config before starting backend and Sentinal', () => {
  const source = fs.readFileSync(path.join(root, 'src/railway/sentinal-service.cjs'), 'utf8');
  const bootstrap = source.indexOf('bootstrapHostedProviderStore()');
  const backend = source.indexOf("require('../backend/server.cjs')");
  const sentinal = source.indexOf("require('../sentinel/entry.cjs')");
  assert.ok(bootstrap >= 0 && bootstrap < backend && backend < sentinal);
});

test('renderer hosted provider panel delegates secrets to main process and offers hosted read-only validation', () => {
  const source = fs.readFileSync(path.join(root, 'src/renderer/hosted-provider-ui.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'src/preload.cjs'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'src/main.cjs'), 'utf8');
  assert.match(source, /Sync to Hosted Sentinal/);
  assert.match(source, /never exposed to this renderer/);
  assert.match(source, /sentinalSyncProviders\(\)/);
  assert.match(source, /sentinalValidateProvider/);
  assert.doesNotMatch(source, /decrypt\(/);
  assert.match(preload, /nexus:sentinal-sync-providers/);
  assert.match(main, /providerSecretNames\(storedConfig/);
  assert.match(main, /vault\?\.decrypt/);
});
