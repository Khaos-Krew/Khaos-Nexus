'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ROUTE_TYPES,
  normalizeDiscordObservability,
  routeReady,
  severityAtLeast,
  payloadFor,
  heartbeatPayload,
  errorPayload
} = require('../shared/discord-observability.cjs');

test('observability config normalizes all four routes', () => {
  const config = normalizeDiscordObservability({
    enabled: true,
    heartbeatIntervalMinutes: 0,
    routes: {
      releases: { enabled: true, channelId: '1234567890' },
      errors: { enabled: true, channelId: 'not-a-channel', cooldownSeconds: 999999 },
      heartbeat: { enabled: true, channelId: '2234567890', messageId: '3234567890' }
    },
    deliveryHistory: Array.from({ length: 400 }, (_, index) => ({ id: String(index), type: 'errors', status: 'sent' }))
  });
  assert.deepEqual(Object.keys(config.routes), ROUTE_TYPES);
  assert.equal(config.heartbeatIntervalMinutes, 1);
  assert.equal(config.routes.releases.channelId, '1234567890');
  assert.equal(config.routes.errors.channelId, '');
  assert.equal(config.routes.errors.cooldownSeconds, 86400);
  assert.equal(config.routes.heartbeat.messageId, '3234567890');
  assert.equal(config.deliveryHistory.length, 250);
});

test('route readiness requires global enable, route enable, and channel', () => {
  assert.equal(routeReady({ enabled: false, routes: { errors: { enabled: true, channelId: '1234567890' } } }, 'errors'), false);
  assert.equal(routeReady({ enabled: true, routes: { errors: { enabled: false, channelId: '1234567890' } } }, 'errors'), false);
  assert.equal(routeReady({ enabled: true, routes: { errors: { enabled: true, channelId: '1234567890' } } }, 'errors'), true);
});

test('severity comparison is ordered', () => {
  assert.equal(severityAtLeast('critical', 'error'), true);
  assert.equal(severityAtLeast('warning', 'error'), false);
  assert.equal(severityAtLeast('error', 'error'), true);
});

test('error payload is mention-safe and redacted by contract', () => {
  const payload = errorPayload({ mentionRoleId: '9999999999' }, {
    id: '1015b6d87b13',
    source: 'desktop-main-uncaught-exception',
    severity: 'critical',
    message: 'Renderer lifecycle failed. Protected configuration omitted.',
    issueUrl: 'https://github.com/Khaos-Krew/Khaos-Nexus/issues/21'
  });
  assert.equal(payload.allowed_mentions.parse.length, 0);
  assert.deepEqual(payload.allowed_mentions.roles, ['9999999999']);
  assert.match(payload.content, /<@&9999999999>/);
  assert.match(payload.embeds[0].fields[0].value, /1015b6d87b13/);
  assert.doesNotMatch(JSON.stringify(payload), /password|token|109\.230\./i);
});

test('heartbeat payload uses one public-safe status snapshot', () => {
  const payload = heartbeatPayload({}, {
    appVersion: '0.14.0',
    bot: { status: 'online', heartbeat: { ping: 42, guildCount: 1, memoryMb: 100 } },
    servers: [{ name: 'Palworld', online: true }, { name: 'ARK', online: false }],
    enabledModules: 12,
    accessRole: 'owner',
    updateStatus: 'Up to date',
    heartbeatAge: '4 seconds',
    lastErrorId: null
  });
  assert.equal(payload.embeds.length, 1);
  assert.match(JSON.stringify(payload), /Palworld/);
  assert.match(JSON.stringify(payload), /ARK/);
  assert.match(JSON.stringify(payload), /0\.14\.0/);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
});

test('payload router returns the requested stream payload', () => {
  for (const type of ROUTE_TYPES) {
    const payload = payloadFor(type, {}, type === 'heartbeat' ? { bot: {}, servers: [] } : { title: type });
    assert.ok(Array.isArray(payload.embeds));
    assert.deepEqual(payload.allowed_mentions.parse, []);
  }
});
