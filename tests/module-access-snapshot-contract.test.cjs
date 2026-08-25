'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { managedCategoryChannels } = require('../src/sentinel/module-access-policy.cjs');
const { inspectPolicyFromSnapshot } = require('../src/sentinel/module-access-audit.cjs');

function channel(id, parentId = null) {
  return {
    id,
    name: id,
    parentId,
    permissionOverwrites: { cache: new Map() }
  };
}

test('module access snapshot helper returns the category and only its children synchronously', () => {
  const category = channel('category');
  const childA = channel('child-a', 'category');
  const childB = channel('child-b', 'category');
  const unrelated = channel('unrelated');
  const channels = new Map([
    [category.id, category],
    [childA.id, childA],
    [childB.id, childB],
    [unrelated.id, unrelated]
  ]);

  const result = managedCategoryChannels(channels, category.id);
  assert.equal(result instanceof Promise, false);
  assert.deepEqual(result.map((item) => item.id), ['category', 'child-a', 'child-b']);
});

test('module access helper preserves the existing async guild-fetch contract', async () => {
  const category = channel('category');
  const child = channel('child', 'category');
  const channels = new Map([[category.id, category], [child.id, child]]);
  let fetches = 0;
  const guild = {
    channels: {
      async fetch() {
        fetches += 1;
        return channels;
      }
    }
  };

  const result = await managedCategoryChannels(guild, category);
  assert.equal(fetches, 1);
  assert.deepEqual(result.map((item) => item.id), ['category', 'child']);
});

test('snapshot audit can inspect category policy without another Discord channel fetch', () => {
  const category = channel('category');
  const child = channel('child', 'category');
  const channels = new Map([[category.id, category], [child.id, child]]);

  const result = inspectPolicyFromSnapshot(channels, category, {
    guildId: 'guild',
    accessRoleId: 'access',
    accessRoleIds: ['access'],
    rankRoleIds: []
  });

  assert.equal(result.channels.length, 2);
  assert.equal(result.ok, false);
  assert.ok(result.driftCount > 0);
});
