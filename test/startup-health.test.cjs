'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  MINIMUM_SPLASH_MS,
  profileSummary,
  recoverProfileIfNeeded
} = require('../main/startup-health-extension.cjs');

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-startup-health-'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function meaningfulConfig(name, serverCount = 1) {
  return {
    schemaVersion: 3,
    general: {
      autoStartBot: false,
      autoRestart: true,
      minimizeToTray: true,
      startWithWindows: false,
      checkUpdates: true
    },
    discord: {
      guildId: '123456789012345678',
      ownerUserId: '234567890123456789',
      operatorUserIds: [],
      oauthClientId: '345678901234567890',
      oauthRedirectUri: 'http://127.0.0.1:43119/callback',
      oauthScopes: ['identify', 'guilds']
    },
    monitor: {
      autoReportEnabled: true,
      reportRepository: 'Khaos-Krew/Khaos-Nexus',
      reportLabels: ['bug'],
      duplicateWindowHours: 72,
      maxReportsPerDay: 10
    },
    servers: Array.from({ length: serverCount }, (_value, index) => ({
      id: `server-${index + 1}`,
      name: `${name} ${index + 1}`,
      game: 'ark',
      host: '127.0.0.1',
      port: 27020 + index,
      enabled: true
    }))
  };
}

function withProfileEnvironment(root, callback) {
  const previous = {
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    PORTABLE_EXECUTABLE_DIR: process.env.PORTABLE_EXECUTABLE_DIR
  };
  process.env.APPDATA = path.join(root, 'appdata');
  process.env.LOCALAPPDATA = path.join(root, 'localappdata');
  process.env.PORTABLE_EXECUTABLE_DIR = path.join(root, 'portable');
  fs.mkdirSync(process.env.APPDATA, { recursive: true });
  fs.mkdirSync(process.env.LOCALAPPDATA, { recursive: true });
  fs.mkdirSync(process.env.PORTABLE_EXECUTABLE_DIR, { recursive: true });
  try { return callback(); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('startup health keeps the splash visible for at least thirty seconds', () => {
  assert.equal(MINIMUM_SPLASH_MS, 30000);
});

test('transactional recovery restores a recorded v0.17 profile over an empty v0.18 profile', () => {
  const root = temporaryRoot();
  withProfileEnvironment(root, () => {
    const destination = path.join(root, 'Khaos Nexus');
    const backup = `${destination}.pre-migration-1234`;
    fs.mkdirSync(destination, { recursive: true });
    writeJson(path.join(destination, 'config.json'), {
      schemaVersion: 3,
      general: {},
      discord: {},
      monitor: {},
      servers: []
    });
    writeJson(path.join(backup, 'config.json'), meaningfulConfig('Recovered Server', 2));
    fs.writeFileSync(path.join(backup, 'secrets.bin'), Buffer.alloc(96, 7));
    writeJson(path.join(backup, 'status-panels.json'), [{ id: 'panel-1', name: 'Recovered Panel' }]);
    writeJson(path.join(destination, 'user-data-migration.json'), {
      source: path.join(root, 'wrong-profile'),
      backup,
      migrated: true
    });

    const before = profileSummary(destination);
    const result = recoverProfileIfNeeded(destination);
    const restored = profileSummary(destination);
    const restoredConfig = JSON.parse(fs.readFileSync(path.join(destination, 'config.json'), 'utf8'));

    assert.equal(before.configSignal, 0);
    assert.equal(result.recovered, true);
    assert.equal(restored.configValid, true);
    assert.equal(restoredConfig.servers.length, 2);
    assert.equal(restoredConfig.servers[0].name, 'Recovered Server 1');
    assert.equal(fs.existsSync(result.backup), true);
    assert.equal(fs.existsSync(path.join(destination, 'status-panels.json')), true);
  });
});

test('a meaningful current v0.17 profile is never replaced by a weaker candidate', () => {
  const root = temporaryRoot();
  withProfileEnvironment(root, () => {
    const destination = path.join(root, 'Khaos Nexus');
    const weaker = path.join(process.env.APPDATA, 'khaos-nexus');
    writeJson(path.join(destination, 'config.json'), meaningfulConfig('Current Server', 3));
    fs.writeFileSync(path.join(destination, 'secrets.bin'), Buffer.alloc(128, 9));
    writeJson(path.join(destination, 'server-scheduler-state.json'), { schedules: [{ id: 'daily' }] });
    writeJson(path.join(weaker, 'config.json'), meaningfulConfig('Old Server', 1));

    const result = recoverProfileIfNeeded(destination);
    const current = JSON.parse(fs.readFileSync(path.join(destination, 'config.json'), 'utf8'));

    assert.equal(result.recovered, false);
    assert.equal(current.servers.length, 3);
    assert.equal(current.servers[0].name, 'Current Server 1');
  });
});

test('invalid recovered data fails verification without destroying the current profile', () => {
  const root = temporaryRoot();
  withProfileEnvironment(root, () => {
    const destination = path.join(root, 'Khaos Nexus');
    const backup = `${destination}.pre-migration-bad`;
    writeJson(path.join(destination, 'config.json'), meaningfulConfig('Current Server', 1));
    fs.mkdirSync(backup, { recursive: true });
    fs.writeFileSync(path.join(backup, 'config.json'), '{not valid json', 'utf8');
    writeJson(path.join(destination, 'user-data-migration.json'), { backup, migrated: true });

    const result = recoverProfileIfNeeded(destination);
    const current = JSON.parse(fs.readFileSync(path.join(destination, 'config.json'), 'utf8'));

    assert.equal(result.recovered, false);
    assert.equal(current.servers[0].name, 'Current Server 1');
  });
});
