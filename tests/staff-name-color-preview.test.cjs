'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const { buildStaffNameColorPreview } = require('../src/sentinel/staff-name-color-preview.cjs');

function permissions(...bits) {
  const set = new Set(bits);
  return { has: (bit) => set.has(bit) };
}

function role({ id, name, position, color = 0, managed = false, editable = true, hoist = false, bits = [] }) {
  return { id, name, position, color, managed, editable, hoist, permissions: permissions(...bits) };
}

test('proposes only editable colored staff roles above selectable colors', () => {
  const roles = [
    role({ id: '1', name: '@everyone', position: 0 }),
    role({ id: '10', name: 'Color: Crimson', position: 5, color: 0x990000 }),
    role({ id: '11', name: 'Color: Forest', position: 6, color: 0x228B22 }),
    role({ id: '20', name: 'Moderator', position: 12, color: 0x3366FF, bits: [PermissionFlagsBits.ModerateMembers] }),
    role({ id: '21', name: 'Admin', position: 14, color: 0, bits: [PermissionFlagsBits.Administrator] }),
    role({ id: '22', name: 'Integration Staff', position: 13, color: 0xAA00AA, managed: true, editable: false, bits: [PermissionFlagsBits.ManageGuild] }),
    role({ id: '23', name: 'Fancy Member', position: 15, color: 0x00FFFF }),
    role({ id: '99', name: 'Nexus Sentinal', position: 30, color: 0xFF0000, bits: [PermissionFlagsBits.Administrator] })
  ];

  const preview = buildStaffNameColorPreview({
    guildId: '1',
    roles,
    botHighestRole: roles.at(-1),
    config: { discord: {} }
  });

  assert.equal(preview.ok, true);
  assert.equal(preview.readOnly, true);
  assert.equal(preview.mutationAuthorized, false);
  assert.equal(preview.highestSelectableColorRole.id, '11');
  assert.deepEqual(preview.proposedRoleIds, ['20']);
  assert.deepEqual(preview.blockedRoleIds, ['22']);
  assert.equal(preview.protectedStaffRoles.some((item) => item.id === '23'), false);
  assert.equal(preview.protectedStaffRoles.find((item) => item.id === '21').eligibleForColorNeutralPreview, false);
});

test('configured color role ids are recognized without Color prefix', () => {
  const roles = [
    role({ id: '1', name: '@everyone', position: 0 }),
    role({ id: '15', name: 'Crimson', position: 8, color: 0xCC0000 }),
    role({ id: '30', name: 'Community Manager', position: 11, color: 0x00AA00, bits: [PermissionFlagsBits.ManageGuild] }),
    role({ id: '99', name: 'Nexus Sentinal', position: 20, bits: [PermissionFlagsBits.Administrator] })
  ];
  const preview = buildStaffNameColorPreview({
    guildId: '1',
    roles,
    botHighestRole: roles.at(-1),
    config: {
      discord: {
        selfRoleMenus: [{ kind: 'colors', options: [{ roleId: '15' }] }]
      }
    }
  });
  assert.equal(preview.selectableColorRoleCount, 1);
  assert.equal(preview.highestSelectableColorRole.id, '15');
  assert.deepEqual(preview.proposedRoleIds, ['30']);
});

test('roles at or above Sentinal are blocked from a future migration', () => {
  const roles = [
    role({ id: '10', name: 'Color: Red', position: 5, color: 0xFF0000 }),
    role({ id: '20', name: 'Owner', position: 25, color: 0xFFFFFF, bits: [PermissionFlagsBits.Administrator] }),
    role({ id: '99', name: 'Nexus Sentinal', position: 20, bits: [PermissionFlagsBits.Administrator] })
  ];
  const preview = buildStaffNameColorPreview({ guildId: '1', roles, botHighestRole: roles[2], config: { discord: {} } });
  assert.deepEqual(preview.proposedRoleIds, []);
  assert.deepEqual(preview.blockedRoleIds, ['20']);
  assert.ok(preview.protectedStaffRoles[0].blockers.includes('not-below-sentinal'));
});
