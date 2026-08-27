'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_HUB_REGISTRY } = require('../shared/sentinel-hub-registry.cjs');
const {
  planHubBindingSync,
  planPersistentHubMessage,
  withChannelBinding,
  withMessageBinding,
} = require('../shared/sentinel-hub-bindings.cjs');

test('hub binding keeps a persisted Discord channel ID even after rename', () => {
  const plan = planHubBindingSync({
    registry: DEFAULT_HUB_REGISTRY,
    bindings: {
      about: { discordChannelId: '610000000000000001' },
    },
    discordChannels: [{ id: '610000000000000001', name: 'renamed-about' }],
  });
  const about = plan.find((entry) => entry.hubId === 'about');
  assert.equal(about.action, 'keep');
  assert.equal(about.reason, 'id');
});

test('hub binding adopts one existing blueprint-name match instead of creating a duplicate', () => {
  const plan = planHubBindingSync({
    registry: DEFAULT_HUB_REGISTRY,
    bindings: {},
    discordChannels: [{ id: '610000000000000002', name: 'about' }],
  });
  const about = plan.find((entry) => entry.hubId === 'about');
  assert.equal(about.action, 'adopt');
  assert.equal(about.discordChannelId, '610000000000000002');
});

test('ambiguous hub channel matches require review and never auto-create', () => {
  const plan = planHubBindingSync({
    registry: DEFAULT_HUB_REGISTRY,
    bindings: { about: { aliases: ['about-us'] } },
    discordChannels: [
      { id: '610000000000000002', name: 'about-us' },
      { id: '610000000000000003', name: 'about-us' },
    ],
  });
  const about = plan.find((entry) => entry.hubId === 'about');
  assert.equal(about.action, 'review');
  assert.deepEqual(about.candidates, ['610000000000000002', '610000000000000003']);
});

test('persisting adopted channel makes repeat sync idempotent', () => {
  const binding = withChannelBinding({ hubId: 'about' }, '610000000000000002');
  const plan = planHubBindingSync({
    registry: DEFAULT_HUB_REGISTRY,
    bindings: { about: binding },
    discordChannels: [{ id: '610000000000000002', name: 'about' }],
  });
  assert.equal(plan.find((entry) => entry.hubId === 'about').action, 'keep');
});

test('persistent hub message is reused when the persisted message still exists', () => {
  const binding = withMessageBinding({ hubId: 'about' }, '620000000000000001');
  const plan = planPersistentHubMessage({
    hubId: 'about',
    binding,
    messages: [{ id: '620000000000000001' }],
  });
  assert.deepEqual(plan, {
    action: 'keep',
    discordMessageId: '620000000000000001',
    reason: 'id',
  });
});

test('missing persisted message plans exactly one replacement', () => {
  const binding = withMessageBinding({ hubId: 'about' }, '620000000000000001');
  const plan = planPersistentHubMessage({ hubId: 'about', binding, messages: [] });
  assert.equal(plan.action, 'create');
  assert.equal(plan.reason, 'persisted-message-missing');
});
