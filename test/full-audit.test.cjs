'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const repairs = require('../main/audit-repair-extension.cjs');
const { createRuntimeAudit } = require('../bot/runtime-audit.cjs');

function directory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function timerHandle() { return { unref() {} }; }

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
}

test('production entry installs audited repairs and starts the complete bot runtime through the wrapper', () => {
  const root = path.join(__dirname, '..');
  const entry = fs.readFileSync(path.join(root, 'main', 'entry.cjs'), 'utf8');
  const repair = fs.readFileSync(path.join(root, 'main', 'audit-repair-extension.cjs'), 'utf8');
  const wrapper = fs.readFileSync(path.join(root, 'bot', 'audit-wrapper.cjs'), 'utf8');
  const botEntry = fs.readFileSync(path.join(root, 'bot', 'entry.cjs'), 'utf8');
  assert.match(entry, /audit-repair-extension\.cjs/);
  assert.ok(entry.indexOf('audit-repair-extension.cjs') < entry.indexOf("require('./main.cjs')"));
  assert.match(repair, /audit-wrapper\.cjs/);
  assert.match(wrapper, /require\('\.\/entry\.cjs'\)/);
  assert.match(botEntry, /installModuleRuntime/);
  assert.match(botEntry, /installDiscordAutomationRuntime/);
  assert.match(botEntry, /installStatusPanelRuntime/);
  assert.doesNotMatch(wrapper, /require\('\.\/index\.cjs'\)/);
});

test('manual monitor processing bypasses the scheduled delay and enforces the daily limit', async (t) => {
  repairs.patchApplicationMonitor();
  const { ApplicationMonitor } = require('../main/services/application-monitor.cjs');
  const dataDirectory = directory('khaos-audit-monitor-');
  t.after(() => fs.rmSync(dataDirectory, { recursive: true, force: true }));
  let now = Date.parse('2026-07-29T00:00:00Z');
  let calls = 0;
  const config = { monitor: { autoReportEnabled: true, reportRepository: 'Khaos-Krew/Khaos-Nexus', reportLabels: [], duplicateWindowHours: 72, maxReportsPerDay: 1 } };
  const timers = {};
  const monitor = new ApplicationMonitor({
    configStore: {
      getConfig: () => JSON.parse(JSON.stringify(config)),
      getPublicConfig: () => ({ hasGithubToken: true }),
      getGithubToken: () => 'token'
    },
    logger: { info() {}, warn() {}, error() {} },
    createReport: () => ({ application: {}, system: {}, configuration: {}, runtime: {}, recentLogs: [] }),
    dataDirectory,
    now: () => now,
    fetchImpl: async () => { calls += 1; return response(201, { number: 90, html_url: 'https://github.com/Khaos-Krew/Khaos-Nexus/issues/90' }); },
    setTimeoutFactory: (callback, delay) => { timers.timeout = { callback, delay }; return timerHandle(); },
    clearTimeoutFactory() {},
    setIntervalFactory: (callback, delay) => { timers.interval = { callback, delay }; return timerHandle(); },
    clearIntervalFactory() {}
  });
  t.after(() => monitor.destroy());
  await monitor.capture(Object.assign(new Error('first'), { id: 'FIRST' }));
  const first = await monitor.processQueue();
  assert.equal(first.delivered, 1);
  assert.equal(calls, 1);

  now += 1000;
  await monitor.capture(Object.assign(new Error('second'), { id: 'SECOND' }));
  const second = await monitor.processQueue();
  assert.equal(second.remaining, 1);
  assert.equal(calls, 1);
  assert.match(monitor.getState().lastError, /daily delivery limit/i);
});

test('monitor starts recurring maintenance even when the startup batch throws', async (t) => {
  repairs.patchApplicationMonitor();
  const { ApplicationMonitor, ERROR_BATCH_INTERVAL_MS } = require('../main/services/application-monitor.cjs');
  const dataDirectory = directory('khaos-audit-monitor-timer-');
  t.after(() => fs.rmSync(dataDirectory, { recursive: true, force: true }));
  const timers = {};
  const monitor = new ApplicationMonitor({
    configStore: { getConfig: () => ({ monitor: { autoReportEnabled: true, reportRepository: 'Khaos-Krew/Khaos-Nexus', reportLabels: [], duplicateWindowHours: 72, maxReportsPerDay: 10 } }), getPublicConfig: () => ({ hasGithubToken: true }), getGithubToken: () => 'token' },
    logger: { info() {}, warn() {}, error() {} },
    createReport: () => ({ runtime: {}, recentLogs: [] }),
    dataDirectory,
    setTimeoutFactory: (callback, delay) => { timers.timeout = { callback, delay }; return timerHandle(); },
    clearTimeoutFactory() {},
    setIntervalFactory: (callback, delay) => { timers.interval = { callback, delay }; return timerHandle(); },
    clearIntervalFactory() {}
  });
  t.after(() => monitor.destroy());
  monitor.runBatchCycle = async () => { throw new Error('simulated startup batch failure'); };
  await timers.timeout.callback();
  assert.equal(timers.interval.delay, ERROR_BATCH_INTERVAL_MS);
});

test('server health drops removed and disabled servers instead of retaining stale attention', async (t) => {
  repairs.patchAutonomyService();
  const { AutonomyService } = require('../main/services/autonomy-service.cjs');
  const dataDirectory = directory('khaos-audit-autonomy-');
  t.after(() => fs.rmSync(dataDirectory, { recursive: true, force: true }));
  const config = { general: { autoStartBot: false }, discord: {}, servers: [{ id: 'live', name: 'Live', game: 'ark', enabled: true, password: 'pw' }, { id: 'disabled', name: 'Disabled', game: 'ark', enabled: false, password: 'pw' }] };
  const service = new AutonomyService({
    dataDirectory,
    configStore: {
      getConfig: () => JSON.parse(JSON.stringify(config)),
      getPublicConfig: () => ({ hasDiscordToken: false }),
      getRuntimeBootstrap: () => ({ config: JSON.parse(JSON.stringify(config)) }),
      createBackupPayload: () => ({ format: 'khaos-nexus-backup', formatVersion: 2, config })
    },
    supervisor: { getState: () => ({ status: 'stopped' }) },
    applicationMonitor: {},
    logger: { info() {}, warn() {}, error() {} },
    appVersion: '0.18.22',
    rconFactory: () => ({ execute: async () => 'online' }),
    intervalFactory: () => timerHandle(),
    clearIntervalFactory() {}
  });
  t.after(() => service.destroy());
  service.state.serverHealth = { removed: { status: 'offline', failures: 99, detail: 'stale' }, disabled: { status: 'offline', failures: 4, detail: 'disabled' } };
  const result = await service.checkServers();
  assert.deepEqual(Object.keys(result.health), ['live']);
  assert.equal(service.getState().attention.length, 0);
});

test('scheduler closes interrupted runs without replaying destructive actions', (t) => {
  repairs.patchServerScheduler();
  const { ServerSchedulerService } = require('../main/services/server-scheduler-service.cjs');
  const { normalizeSchedulerConfig } = require('../shared/server-scheduler.cjs');
  const dataDirectory = directory('khaos-audit-scheduler-');
  t.after(() => fs.rmSync(dataDirectory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dataDirectory, 'server-scheduler-history.json'), JSON.stringify([{ id: 'run-1', scheduleId: 'schedule-1', scheduleName: 'Restart', action: 'restart', serverIds: ['server-1'], outcome: 'running', stage: 'shutdown', startedAt: '2026-07-28T23:00:00Z' }]));
  fs.writeFileSync(path.join(dataDirectory, 'server-scheduler-state.json'), JSON.stringify({ occurrences: { 'schedule-1:2026-07-28:2300': { finalStarted: true, completed: false, updatedAt: '2026-07-28T23:00:00Z' } } }));
  const schedulerConfig = normalizeSchedulerConfig({ schedules: [] });
  const service = new ServerSchedulerService({
    dataDirectory,
    configStore: { getSchedulerConfig: () => schedulerConfig, getRuntimeBootstrap: () => ({ config: { servers: [] } }) },
    logger: { info() {}, warn() {}, error() {} },
    intervalFactory: () => timerHandle(),
    clearIntervalFactory() {}
  });
  service.start();
  const state = service.getState();
  assert.equal(state.history[0].outcome, 'failed');
  assert.match(state.history[0].summary, /without repeating/i);
  assert.equal(Object.values(service.runtime.occurrences)[0].completed, true);
  service.destroy();
});

test('portable updater returns to a retryable downloaded state when installation cannot launch', () => {
  repairs.patchUpdateService();
  const { UpdateService } = require('../main/services/update-service.cjs');
  const dataDirectory = directory('khaos-audit-update-');
  const service = new UpdateService({
    logger: { info() {}, warn() {}, error() {} },
    appAdapter: { isPackaged: true, getVersion: () => '0.18.22', getPath: () => dataDirectory, quit() {} },
    updater: new EventEmitter(),
    env: { PORTABLE_EXECUTABLE_FILE: path.join(dataDirectory, 'Khaos Nexus.exe') }
  });
  service.stagedPath = path.join(dataDirectory, 'missing-update.exe');
  service.set({ status: 'downloaded', canInstall: true });
  assert.throws(() => service.install(), /missing/i);
  assert.equal(service.getState().status, 'downloaded');
  assert.equal(service.getState().canInstall, true);
  service.destroy();
  fs.rmSync(dataDirectory, { recursive: true, force: true });
});

class FakeClient extends EventEmitter {}

test('supervised bot accepts live configuration replacements and refreshes status-panel buttons', async () => {
  const parent = new EventEmitter();
  const posted = [];
  parent.postMessage = (value) => posted.push(value);
  let edited = null;
  let reply = null;
  const audit = createRuntimeAudit({
    parentPort: parent,
    ClientClass: FakeClient,
    now: () => Date.parse('2026-07-29T01:00:00Z'),
    statusServiceFactory: () => ({ snapshot: async () => ({ status: 'online', serverName: 'Nexus Palworld', game: 'palworld', connectionLabel: 'Palworld REST', version: '1.0', players: 2, maxPlayers: 16, fps: 60, frameTime: 16.7, uptimeSeconds: 300, worldDay: 4, playerNames: ['Kirito', 'Asuna'], checkedAt: '2026-07-29T01:00:00.000Z', error: '' }) })
  });
  const original = { discordToken: 'old', config: { servers: [], statusPanels: { panels: [] } } };
  parent.emit('message', { data: { type: 'bootstrap', payload: original } });
  parent.emit('message', { data: { type: 'config-update', payload: { discordToken: 'new', config: { servers: [{ id: 'pal' }], statusPanels: { panels: [{ id: 'panel-1', name: 'Palworld', serverId: 'pal', enabled: true, title: 'Palworld Status', description: 'Live', color: '#e3264f', refreshMinutes: 5, showPlayerNames: true }] } } } } });
  assert.equal(audit.getBootstrap(), original);
  assert.equal(original.discordToken, 'new');
  assert.equal(original.config.servers.length, 1);

  const interaction = {
    customId: 'kn-status:refresh:panel-1',
    user: { id: 'user-1' },
    isButton: () => true,
    deferred: false,
    replied: false,
    deferReply: async () => { interaction.deferred = true; },
    editReply: async (value) => { reply = value; },
    reply: async (value) => { reply = value; },
    message: { edit: async (value) => { edited = value; } }
  };
  const handled = await audit.handleStatusButton(interaction);
  assert.equal(handled, true);
  assert.equal(edited.embeds[0].title, 'Palworld Status');
  assert.match(reply.content, /refreshed/i);
  assert.ok(posted.some((item) => item.type === 'status-panel-refreshed' && item.payload.panelId === 'panel-1'));
});