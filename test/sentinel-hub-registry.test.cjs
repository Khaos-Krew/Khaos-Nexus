'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CORE_HUBS,
  DEFAULT_HUB_REGISTRY,
  createHubRegistry
} = require('../shared/sentinel-hub-registry.cjs');
const { DEFAULT_LAYOUT } = require('../shared/discord-automation.cjs');

test('default managed hubs resolve against the existing additive Discord layout', () => {
  assert.equal(DEFAULT_HUB_REGISTRY.layoutId, DEFAULT_LAYOUT.id);
  assert.equal(DEFAULT_HUB_REGISTRY.hubs.length, CORE_HUBS.length);
  const about = DEFAULT_HUB_REGISTRY.get('about');
  assert.equal(about.categoryId, 'information');
  assert.equal(about.channelId, 'about');
  assert.equal(about.blueprint.channelName, 'about');
  assert.equal(about.persistentMessageKey, 'community-about');
});

test('health-enabled hubs can be selected without hard-coding Discord channel IDs', () => {
  const hubs = DEFAULT_HUB_REGISTRY.withHealth();
  assert.deepEqual(hubs.map((hub) => hub.id), ['server-status']);
  assert.equal(hubs[0].blueprint.channelName, 'server-status');
  assert.equal(/^\d+$/.test(hubs[0].channelId), false);
});

test('module lookup returns enabled managed hubs only', () => {
  const registry = createHubRegistry({
    hubs: CORE_HUBS.map((hub) => hub.id === 'server-support' ? { ...hub, enabled: false } : hub)
  });
  assert.deepEqual(
    registry.forModule('game-server-control').map((hub) => hub.id),
    ['server-status']
  );
});

test('duplicate hub IDs are rejected', () => {
  assert.throws(() => createHubRegistry({ hubs: [CORE_HUBS[0], CORE_HUBS[0]] }), /Duplicate Sentinel hub ID/);
});

test('strict registry rejects references that are not present in the layout blueprint', () => {
  assert.throws(() => createHubRegistry({
    hubs: [{
      id: 'missing',
      name: 'Missing',
      categoryId: 'information',
      channelId: 'does-not-exist'
    }]
  }), /references missing layout channel/);
});
