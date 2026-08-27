'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderSentinelHub, resolveBannerUrl } = require('../shared/sentinel-hub-renderer.cjs');

const hub = Object.freeze({
  name: 'Game Server Status',
  moduleId: 'game-server-control',
  bannerKey: 'game-server-operations',
  healthEnabled: true,
});

test('hub renderer exposes exactly the approved public health labels', () => {
  const online = renderSentinelHub({ hub, state: { health: 'healthy' }, now: '2026-08-27T05:00:00.000Z' });
  const maintenance = renderSentinelHub({ hub, state: { health: 'restarting' }, now: '2026-08-27T05:00:00.000Z' });
  const offline = renderSentinelHub({ hub, state: { health: 'degraded' }, now: '2026-08-27T05:00:00.000Z' });

  assert.equal(online.embeds[0].fields[0].value, '🟢 Online');
  assert.equal(maintenance.embeds[0].fields[0].value, '🟡 Maintenance');
  assert.equal(offline.embeds[0].fields[0].value, '🔴 Offline');
  assert.doesNotMatch(JSON.stringify([online, maintenance, offline]), /Degraded|Partial Service|Not Configured/);
});

test('unknown health fails closed to Offline', () => {
  const payload = renderSentinelHub({ hub, state: { health: 'mystery-state' }, now: '2026-08-27T05:00:00.000Z' });
  assert.equal(payload.embeds[0].fields[0].value, '🔴 Offline');
});

test('renderer has a safe no-banner fallback and accepts only safe Discord image URLs', () => {
  assert.equal(resolveBannerUrl('missing', {}), null);
  assert.equal(resolveBannerUrl('x', { x: '/local/file.png' }), null);
  assert.equal(resolveBannerUrl('x', { x: 'http://insecure.example/banner.png' }), null);
  assert.equal(resolveBannerUrl('x', { x: 'https://cdn.example/banner.png' }), 'https://cdn.example/banner.png');
  assert.equal(resolveBannerUrl('x', { x: 'attachment://banner.png' }), 'attachment://banner.png');

  const noBanner = renderSentinelHub({ hub, state: {}, bannerMap: {}, now: '2026-08-27T05:00:00.000Z' });
  assert.equal(Object.hasOwn(noBanner.embeds[0], 'image'), false);
});

test('renderer whitelists presentation data and never serializes sensitive adapter input', () => {
  const payload = renderSentinelHub({
    hub,
    state: {
      health: 'online',
      description: 'Public status.',
      moduleInfo: 'ARK Ascended',
      freshness: 'Checked moments ago',
      providerId: 'SECRET_PROVIDER_ID',
      serverId: 'SECRET_SERVER_ID',
      credentials: { password: 'SECRET_PASSWORD' },
      token: 'SECRET_TOKEN',
      adminPassword: 'SECRET_ADMIN',
      serverPassword: 'SECRET_JOIN_PASSWORD',
    },
    now: '2026-08-27T05:00:00.000Z',
  });

  const serialized = JSON.stringify(payload);
  assert.match(serialized, /Public status/);
  assert.match(serialized, /ARK Ascended/);
  assert.doesNotMatch(serialized, /SECRET_PROVIDER_ID|SECRET_SERVER_ID|SECRET_PASSWORD|SECRET_TOKEN|SECRET_ADMIN|SECRET_JOIN_PASSWORD/);
});

test('renderer caps presentation strings and disables mentions', () => {
  const payload = renderSentinelHub({
    hub: { ...hub, name: 'x'.repeat(400) },
    state: { description: '@everyone ' + 'd'.repeat(5000), moduleInfo: 'm'.repeat(2000) },
    now: '2026-08-27T05:00:00.000Z',
  });

  assert.equal(payload.embeds[0].title.length, 256);
  assert.equal(payload.embeds[0].description.length, 3000);
  assert.equal(payload.embeds[0].fields.find((field) => field.name === 'Module').value.length, 900);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
});
