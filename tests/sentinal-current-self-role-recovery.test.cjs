'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { recoverCurrentSelfRoleMenu } = require('../src/sentinel/current-self-role-recovery.cjs');
const { augmentedRolesForLegacyMenu } = require('../src/sentinel/legacy-self-role-aliases.cjs');

function message() {
  return {
    id: '1520898635464835193',
    channelId: '1520000000000000000',
    author: { id: '999999999999999999', bot: true },
    embeds: [{
      title: 'Name Color — Page 1',
      description: 'Pick one color.',
      footer: { text: 'nexus-sentinal:self-role:name-color-page-1-64835193:v1' }
    }],
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 2,
        label: 'Crimson',
        custom_id: 'nexus:self-role:name-color-page-1-64835193:crimson'
      }]
    }]
  };
}

test('reconstructs a current migrated color menu against aliased live roles', () => {
  const liveRoles = [{ id: '111111111111111111', name: 'Color: Crimson', hexColor: '#dc143c', color: 0xdc143c }];
  const parseRoles = augmentedRolesForLegacyMenu('Name Color — Page 1', ['Crimson'], liveRoles);
  const recovered = recoverCurrentSelfRoleMenu(message(), parseRoles);
  assert.ok(recovered);
  assert.equal(recovered.kind, 'colors');
  assert.equal(recovered.options[0].roleId, '111111111111111111');
  assert.equal(recovered.options[0].label, 'Crimson');
  assert.equal(recovered.options[0].color, '#dc143c');
});
