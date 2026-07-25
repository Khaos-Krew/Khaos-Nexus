'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DiscordObservabilityService, isNewerVersion, ageText } = require('../main/services/discord-observability-service.cjs');
const { normalizeDiscordObservability } = require('../shared/discord-observability.cjs');

function makeStore(overrides = {}) {
  let config = normalizeDiscordObservability({
    enabled: true,
    heartbeatIntervalMinutes: 15,
    routes: {
      releases: { enabled: true, channelId: '1111111111' },
      errors: { enabled: true, channelId: '2222222222', minimumSeverity: 'error' },
      heartbeat: { enabled: true, channelId: '3333333333' },
      health: { enabled: true, channelId: '4444444444', minimumSeverity: 'info' }
    },
    ...overrides
  });
  return {
    getDiscordObservability: () => JSON.parse(JSON.stringify(config)),
    setDiscordObservability: (next) => { config = normalizeDiscordObservability(next); },
    getConfig: () => ({ discordObservability: config }),
    getRuntimeBootstrap: () => ({ discordToken: 'token-value', config: { discord: { guildId: '5555555555' }, servers: [] } }),
    read: () => config
  };
}

function makeRest() {
  const calls = [];
  return {
    calls,
    get: async (route) => {
      calls.push({ method: 'get', route });
      return [
        { id: '1111111111', name: 'updates', type: 0, position: 1 },
        { id: '2222222222', name: 'errors', type: 0, position: 2 },
        { id: '9999999999', name: 'voice', type: 2, position: 3 }
      ];
    },
    post: async (route, options) => {
      calls.push({ method: 'post', route, body: options.body });
      return { id: String(9000000000 + calls.length) };
    },
    patch: async (route, options) => {
      calls.push({ method: 'patch', route, body: options.body });
      return { id: route.split('/').pop() };
    }
  };
}

function makeService(options = {}) {
  const store = options.store || makeStore();
  const rest = options.rest || makeRest();
  const now = options.now || (() => new Date('2026-07-24T06:00:00.000Z'));
  const service = new DiscordObservabilityService({
    configStore: store,
    logger: { info() {}, warn() {}, error() {} },
    restFactory: () => rest,
    now,
    schedulerIntervalMs: 60 * 60 * 1000,
    stateProvider: () => ({
      app: { version: '0.14.0' },
      bot: { status: 'online', heartbeat: { ping: 50, guildCount: 1, memoryMb: 90, time: '2026-07-24T05:59:56.000Z' } },
      config: { servers: [], general: { modules: { discord: true, palworld: true } } },
      update: { status: 'current' },
      autonomy: { access: { role: 'owner' } }
    })
  });
  return { service, store, rest };
}

test('version comparison handles stable semantic versions', () => {
  assert.equal(isNewerVersion('0.14.0', '0.13.3'), true);
  assert.equal(isNewerVersion('0.13.3', '0.13.3'), false);
  assert.equal(isNewerVersion('0.13.2', '0.13.3'), false);
});

test('age text reports seconds, minutes, and hours', () => {
  const now = new Date('2026-07-24T06:00:00.000Z').getTime();
  assert.equal(ageText('2026-07-24T05:59:55.000Z', now), '5 seconds');
  assert.equal(ageText('2026-07-24T05:50:00.000Z', now), '10 minutes');
  assert.equal(ageText('2026-07-24T03:00:00.000Z', now), '3 hours');
});

test('channel discovery returns only text and announcement channels', async (t) => {
  const { service } = makeService();
  t.after(() => service.stop());
  const channels = await service.listChannels();
  assert.deepEqual(channels.map((channel) => channel.name), ['updates', 'errors']);
});

test('error delivery posts to the configured error channel and records history', async (t) => {
  const { service, store, rest } = makeService();
  t.after(() => service.stop());
  const result = await service.deliver('errors', {
    id: '1015b6d87b13', severity: 'critical', source: 'desktop-main', summary: 'Redacted failure', time: '2026-07-24T06:00:00.000Z'
  });
  assert.equal(result.sent, true);
  assert.equal(rest.calls.at(-1).method, 'post');
  assert.match(rest.calls.at(-1).route, /2222222222/);
  assert.equal(store.read().deliveryHistory.at(-1).type, 'errors');
  assert.equal(store.read().deliveryHistory.at(-1).status, 'sent');
});

test('heartbeat edits one persistent message after first publication', async (t) => {
  const store = makeStore();
  const rest = makeRest();
  const { service } = makeService({ store, rest });
  t.after(() => service.stop());

  const first = await service.refreshHeartbeat({ force: true });
  assert.equal(first.status, 'sent');
  const messageId = store.read().routes.heartbeat.messageId;
  assert.ok(messageId);

  const second = await service.refreshHeartbeat({ force: true });
  assert.equal(second.status, 'edited');
  assert.equal(rest.calls.filter((call) => call.method === 'post').length, 1);
  assert.equal(rest.calls.filter((call) => call.method === 'patch').length, 1);
});

test('health feed sends state transitions but not the initial state', async (t) => {
  const { service, rest } = makeService();
  t.after(() => service.stop());
  await service.handleSupervisorState({ status: 'starting' });
  assert.equal(rest.calls.filter((call) => call.method === 'post').length, 0);
  await service.handleSupervisorState({ status: 'online' });
  assert.equal(rest.calls.filter((call) => call.method === 'post').length, 1);
});

test('release feed announces a stable version once', async (t) => {
  const { service, store, rest } = makeService();
  t.after(() => service.stop());
  await service.handleUpdateState({ currentVersion: '0.13.3', latestVersion: '0.14.0', status: 'available', releaseUrl: 'https://github.com/Khaos-Krew/Khaos-Nexus/releases/tag/v0.14.0' });
  await service.handleUpdateState({ currentVersion: '0.13.3', latestVersion: '0.14.0', status: 'available', releaseUrl: 'https://github.com/Khaos-Krew/Khaos-Nexus/releases/tag/v0.14.0' });
  assert.equal(rest.calls.filter((call) => call.method === 'post').length, 1);
  assert.deepEqual(store.read().announcedVersions, ['0.14.0']);
});

test('minimum severity blocks informational error-route events', async (t) => {
  const { service, rest } = makeService();
  t.after(() => service.stop());
  const result = await service.deliver('errors', { id: 'info', severity: 'info', summary: 'Not severe enough' });
  assert.equal(result.skipped, true);
  assert.equal(rest.calls.length, 0);
});
