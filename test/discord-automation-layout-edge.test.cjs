'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeChannel, planLayout } = require('../shared/discord-automation.cjs');

test('a same-named channel in another category does not satisfy a missing category blueprint', () => {
  const layout = {
    id: 'target-layout',
    name: 'Target',
    categories: [{ id: 'new-category', name: 'NEW CATEGORY', channels: [{ id: 'general', name: 'general', type: 'text' }] }]
  };
  const existing = [
    { id: 'old-category', name: 'OLD CATEGORY', type: 4, parentId: '' },
    { id: 'old-general', name: 'general', type: 0, parentId: 'old-category' }
  ];
  const plan = planLayout(layout, existing);
  assert.equal(plan.createCount, 2);
  assert.equal(plan.operations.find((item) => item.kind === 'text').action, 'create');
});

test('voice channel display names preserve spaces and capitalization', () => {
  const channel = normalizeChannel({ id: 'voice', name: 'Nexus Lounge', type: 'voice' });
  assert.equal(channel.name, 'Nexus Lounge');
});
