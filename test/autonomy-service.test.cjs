'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AutonomyService, commandFor } = require('../main/services/autonomy-service.cjs');

function setup(overrides = {}) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-autonomy-'));
  const config = {
    general: { autoStartBot: true },
    discord: { ownerUserId: '1', operatorUserIds: ['2'] },
    servers: []
  };
  const configStore = {
    getConfig: () => JSON.parse(JSON.stringify(config)),
    getPublicConfig: () => ({ hasDiscordToken: true }),
    getRuntimeBootstrap: () => ({ discordToken: 'secret', config: JSON.parse(JSON.stringify(config)) }),
    createBackupPayload: (version) => ({ format: 'khaos-nexus-backup', formatVersion: 2, appVersion: version, config })
  };
  const supervisorState = { status: 'online', autoRestartBlocked: false };
  const supervisor = {
    getState: () => ({ ...supervisorState }),
    start: async () => { supervisorState.status = 'starting'; },
    restart: async () => { supervisorState.status = 'restarting'; }
  };
  const service = new AutonomyService({
    dataDirectory,
    configStore,
    supervisor,
    applicationMonitor: { processQueue: async () => ({ delivered: 0 }) },
    logger: { info() {}, warn() {}, error() {} },
    appVersion: '0.5.0',
    rconFactory: overrides.rconFactory || (() => ({ execute: async () => 'ok' })),
    intervalFactory: () => ({ unref() {} }),
    clearIntervalFactory() {},
    fetchImpl: overrides.fetchImpl,
    now: overrides.now || (() => Date.parse('2026-07-22T19:00:00Z'))
  });
  return { service, dataDirectory, config, supervisorState };
}

test('access control distinguishes owner, operator, viewer, and locked users', () => {
  const { service } = setup();
  service.setSettings({ ...service.getSettings(), accessControlEnabled: true, viewerUserIds: ['3'] });
  assert.equal(service.accessState({ user: { id: '1' } }).role, 'owner');
  assert.equal(service.accessState({ user: { id: '2' } }).role, 'operator');
  assert.equal(service.accessState({ user: { id: '3' } }).role, 'viewer');
  assert.equal(service.accessState({ user: { id: '4' } }).role, 'locked');
  assert.throws(() => service.assertAccess({ user: { id: '3' } }, 'operator', 'Restart'), /requires operator access/);
});

test('automatic backups are written, verified, and decorated with autonomy settings', () => {
  const { service, dataDirectory } = setup();
  const result = service.createAutomaticBackup('test');
  assert.equal(result.valid, true);
  const payload = JSON.parse(fs.readFileSync(result.filePath, 'utf8'));
  assert.equal(payload.autonomy.formatVersion, 1);
  assert.ok(payload.autonomy.settings.automaticBackupsEnabled);
  assert.ok(result.filePath.startsWith(path.join(dataDirectory, 'automatic-backups')));
});

test('guided recovery restarts a stopped bot and checks servers', async () => {
  const { service, config, supervisorState } = setup();
  supervisorState.status = 'stopped';
  config.servers.push({ id: 'server-1', name: 'Palworld', game: 'palworld', enabled: true, host: '127.0.0.1', port: 25575, password: 'pw' });
  const result = await service.runRecovery();
  assert.equal(result.ok, true);
  assert.equal(supervisorState.status, 'restarting');
  assert.match(result.actions.join(' '), /server connectivity/i);
});

test('maintenance warns and saves each enabled game server', async () => {
  const commands = [];
  const { service, config } = setup({ rconFactory: () => ({ execute: async (command) => { commands.push(command); return 'ok'; } }) });
  config.servers.push({ id: 'ark', name: 'ARK', game: 'ark', enabled: true, password: 'pw' });
  const result = await service.runMaintenance();
  assert.equal(result.ok, true);
  assert.ok(commands.some((command) => command.startsWith('Broadcast ')));
  assert.ok(commands.includes('SaveWorld'));
});

test('game-specific maintenance commands are mapped safely', () => {
  assert.equal(commandFor({ game: 'ark' }, 'save'), 'SaveWorld');
  assert.equal(commandFor({ game: 'palworld' }, 'save'), 'Save');
  assert.equal(commandFor({ game: 'generic', saveCommand: 'write-save' }, 'save'), 'write-save');
});
