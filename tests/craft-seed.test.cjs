'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Events } = require('discord.js');
const { seedCraftFiles } = require('../src/craft/seed.cjs');
const { CraftStore } = require('../src/craft/store.cjs');
const { attachCraftModule } = require('../src/sentinel/craft-module.cjs');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'craft-seed-'));
}

function b64(value) {
  return Buffer.from(value, 'utf8').toString('base64');
}

test('craft seed writes missing files once and does not log their contents', () => {
  const dir = tempDir();
  const secret = 'vault-key-that-must-not-appear-in-logs-0123456789';
  const state = {
    version: 1,
    boardChannelId: '1516602943670059109',
    statusPanel: {
      channelId: '1516602943670059109',
      messageId: '1516602943670059110',
      host: 'play.example.test',
      javaPort: 25565,
      bedrockPort: 19132,
      kind: 'java',
      rconName: 'default'
    },
    listings: {},
    applications: {}
  };
  const rcon = { version: 1, servers: { default: { host: 'rcon.example.test', port: 25575, password: { v: 1 } } } };
  const lines = [];
  const result = seedCraftFiles({
    dir,
    env: {
      SENTINAL_CRAFT_SEED_JSON: b64(`${JSON.stringify(state)}\n`),
      SENTINAL_CRAFT_SEED_RCON_JSON: b64(JSON.stringify(rcon)),
      SENTINAL_CRAFT_SEED_RCON_SECRET: secret
    },
    log: { log: (line) => lines.push(line) }
  });
  assert.deepEqual(result.seeded.sort(), ['nexus-craft-rcon-secret', 'nexus-craft-rcon.json', 'nexus-craft.json']);
  assert.deepEqual(result.failed, []);
  const written = JSON.parse(fs.readFileSync(path.join(dir, 'nexus-craft.json'), 'utf8'));
  assert.equal(written.statusPanel.host, 'play.example.test');
  assert.equal(fs.readFileSync(path.join(dir, 'nexus-craft-rcon-secret'), 'utf8').trim(), secret);
  // Windows NTFS does not retain POSIX 0o600 from open('wx', 0o600); Railway runs Linux.
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.join(dir, 'nexus-craft-rcon-secret')).mode & 0o777, 0o600);
  }
  const logged = lines.join('\n');
  assert.match(logged, /craft seed wrote nexus-craft\.json/);
  assert.match(logged, /remove SENTINAL_CRAFT_SEED_JSON/);
  assert.equal(logged.includes(secret), false);
  assert.equal(logged.includes('play.example.test'), false);
  assert.equal(logged.includes('rcon.example.test'), false);

  const again = seedCraftFiles({
    dir,
    env: {
      SENTINAL_CRAFT_SEED_JSON: b64(JSON.stringify({ version: 1, statusPanel: { host: 'replaced.example.test' } })),
      SENTINAL_CRAFT_SEED_RCON_SECRET: 'different-secret-should-not-replace'
    },
    log: { log: (line) => lines.push(line) }
  });
  assert.deepEqual(again.seeded, []);
  assert.deepEqual(again.skipped.sort(), ['nexus-craft-rcon-secret', 'nexus-craft.json']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'nexus-craft.json'), 'utf8')).statusPanel.host, 'play.example.test');
  assert.equal(fs.readFileSync(path.join(dir, 'nexus-craft-rcon-secret'), 'utf8').trim(), secret);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('craft seed refuses invalid payloads without creating a file', () => {
  const dir = tempDir();
  const lines = [];
  const result = seedCraftFiles({
    dir,
    env: {
      SENTINAL_CRAFT_SEED_JSON: Buffer.from('not json', 'utf8').toString('base64'),
      SENTINAL_CRAFT_SEED_RCON_SECRET: ''
    },
    log: { log: (line) => lines.push(line) }
  });
  assert.deepEqual(result.failed, ['nexus-craft.json']);
  assert.equal(fs.existsSync(path.join(dir, 'nexus-craft.json')), false);
  assert.equal(lines.join('\n').includes('not json'), false);
  const quiet = seedCraftFiles({ dir, env: {}, log: { log: () => { throw new Error('must not log'); } } });
  assert.deepEqual(quiet, { seeded: [], skipped: [], failed: [], backedUp: [], backupFolder: '' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sentinal boot seeds the store directory and explains a missing status host', async () => {
  const dir = tempDir();
  const host = 'panel-host.example.test';
  const state = { version: 1, statusPanel: { channelId: '1516602943670059109', host, javaPort: 25565 }, listings: {}, applications: {} };
  const lines = [];
  const events = {};
  const client = {
    once(name, fn) { (events[name] ||= []).push(fn); },
    on() {},
    guilds: { fetch: async () => ({ id: '1016059608789434408', commands: { fetch: async () => ({ find: () => null }), create: async () => {} } }) },
    user: { id: '1516602943670059199' }
  };
  const store = new CraftStore(dir, {});
  const attached = attachCraftModule(client, {
    env: {
      SENTINAL_CRAFT_MODULE: 'true',
      DISCORD_GUILD_ID: '1016059608789434408',
      SENTINAL_CRAFT_SEED_JSON: Buffer.from(`${JSON.stringify(state)}\n`, 'utf8').toString('base64')
    },
    config: { discord: {} },
    store,
    log: { log: (line) => lines.push(line), warn: (line) => lines.push(line) },
    loops: false
  });
  assert.equal(attached.enabled, true);
  assert.equal(store.getStatusPanel().host, host);
  const logged = lines.join('\n');
  assert.match(logged, /craft seed wrote nexus-craft\.json/);
  assert.equal(logged.includes(host), false);
  fs.rmSync(dir, { recursive: true, force: true });

  const held = [];
  const idle = {
    once(name, fn) { (events[name] ||= []).push(fn); events.ready = fn; },
    on() {},
    guilds: { fetch: async () => ({ id: '1016059608789434408', commands: { fetch: async () => ({ find: () => null }), create: async () => {} } }) },
    user: { id: '1516602943670059199' }
  };
  attachCraftModule(idle, {
    env: { SENTINAL_CRAFT_MODULE: 'true', DISCORD_GUILD_ID: '1016059608789434408' },
    config: { discord: {} },
    store: { getStatusPanel: () => ({ channelId: '1516602943670059109', host: '' }) },
    log: { log: (line) => held.push(line), warn: (line) => held.push(line) },
    loops: false
  });
  await events.ready();
  assert.ok(held.some((line) => line.includes('craft status loop not started: status panel host is missing')));
});


test('craft seed overwrite backs up existing files, replaces them, and does not log secrets', () => {
  const dir = tempDir();
  const oldSecret = 'old-vault-key-must-not-appear-in-logs-aaaaaaaa';
  const newSecret = 'new-vault-key-must-not-appear-in-logs-bbbbbbbb';
  const oldState = { version: 1, statusPanel: { host: 'old-host.example.test', javaPort: 25565 }, listings: {} };
  const newState = { version: 1, statusPanel: { host: 'new-host.example.test', javaPort: 25565, kind: 'geyser' }, listings: {} };
  const oldRcon = { version: 1, updatedBy: 'rotation-old', servers: { skyblock: { host: 'old-rcon.example.test', port: 25634, password: { v: 1 } } } };
  const newRcon = { version: 1, updatedBy: 'pending-overwrite', servers: { skyblock: { host: 'new-rcon.example.test', port: 25634, password: { v: 2 } } } };
  fs.writeFileSync(path.join(dir, 'nexus-craft.json'), `${JSON.stringify(oldState)}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'nexus-craft-rcon.json'), `${JSON.stringify(oldRcon)}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'nexus-craft-rcon-secret'), `${oldSecret}\n`, { mode: 0o600 });
  const lines = [];
  const now = new Date('2026-11-10T08:30:00.000Z');
  const result = seedCraftFiles({
    dir,
    now,
    env: {
      SENTINAL_CRAFT_SEED_OVERWRITE: 'true',
      SENTINAL_CRAFT_SEED_JSON: b64(`${JSON.stringify(newState)}\n`),
      SENTINAL_CRAFT_SEED_RCON_JSON: b64(JSON.stringify(newRcon)),
      SENTINAL_CRAFT_SEED_RCON_SECRET: newSecret
    },
    log: { log: (line) => lines.push(line) }
  });
  assert.equal(result.backupFolder, 'craft-seed-backup-2026-11-10T08-30-00-000Z');
  assert.deepEqual(result.backedUp.sort(), ['nexus-craft-rcon-secret', 'nexus-craft-rcon.json', 'nexus-craft.json']);
  assert.deepEqual(result.seeded.sort(), ['nexus-craft-rcon-secret', 'nexus-craft-rcon.json', 'nexus-craft.json']);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.skipped, []);
  const backupDir = path.join(dir, result.backupFolder);
  assert.equal(JSON.parse(fs.readFileSync(path.join(backupDir, 'nexus-craft.json'), 'utf8')).statusPanel.host, 'old-host.example.test');
  assert.equal(JSON.parse(fs.readFileSync(path.join(backupDir, 'nexus-craft-rcon.json'), 'utf8')).updatedBy, 'rotation-old');
  assert.equal(fs.readFileSync(path.join(backupDir, 'nexus-craft-rcon-secret'), 'utf8').trim(), oldSecret);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'nexus-craft.json'), 'utf8')).statusPanel.host, 'new-host.example.test');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'nexus-craft-rcon.json'), 'utf8')).updatedBy, 'pending-overwrite');
  assert.equal(fs.readFileSync(path.join(dir, 'nexus-craft-rcon-secret'), 'utf8').trim(), newSecret);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.join(dir, 'nexus-craft-rcon-secret')).mode & 0o777, 0o600);
  }
  const logged = lines.join('\n');
  assert.match(logged, /craft seed overwrite enabled/);
  assert.match(logged, /craft seed backed up nexus-craft\.json, nexus-craft-rcon\.json, nexus-craft-rcon-secret to craft-seed-backup-2026-11-10T08-30-00-000Z/);
  assert.match(logged, /craft seed replaced nexus-craft\.json/);
  assert.match(logged, /craft seed replaced nexus-craft-rcon\.json/);
  assert.match(logged, /craft seed replaced nexus-craft-rcon-secret/);
  assert.match(logged, /and SENTINAL_CRAFT_SEED_OVERWRITE/);
  for (const secret of [oldSecret, newSecret, 'old-host.example.test', 'new-host.example.test', 'old-rcon.example.test', 'new-rcon.example.test']) {
    assert.equal(logged.includes(secret), false, `log leaked ${secret}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('craft seed overwrite leaves a file in place when the new payload is invalid', () => {
  const dir = tempDir();
  const oldSecret = 'keep-this-vault-key-cccccccc';
  fs.writeFileSync(path.join(dir, 'nexus-craft.json'), `${JSON.stringify({ version: 1, statusPanel: { host: 'keep-host.example.test' } })}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'nexus-craft-rcon-secret'), `${oldSecret}\n`, { mode: 0o600 });
  const lines = [];
  const result = seedCraftFiles({
    dir,
    env: {
      SENTINAL_CRAFT_SEED_OVERWRITE: 'yes',
      SENTINAL_CRAFT_SEED_JSON: Buffer.from('not json', 'utf8').toString('base64'),
      SENTINAL_CRAFT_SEED_RCON_SECRET: oldSecret
    },
    log: { log: (line) => lines.push(line) }
  });
  assert.deepEqual(result.failed, ['nexus-craft.json']);
  assert.deepEqual(result.seeded, ['nexus-craft-rcon-secret']);
  assert.deepEqual(result.backedUp, ['nexus-craft-rcon-secret']);
  assert.match(result.backupFolder, /^craft-seed-backup-/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'nexus-craft.json'), 'utf8')).statusPanel.host, 'keep-host.example.test');
  assert.equal(fs.existsSync(path.join(dir, result.backupFolder, 'nexus-craft.json')), false);
  const logged = lines.join('\n');
  assert.equal(logged.includes('not json'), false);
  assert.equal(logged.includes(oldSecret), false);
  assert.equal(logged.includes('keep-host.example.test'), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
