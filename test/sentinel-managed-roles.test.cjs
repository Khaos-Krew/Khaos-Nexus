'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ROLE_GROUPS,
  normalizeManagedRoleRegistry,
  planManagedRoleSync,
  planExclusiveRoleAssignment,
  applyRolePlanToIds,
} = require('../bot/sentinel-managed-roles.cjs');

const definitions = [
  {
    roleKey: 'color.crimson',
    discordRoleId: '510000000000000001',
    displayName: 'Nexus Crimson',
    aliases: ['Crimson'],
    group: ROLE_GROUPS.NAME_COLOR,
    priority: 30,
  },
  {
    roleKey: 'color.forest',
    discordRoleId: '510000000000000002',
    displayName: 'Nexus Forest',
    aliases: ['Forest'],
    group: ROLE_GROUPS.NAME_COLOR,
    priority: 20,
  },
  {
    roleKey: 'color.azure',
    discordRoleId: '510000000000000003',
    displayName: 'Nexus Azure',
    aliases: ['Azure'],
    group: ROLE_GROUPS.NAME_COLOR,
    priority: 10,
  },
  {
    roleKey: 'game.ark',
    discordRoleId: '520000000000000001',
    displayName: 'ARK: Survival Ascended',
    aliases: ['ARK'],
    group: ROLE_GROUPS.GAME,
  },
];

test('managed role registry rejects duplicate stable keys', () => {
  assert.throws(() => normalizeManagedRoleRegistry([
    definitions[0],
    { ...definitions[0], discordRoleId: '999999999999999999' },
  ]), /Duplicate managed roleKey/);
});

test('managed role sync keeps bound roles by ID even after a Discord rename', () => {
  const plan = planManagedRoleSync([
    { id: '510000000000000001', name: 'User Renamed This Role' },
  ], [definitions[0]]);

  assert.deepEqual(plan[0], {
    roleKey: 'color.crimson',
    action: 'keep',
    discordRoleId: '510000000000000001',
    reason: 'id',
  });
});

test('managed role sync adopts a unique alias instead of planning a duplicate role', () => {
  const role = {
    roleKey: 'platform.pc',
    displayName: 'PC',
    aliases: ['Computer'],
    group: ROLE_GROUPS.PLATFORM,
  };

  const plan = planManagedRoleSync([
    { id: '530000000000000001', name: 'Computer' },
  ], [role]);

  assert.equal(plan[0].action, 'adopt');
  assert.equal(plan[0].discordRoleId, '530000000000000001');
});

test('ambiguous role aliases require review and never auto-adopt or create', () => {
  const role = {
    roleKey: 'platform.console',
    displayName: 'Console',
    aliases: ['Console Player'],
    group: ROLE_GROUPS.PLATFORM,
  };

  const plan = planManagedRoleSync([
    { id: '540000000000000001', name: 'Console Player' },
    { id: '540000000000000002', name: 'Console Player' },
  ], [role]);

  assert.equal(plan[0].action, 'review');
  assert.deepEqual(plan[0].candidates, ['540000000000000001', '540000000000000002']);
});

test('selecting a managed name color removes every other managed color before assignment', () => {
  const memberRoles = [
    '510000000000000001',
    '510000000000000003',
    '520000000000000001',
    '599999999999999999',
  ];

  const plan = planExclusiveRoleAssignment({
    memberRoleIds: memberRoles,
    targetRoleKey: 'color.forest',
    definitions,
  });

  assert.deepEqual(plan.remove, [
    '510000000000000001',
    '510000000000000003',
  ]);
  assert.deepEqual(plan.add, ['510000000000000002']);

  const next = applyRolePlanToIds(memberRoles, plan);
  assert.equal(next.includes('510000000000000001'), false);
  assert.equal(next.includes('510000000000000003'), false);
  assert.equal(next.includes('510000000000000002'), true);
  assert.equal(next.includes('520000000000000001'), true);
  assert.equal(next.includes('599999999999999999'), true);
});

test('selecting the already-exclusive color is idempotent', () => {
  const plan = planExclusiveRoleAssignment({
    memberRoleIds: ['510000000000000002', '520000000000000001'],
    targetRoleKey: 'color.forest',
    definitions,
  });

  assert.deepEqual(plan.remove, []);
  assert.deepEqual(plan.add, []);
  assert.equal(plan.noop, true);
});

test('exclusive assignment never removes unmanaged or unrelated roles', () => {
  const plan = planExclusiveRoleAssignment({
    memberRoleIds: [
      '510000000000000001',
      '520000000000000001',
      '599999999999999999',
    ],
    targetRoleKey: 'color.azure',
    definitions,
  });

  const next = applyRolePlanToIds([
    '510000000000000001',
    '520000000000000001',
    '599999999999999999',
  ], plan);

  assert.equal(next.includes('520000000000000001'), true);
  assert.equal(next.includes('599999999999999999'), true);
  assert.equal(next.includes('510000000000000003'), true);
});
