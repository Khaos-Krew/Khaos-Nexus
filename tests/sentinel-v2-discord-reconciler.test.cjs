'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDiscordReconciliationPlan } = require('../src/sentinel-v2/discord-reconciler.cjs');

const actual = {
  channels: [
    { id: 'c1', name: 'welcome', type: 0, parentId: 'cat1' },
    { id: 'c2', name: 'general', type: 0, parentId: 'cat1' },
  ],
  roles: [
    { id: 'r1', name: 'Member' },
    { id: 'r2', name: 'Admin' },
  ],
};

test('returns a zero-write no-op plan when desired Discord state already matches', () => {
  const plan = buildDiscordReconciliationPlan({
    channels: [
      { id: 'c1', name: 'welcome', type: 0, parentId: 'cat1' },
      { id: 'c2', name: 'general', type: 0, parentId: 'cat1' },
    ],
    roles: [
      { id: 'r1', name: 'Member' },
      { id: 'r2', name: 'Admin' },
    ],
  }, actual);

  assert.equal(plan.mode, 'plan-only');
  assert.equal(plan.changed, false);
  assert.equal(plan.operationCount, 0);
  assert.deepEqual(plan.operations, []);
});

test('plans only the missing and changed Discord resources without deleting unmanaged state', () => {
  const plan = buildDiscordReconciliationPlan({
    channels: [
      { id: 'c1', name: 'start-here', type: 0, parentId: 'cat2' },
      { key: 'rules', name: 'rules', type: 0, parentId: 'cat1' },
    ],
    roles: [
      { id: 'r1', name: 'Community Member' },
      { key: 'moderator', name: 'Moderator' },
    ],
  }, actual);

  assert.equal(plan.changed, true);
  assert.equal(plan.operationCount, 5);
  assert.deepEqual(plan.summary, {
    'discord.channel.rename': 1,
    'discord.channel.reparent': 1,
    'discord.channel.create': 1,
    'discord.role.rename': 1,
    'discord.role.create': 1,
  });
  assert.equal(plan.operations.some((item) => item.capability.includes('delete')), false);
  assert.equal(plan.operations.every((item) => item.destructive === false), true);
});

test('matches desired resources by name when stable IDs are not available yet', () => {
  const plan = buildDiscordReconciliationPlan({
    channels: [{ name: 'general', type: 0 }],
    roles: [{ name: 'Admin' }],
  }, actual);

  assert.equal(plan.changed, false);
});
