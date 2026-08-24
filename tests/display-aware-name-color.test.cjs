'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const {
  isHierarchySpacingWarning,
  analyzeManagedColorDisplayConflicts,
  conflictSummary
} = require('../src/sentinel/display-aware-self-role-manager.cjs');

function permissions(...bits) {
  const allowed = new Set(bits);
  return { has: (bit) => allowed.has(bit) };
}

function role({ id, name, position, color = 0, bits = [], managed = false, editable = true }) {
  return {
    id: String(id),
    name,
    position,
    color,
    hexColor: color ? `#${color.toString(16).padStart(6, '0')}` : '#000000',
    permissions: permissions(...bits),
    managed,
    editable
  };
}

const colorMenus = [{
  kind: 'colors',
  options: [
    { roleId: '100001' },
    { roleId: '100002' },
    { roleId: '100003' }
  ]
}];

test('hierarchy spacing warnings are recognized separately from display conflicts', () => {
  assert.equal(isHierarchySpacingWarning('Color-role priority could not be fully applied without placing color roles above a moderation role.'), true);
  assert.equal(isHierarchySpacingWarning('Color-role priority has no safe hierarchy space above the current self-role/rank roles and below moderation roles.'), true);
  assert.equal(isHierarchySpacingWarning('Sentinal cannot manage a role.'), false);
});

test('uncolored protected roles do not create a Discord name-color display conflict', () => {
  const roles = [
    role({ id: '100001', name: 'Color: Red', position: 8, color: 0xff0000 }),
    role({ id: '100002', name: 'Color: Green', position: 9, color: 0x00ff00 }),
    role({ id: '100003', name: 'Color: Blue', position: 10, color: 0x0000ff }),
    role({ id: '200001', name: 'Moderator', position: 15, bits: [PermissionFlagsBits.ModerateMembers] }),
    role({ id: '200002', name: 'Nexus Raider', position: 14 })
  ];
  const analysis = analyzeManagedColorDisplayConflicts({
    roles,
    menus: colorMenus,
    config: { discord: { rankRoles: { nexusRaider: '200002' } } }
  });
  assert.equal(analysis.displaySafe, true);
  assert.equal(analysis.conflictCount, 0);
  assert.equal(analysis.lowestSelectableColorPosition, 8);
  assert.equal(conflictSummary(analysis), 'displaySafe=true conflicts=0');
});

test('colored managed rank above a lower selectable color is reported as a real conflict', () => {
  const roles = [
    role({ id: '100001', name: 'Color: Red', position: 8, color: 0xff0000 }),
    role({ id: '100002', name: 'Color: Green', position: 9, color: 0x00ff00 }),
    role({ id: '100003', name: 'Color: Blue', position: 10, color: 0x0000ff }),
    role({ id: '200002', name: 'Nexus Raider', position: 12, color: 0xaa5500 })
  ];
  const analysis = analyzeManagedColorDisplayConflicts({
    roles,
    menus: colorMenus,
    config: { discord: { rankRoles: { nexusRaider: '200002' } } }
  });
  assert.equal(analysis.displaySafe, false);
  assert.equal(analysis.conflictCount, 1);
  assert.equal(analysis.conflicts[0].source, 'rank');
  assert.equal(analysis.conflicts[0].staff, false);
  assert.match(conflictSummary(analysis), /Nexus Raider#200002/);
});

test('colored moderation role is classified as a staff conflict', () => {
  const roles = [
    role({ id: '100001', name: 'Color: Red', position: 8, color: 0xff0000 }),
    role({ id: '100002', name: 'Color: Green', position: 9, color: 0x00ff00 }),
    role({ id: '100003', name: 'Color: Blue', position: 10, color: 0x0000ff }),
    role({ id: '300001', name: 'Community Manager', position: 20, color: 0x336699, bits: [PermissionFlagsBits.ManageGuild] })
  ];
  const analysis = analyzeManagedColorDisplayConflicts({ roles, menus: colorMenus, config: { discord: {} } });
  assert.equal(analysis.conflictCount, 1);
  assert.equal(analysis.conflicts[0].source, 'staff');
  assert.equal(analysis.conflicts[0].staff, true);
});

test('unmanaged decorative colored roles are ignored unless Nexus manages or protects them', () => {
  const roles = [
    role({ id: '100001', name: 'Color: Red', position: 8, color: 0xff0000 }),
    role({ id: '100002', name: 'Color: Green', position: 9, color: 0x00ff00 }),
    role({ id: '100003', name: 'Color: Blue', position: 10, color: 0x0000ff }),
    role({ id: '400001', name: 'Decorative Event Winner', position: 25, color: 0xffcc00 })
  ];
  const analysis = analyzeManagedColorDisplayConflicts({ roles, menus: colorMenus, config: { discord: {} } });
  assert.equal(analysis.displaySafe, true);
  assert.equal(analysis.conflictCount, 0);
});
