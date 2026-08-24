'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { planGlobalColorMutation } = require('../src/sentinel/unified-self-role-manager.cjs');

test('selecting a color on another page removes the previously selected color', () => {
  const mutation = planGlobalColorMutation({
    selectedRoleId: '222222222222222222',
    currentRoles: ['999999999999999999', '111111111111111111'],
    colorRoleIds: ['111111111111111111', '222222222222222222', '333333333333333333']
  });
  assert.equal(mutation.action, 'replaced');
  assert.equal(mutation.addRoleId, '222222222222222222');
  assert.deepEqual(mutation.removeRoleIds, ['111111111111111111']);
});

test('selecting the active color removes it and any stale duplicate color roles', () => {
  const mutation = planGlobalColorMutation({
    selectedRoleId: '222222222222222222',
    currentRoles: ['111111111111111111', '222222222222222222'],
    colorRoleIds: ['111111111111111111', '222222222222222222', '333333333333333333']
  });
  assert.equal(mutation.action, 'removed');
  assert.equal(mutation.addRoleId, '');
  assert.deepEqual(mutation.removeRoleIds, ['222222222222222222', '111111111111111111']);
});

test('unrelated roles are never removed by a name-color change', () => {
  const mutation = planGlobalColorMutation({
    selectedRoleId: '333333333333333333',
    currentRoles: ['999999999999999999', '111111111111111111'],
    colorRoleIds: ['111111111111111111', '222222222222222222', '333333333333333333']
  });
  assert.deepEqual(mutation.removeRoleIds, ['111111111111111111']);
  assert.equal(mutation.removeRoleIds.includes('999999999999999999'), false);
});