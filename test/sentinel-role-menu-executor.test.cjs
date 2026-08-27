'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { executeRoleMenuMessagePlan } = require('../shared/sentinel-role-menu-executor.cjs');

const menu = Object.freeze({
  id: 'games',
  name: 'Game Roles',
  kind: 'roles',
  mode: 'toggle',
  title: 'Choose Games',
  description: 'Pick your games.',
  color: '#e3264f',
  channelId: '610000000000000030',
  options: [{ id: 'ark', label: 'ARK', roleId: '710000000000000030', style: 'secondary', description: '', emoji: '' }],
});

test('role menu adoption persists an existing managed message without Discord writes', async () => {
  const persisted = [];
  const audit = [];
  const result = await executeRoleMenuMessagePlan({
    menu,
    plan: { action: 'adopt', discordMessageId: '620000000000000030' },
    gateway: {
      sendMessageToChannel: async () => { throw new Error('must not send'); },
      updateMessageInChannel: async () => { throw new Error('must not update'); },
    },
    persistMessageBinding: async (...args) => persisted.push(args),
    audit: async (entry) => audit.push(entry),
    dryRun: false,
  });

  assert.deepEqual(persisted, [['games', '620000000000000030']]);
  assert.equal(audit[0].category, 'sentinel-role-menus');
  assert.equal(audit[0].action, 'message-adopted');
  assert.equal(result.status, 'adopted');
});

test('role menu refresh edits the existing message in place', async () => {
  const updates = [];
  const audit = [];
  const result = await executeRoleMenuMessagePlan({
    menu,
    plan: { action: 'refresh', discordMessageId: '620000000000000031' },
    gateway: { updateMessageInChannel: async (input) => updates.push(input) },
    audit: async (entry) => audit.push(entry),
    dryRun: false,
  });

  assert.equal(updates.length, 1);
  assert.equal(updates[0].channelId, menu.channelId);
  assert.equal(updates[0].discordMessageId, '620000000000000031');
  assert.match(JSON.stringify(updates[0].payload), /kn-role:games:ark/);
  assert.equal(audit[0].action, 'message-updated');
  assert.equal(result.status, 'updated');
});

test('role menu creation renders, sends, persists, and audits exactly once', async () => {
  const sends = [];
  const persisted = [];
  const audit = [];
  const result = await executeRoleMenuMessagePlan({
    menu,
    plan: { action: 'create', discordMessageId: null },
    gateway: {
      sendMessageToChannel: async (input) => {
        sends.push(input);
        return { id: '620000000000000032' };
      },
    },
    persistMessageBinding: async (...args) => persisted.push(args),
    audit: async (entry) => audit.push(entry),
    dryRun: false,
  });

  assert.equal(sends.length, 1);
  assert.match(JSON.stringify(sends[0].payload), /kn-role:games:ark/);
  assert.deepEqual(persisted, [['games', '620000000000000032']]);
  assert.equal(audit[0].action, 'message-created');
  assert.equal(result.status, 'created');
});

test('ambiguous review and dry-run paths are zero-write', async () => {
  let writes = 0;
  const gateway = {
    sendMessageToChannel: async () => { writes += 1; },
    updateMessageInChannel: async () => { writes += 1; },
  };

  const review = await executeRoleMenuMessagePlan({
    menu,
    plan: { action: 'review', reason: 'multiple-managed-menu-matches', candidates: ['1', '2'] },
    gateway,
    persistMessageBinding: async () => { writes += 1; },
    dryRun: false,
  });
  const preview = await executeRoleMenuMessagePlan({
    menu,
    plan: { action: 'create' },
    gateway,
    persistMessageBinding: async () => { writes += 1; },
    dryRun: true,
  });

  assert.equal(review.status, 'review-required');
  assert.deepEqual(review.candidates, ['1', '2']);
  assert.equal(preview.status, 'would-create');
  assert.equal(writes, 0);
});

test('role menu execution refuses an unbound Discord channel before write', async () => {
  await assert.rejects(
    executeRoleMenuMessagePlan({
      menu: { ...menu, channelId: '' },
      plan: { action: 'create' },
      gateway: { sendMessageToChannel: async () => ({ id: '1' }) },
      persistMessageBinding: async () => {},
      dryRun: false,
    }),
    /has no bound Discord channel/
  );
});
