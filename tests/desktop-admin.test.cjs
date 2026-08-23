'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  applyPublicSettings,
  collectSecretEnvNames,
  ensureUserConfig,
  publicSettings,
  readJson,
  runtimeConfig
} = require('../src/desktop/config-store.cjs');
const { SecretVault } = require('../src/desktop/secret-vault.cjs');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-desktop-test-'));
}

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`protected:${value}`, 'utf8'),
    decryptString: (buffer) => buffer.toString('utf8').replace(/^protected:/, '')
  };
}

test('desktop creates a writable user config from the packaged template', () => {
  const root = tempDir();
  const template = path.resolve(__dirname, '..', 'config.example.json');
  const configPath = ensureUserConfig(root, template);
  assert.equal(configPath, path.join(root, 'config.json'));
  assert.equal(fs.existsSync(configPath), true);
  assert.equal(readJson(configPath).backend.host, '127.0.0.1');
});

test('desktop public settings force the embedded backend to loopback and preserve module contract', () => {
  const source = readJson(path.resolve(__dirname, '..', 'config.example.json'));
  const settings = publicSettings(source);
  settings.backend.port = 4321;
  settings.discord.guildId = '1016059608789434408';
  settings.discord.ownerUserIds = ['123456789012345678'];
  settings.modules.warframe.platform = 'pc';
  settings.modules.warframe.marketPlatform = 'pc';
  settings.modules.warframe.channelId = '987654321098765432';
  settings.modules.palworld.connection.host = 'pal.example.test';
  settings.modules.palworld.connection.port = 8212;

  const updated = applyPublicSettings(source, settings);
  assert.equal(updated.backend.host, '127.0.0.1');
  assert.equal(updated.backend.publicBaseUrl, 'http://127.0.0.1:4321');
  assert.equal(updated.discord.guildId, '1016059608789434408');
  assert.equal(updated.modules.warframe.channelId, '987654321098765432');
  assert.equal(updated.modules.palworld.connection.host, 'pal.example.test');
  assert.equal(updated.modules.palworld.connection.passwordEnv, 'NEXUS_PALWORLD_REST_PASSWORD');
});

test('desktop runtime state files resolve beneath user data without mutating stored config', () => {
  const source = readJson(path.resolve(__dirname, '..', 'config.example.json'));
  const root = tempDir();
  const configPath = path.join(root, 'config.json');
  const runtime = runtimeConfig(source, root, configPath);
  assert.equal(runtime.scheduler.stateFile, path.join(root, 'data', 'schedules.json'));
  assert.equal(runtime.modules.division2.stateFile, path.join(root, 'data', 'division2-state.json'));
  assert.equal(runtime.modules.idleon.stateFile, path.join(root, 'data', 'idleon-state.json'));
  assert.equal(source.scheduler.stateFile, 'data/schedules.json');
  assert.equal(runtime.backend.host, '127.0.0.1');
});

test('secret environment keys are discovered without exposing secret values', () => {
  const source = readJson(path.resolve(__dirname, '..', 'config.example.json'));
  const names = collectSecretEnvNames(source);
  assert.ok(names.includes('NEXUS_SENTINEL_TOKEN'));
  assert.ok(names.includes('NEXUS_ARK_RCON_PASSWORD'));
  assert.ok(names.includes('NEXUS_PALWORLD_REST_PASSWORD'));
  assert.ok(names.includes('NEXUS_RUST_RCON_PASSWORD'));
  assert.ok(names.includes('NEXUS_SATISFACTORY_TOKEN'));
});

test('desktop secret vault encrypts at rest and applies secrets to process environment', () => {
  const root = tempDir();
  const vault = new SecretVault({ userDataPath: root, safeStorage: fakeSafeStorage() });
  const key = 'NEXUS_TEST_SECRET';
  delete process.env[key];
  vault.set(key, 'swordfish');
  const raw = fs.readFileSync(path.join(root, 'secrets.json'), 'utf8');
  assert.equal(raw.includes('swordfish'), false);
  delete process.env[key];
  assert.equal(vault.apply([key]).includes(key), true);
  assert.equal(process.env[key], 'swordfish');
  const status = vault.statuses([key])[0];
  assert.equal(status.configured, true);
  vault.remove(key);
  assert.equal(process.env[key], undefined);
});
