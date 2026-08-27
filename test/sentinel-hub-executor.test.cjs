'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_HUB_REGISTRY } = require('../shared/sentinel-hub-registry.cjs');
const {
  executeHubBindingPlan,
  executePersistentHubMessagePlan,
} = require('../shared/sentinel-hub-executor.cjs');

test('hub executor dry-run performs no channel mutation or persistence', async () => {
  let creates = 0;
  let persists = 0;
  const results = await executeHubBindingPlan({
    registry: DEFAULT_HUB_REGISTRY,
    plan: [{ hubId: 'about', action: 'create' }],
    gateway: { createHubChannel: async () => { creates += 1; return { id: '1' }; } },
    persistChannelBinding: async () => { persists += 1; },
    dryRun: true,
  });

  assert.equal(creates, 0);
  assert.equal(persists, 0);
  assert.equal(results[0].status, 'would-create');
});

test('ambiguous hub review never mutates even outside dry-run', async () => {
  const results = await executeHubBindingPlan({
    registry: DEFAULT_HUB_REGISTRY,
    plan: [{
      hubId: 'about',
      action: 'review',
      reason: 'multiple-alias-matches',
      candidates: ['610000000000000001', '610000000000000002'],
    }],
    gateway: { createHubChannel: async () => { throw new Error('must not create'); } },
    persistChannelBinding: async () => { throw new Error('must not persist'); },
    dryRun: false,
  });

  assert.equal(results[0].status, 'review-required');
  assert.deepEqual(results[0].candidates, ['610000000000000001', '610000000000000002']);
});

test('hub adoption persists the existing channel and writes native audit entry', async () => {
  const persisted = [];
  const audit = [];
  const results = await executeHubBindingPlan({
    registry: DEFAULT_HUB_REGISTRY,
    plan: [{ hubId: 'about', action: 'adopt', discordChannelId: '610000000000000001' }],
    persistChannelBinding: async (...args) => persisted.push(args),
    audit: async (entry) => audit.push(entry),
    dryRun: false,
  });

  assert.deepEqual(persisted, [['about', '610000000000000001']]);
  assert.equal(audit[0].category, 'sentinel-hubs');
  assert.equal(audit[0].action, 'channel-adopted');
  assert.equal(audit[0].targetId, '610000000000000001');
  assert.equal(results[0].status, 'adopted');
});

test('hub creation uses the existing registry blueprint and persists returned Discord ID', async () => {
  const calls = [];
  const persisted = [];
  const audit = [];
  const results = await executeHubBindingPlan({
    registry: DEFAULT_HUB_REGISTRY,
    plan: [{ hubId: 'about', action: 'create' }],
    gateway: {
      createHubChannel: async (input) => {
        calls.push(input);
        return { id: '610000000000000003' };
      },
    },
    persistChannelBinding: async (...args) => persisted.push(args),
    audit: async (entry) => audit.push(entry),
    dryRun: false,
  });

  assert.deepEqual(calls[0], {
    hubId: 'about',
    categoryBlueprintId: 'information',
    channelBlueprintId: 'about',
    channelName: 'about',
    channelType: 'text',
  });
  assert.deepEqual(persisted, [['about', '610000000000000003']]);
  assert.equal(audit[0].action, 'channel-created');
  assert.equal(results[0].status, 'created');
});

test('existing persistent message is kept without render or Discord writes', async () => {
  let renders = 0;
  let creates = 0;
  const result = await executePersistentHubMessagePlan({
    hub: DEFAULT_HUB_REGISTRY.get('about'),
    plan: { action: 'keep', discordMessageId: '620000000000000001' },
    gateway: { createPersistentMessage: async () => { creates += 1; } },
    persistMessageBinding: async () => { throw new Error('must not persist'); },
    render: async () => { renders += 1; return {}; },
    dryRun: false,
  });

  assert.equal(result.status, 'kept');
  assert.equal(renders, 0);
  assert.equal(creates, 0);
});

test('missing persistent message is rendered once, recreated, persisted, and audited', async () => {
  const persists = [];
  const audit = [];
  let renders = 0;
  const result = await executePersistentHubMessagePlan({
    hub: DEFAULT_HUB_REGISTRY.get('about'),
    plan: { action: 'create', discordMessageId: null },
    gateway: {
      createPersistentMessage: async ({ hubId, payload }) => {
        assert.equal(hubId, 'about');
        assert.deepEqual(payload, { embeds: [{ title: 'About' }] });
        return { id: '620000000000000002' };
      },
    },
    persistMessageBinding: async (...args) => persists.push(args),
    render: async () => {
      renders += 1;
      return { embeds: [{ title: 'About' }] };
    },
    audit: async (entry) => audit.push(entry),
    dryRun: false,
  });

  assert.equal(renders, 1);
  assert.deepEqual(persists, [['about', '620000000000000002']]);
  assert.equal(audit[0].action, 'persistent-message-created');
  assert.equal(audit[0].details.persistentMessageKey, 'community-about');
  assert.equal(result.status, 'created');
});
