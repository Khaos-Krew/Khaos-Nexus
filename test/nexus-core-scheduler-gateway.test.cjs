'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServerSchedulerService } = require('../main/services/server-scheduler-service.cjs');
const {
  patchScheduler,
  runtimeFor,
  capabilityForSchedulerOperation
} = require('../main/nexus-core-scheduler-gateway-extension.cjs');

function serviceHarness() {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-nexus-scheduler-core-'));
  const server = {
    id: 'rag-01',
    name: 'Ragnarok',
    game: 'ark',
    enabled: true,
    host: '127.0.0.1',
    port: 27020,
    password: 'protected-runtime-secret'
  };
  const calls = [];
  const configStore = {
    getRuntimeBootstrap: () => ({ config: { servers: [server] } }),
    getSchedulerConfig: () => ({ settings: { historyLimit: 50 }, schedules: [] })
  };
  const service = new ServerSchedulerService({
    dataDirectory,
    configStore,
    logger: { error() {}, warn() {}, info() {} },
    autonomy: null,
    connectionFactory: () => ({
      action: async (operation, payload) => {
        calls.push({ operation, payload });
        return { operation, accepted: true };
      }
    }),
    now: () => Date.parse('2026-08-11T06:30:00Z'),
    intervalFactory: () => ({ unref() {} }),
    clearIntervalFactory: () => {},
    sleep: async () => {}
  });
  service.addDetail = () => null;
  return { dataDirectory, server, calls, service };
}

test('scheduler Core mapping exposes only approved mutating operations', () => {
  assert.equal(capabilityForSchedulerOperation('announce'), 'game.server.broadcast');
  assert.equal(capabilityForSchedulerOperation('save'), 'game.server.save');
  assert.equal(capabilityForSchedulerOperation('shutdown'), 'game.server.restart');
  assert.equal(capabilityForSchedulerOperation('status'), null);
  assert.equal(capabilityForSchedulerOperation('raw-console'), null);
});

test('scheduler save executes once and duplicate replay is suppressed by Nexus Core', async () => {
  patchScheduler();
  const { service, server, calls } = serviceHarness();
  const schedule = { id: 'schedule-1', name: 'Daily Save' };

  const first = await service.actionAcrossServers(schedule, [server], 'save', {}, 'run-1', 'save');
  const replay = await service.actionAcrossServers(schedule, [server], 'save', {}, 'run-1', 'save');

  assert.equal(first[0].ok, true);
  assert.equal(first[0].duplicate, false);
  assert.equal(replay[0].ok, true);
  assert.equal(replay[0].duplicate, true);
  assert.equal(calls.length, 1);

  const core = runtimeFor(service);
  const chain = core.journal.list({ correlationId: 'run-1' });
  assert.deepEqual(chain.map((record) => record.event.type), [
    'core.action.requested',
    'core.action.succeeded',
    'core.action.requested',
    'core.action.duplicate'
  ]);
  assert.equal(chain.some((record) => JSON.stringify(record).includes('protected-runtime-secret')), false);
});

test('scheduler shutdown receives only the narrow restart capability grant', async () => {
  patchScheduler();
  const { service, server, calls } = serviceHarness();
  const schedule = { id: 'schedule-2', name: 'Daily Restart' };

  const result = await service.actionAcrossServers(
    schedule,
    [server],
    'shutdown',
    { waittime: 0, message: 'Restarting' },
    'run-2',
    'shutdown'
  );

  assert.equal(result[0].ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    operation: 'shutdown',
    payload: { waittime: 0, message: 'Restarting' }
  });

  const requested = runtimeFor(service).journal.list({ correlationId: 'run-2', type: 'core.action.requested' })[0];
  assert.deepEqual(requested.event.payload.requiredCapabilities, ['game.server.restart']);
});

test('unsupported scheduler operations keep the existing read path instead of receiving mutation authority', async () => {
  patchScheduler();
  const { service, server, calls } = serviceHarness();
  const schedule = { id: 'schedule-3', name: 'Status Check' };

  const result = await service.actionAcrossServers(schedule, [server], 'status', {}, 'run-3', 'status');
  assert.equal(result[0].ok, true);
  assert.equal(calls.length, 1);
  assert.equal(runtimeFor(service).journal.list({ correlationId: 'run-3' }).length, 0);
});
