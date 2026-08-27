'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  executeManagedRoleSyncPlan,
  executeExclusiveRoleAssignment,
} = require('../bot/sentinel-role-executor.cjs');

test('managed role sync dry-run never mutates Discord or persisted bindings', async () => {
  let created = 0;
  let persisted = 0;
  const gateway = { createRole: async () => { created += 1; return { id: '1' }; } };
  const persistBinding = async () => { persisted += 1; };

  const results = await executeManagedRoleSyncPlan({
    plan: [
      { roleKey: 'color.crimson', action: 'create' },
      { roleKey: 'game.ark', action: 'adopt', discordRoleId: '520000000000000001' },
    ],
    definitions: [
      { roleKey: 'color.crimson', displayName: 'Nexus Crimson', group: 'name-color' },
      { roleKey: 'game.ark', displayName: 'ARK', group: 'game' },
    ],
    gateway,
    persistBinding,
    dryRun: true,
  });

  assert.equal(created, 0);
  assert.equal(persisted, 0);
  assert.deepEqual(results.map((entry) => entry.status), ['would-create', 'would-adopt']);
});

test('ambiguous review entries never mutate even when dryRun is false', async () => {
  const results = await executeManagedRoleSyncPlan({
    plan: [{
      roleKey: 'staff.admin',
      action: 'review',
      reason: 'multiple-alias-matches',
      candidates: ['1', '2'],
    }],
    definitions: [{ roleKey: 'staff.admin', displayName: 'Nexus Command' }],
    gateway: { createRole: async () => { throw new Error('must not create'); } },
    persistBinding: async () => { throw new Error('must not persist'); },
    dryRun: false,
  });

  assert.equal(results[0].status, 'review-required');
  assert.deepEqual(results[0].candidates, ['1', '2']);
});

test('adoption persists the existing role ID and writes a native Nexus audit entry', async () => {
  const persisted = [];
  const events = [];

  const results = await executeManagedRoleSyncPlan({
    plan: [{ roleKey: 'staff.admin', action: 'adopt', discordRoleId: '710000000000000003' }],
    definitions: [{ roleKey: 'staff.admin', displayName: 'Nexus Command' }],
    persistBinding: async (...args) => persisted.push(args),
    audit: async (event) => events.push(event),
    dryRun: false,
  });

  assert.deepEqual(persisted, [['staff.admin', '710000000000000003']]);
  assert.equal(events[0].category, 'sentinel-roles');
  assert.equal(events[0].action, 'role-adopted');
  assert.equal(events[0].targetId, '710000000000000003');
  assert.equal(events[0].details.roleKey, 'staff.admin');
  assert.equal(results[0].status, 'adopted');
});

test('managed role creation persists the returned Discord ID and is audited', async () => {
  const calls = [];
  const persisted = [];
  const events = [];

  const results = await executeManagedRoleSyncPlan({
    plan: [{ roleKey: 'creator.live', action: 'create' }],
    definitions: [{
      roleKey: 'creator.live',
      displayName: 'Now Live',
      group: 'creator',
      priority: 15,
    }],
    gateway: {
      createRole: async (input) => {
        calls.push(input);
        return { id: '810000000000000001' };
      },
    },
    persistBinding: async (...args) => persisted.push(args),
    audit: async (event) => events.push(event),
    dryRun: false,
  });

  assert.deepEqual(calls[0], {
    roleKey: 'creator.live',
    name: 'Now Live',
    group: 'creator',
    priority: 15,
  });
  assert.deepEqual(persisted, [['creator.live', '810000000000000001']]);
  assert.equal(events[0].category, 'sentinel-roles');
  assert.equal(events[0].action, 'role-created');
  assert.equal(events[0].targetId, '810000000000000001');
  assert.equal(results[0].discordRoleId, '810000000000000001');
});

test('exclusive role executor removes conflicts before adding the target and audits every mutation', async () => {
  const operations = [];
  const events = [];

  const result = await executeExclusiveRoleAssignment({
    memberId: '900000000000000001',
    plan: {
      roleKey: 'color.forest',
      group: 'name-color',
      remove: ['510000000000000001', '510000000000000003'],
      add: ['510000000000000002'],
      noop: false,
    },
    gateway: {
      removeRoleFromMember: async (memberId, roleId) => operations.push(['remove', memberId, roleId]),
      addRoleToMember: async (memberId, roleId) => operations.push(['add', memberId, roleId]),
    },
    audit: async (event) => events.push(event),
    dryRun: false,
  });

  assert.deepEqual(operations.map((operation) => operation[0]), ['remove', 'remove', 'add']);
  assert.deepEqual(events.map((event) => event.action), [
    'member-role-removed',
    'member-role-removed',
    'member-role-added',
  ]);
  assert.equal(events.every((event) => event.category === 'sentinel-roles'), true);
  assert.equal(result.status, 'applied');
});

test('exclusive role dry-run and noop paths perform zero mutations', async () => {
  let mutations = 0;
  const gateway = {
    removeRoleFromMember: async () => { mutations += 1; },
    addRoleToMember: async () => { mutations += 1; },
  };

  const preview = await executeExclusiveRoleAssignment({
    memberId: '900000000000000001',
    plan: {
      roleKey: 'color.forest',
      group: 'name-color',
      remove: ['1'],
      add: ['2'],
      noop: false,
    },
    gateway,
    dryRun: true,
  });

  const noop = await executeExclusiveRoleAssignment({
    memberId: '900000000000000001',
    plan: {
      roleKey: 'color.forest',
      group: 'name-color',
      remove: [],
      add: [],
      noop: true,
    },
    gateway,
    dryRun: false,
  });

  assert.equal(preview.status, 'would-apply');
  assert.equal(noop.status, 'noop');
  assert.equal(mutations, 0);
});
