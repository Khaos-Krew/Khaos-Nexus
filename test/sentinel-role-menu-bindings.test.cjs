'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  messageCustomIds,
  isManagedRoleMenuMessage,
  planRoleMenuMessage,
} = require('../shared/sentinel-role-menu-bindings.cjs');

function message(id, customIds = []) {
  return {
    id,
    components: [{
      type: 1,
      components: customIds.map((custom_id) => ({ type: 2, custom_id })),
    }],
  };
}

test('role menu marker extraction accepts Discord API custom_id shape', () => {
  const source = message('1', ['kn-role:games:ark', 'kn-role:games:warframe']);
  assert.deepEqual(messageCustomIds(source), ['kn-role:games:ark', 'kn-role:games:warframe']);
  assert.equal(isManagedRoleMenuMessage(source, 'games'), true);
  assert.equal(isManagedRoleMenuMessage(source, 'colors'), false);
});

test('persisted role menu message is kept by ID even if message contents changed', () => {
  const plan = planRoleMenuMessage({
    menu: { id: 'games', messageId: '620000000000000020' },
    messages: [message('620000000000000020', [])],
  });
  assert.deepEqual(plan, {
    action: 'keep',
    discordMessageId: '620000000000000020',
    reason: 'id',
  });
});

test('existing role menu message can explicitly refresh in place', () => {
  const plan = planRoleMenuMessage({
    menu: { id: 'games', messageId: '620000000000000020' },
    messages: [message('620000000000000020', [])],
    refresh: true,
  });
  assert.equal(plan.action, 'refresh');
  assert.equal(plan.discordMessageId, '620000000000000020');
});

test('one Sentinel-managed role menu marker is adopted instead of duplicated', () => {
  const plan = planRoleMenuMessage({
    menu: { id: 'games', messageId: '' },
    messages: [
      message('620000000000000021', ['other:button']),
      message('620000000000000022', ['kn-role:games:ark']),
    ],
  });
  assert.deepEqual(plan, {
    action: 'adopt',
    discordMessageId: '620000000000000022',
    reason: 'managed-button-marker',
  });
});

test('multiple Sentinel role-menu markers require review rather than guessing', () => {
  const plan = planRoleMenuMessage({
    menu: { id: 'games' },
    messages: [
      message('620000000000000022', ['kn-role:games:ark']),
      message('620000000000000023', ['kn-role:games:warframe']),
    ],
  });
  assert.equal(plan.action, 'review');
  assert.deepEqual(plan.candidates, ['620000000000000022', '620000000000000023']);
});

test('missing role menu message plans one create operation', () => {
  const plan = planRoleMenuMessage({
    menu: { id: 'games', messageId: '620000000000000024' },
    messages: [],
  });
  assert.equal(plan.action, 'create');
  assert.equal(plan.reason, 'persisted-message-missing');
});
