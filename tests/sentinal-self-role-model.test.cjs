'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SELF_ROLE_BUTTON_PREFIX,
  configuredSelfRoleMenus,
  normalizeSelfRoleMenu,
  selfRoleButtonId,
  parseSelfRoleButton,
  selfRoleMutation,
  renderSelfRoleMenu,
  isLegacySelfRoleMessage,
  discoverLegacySelfRoleMenu,
  planColorRolePositions
} = require('../src/sentinel/self-role-model.cjs');

test('color menus are always exclusive', () => {
  const menu = normalizeSelfRoleMenu({
    id: 'colors',
    kind: 'colors',
    mode: 'toggle',
    options: [
      { id: 'red', label: 'Red', roleId: '11111', color: '#ff0000' },
      { id: 'blue', label: 'Blue', roleId: '22222', color: '#0000ff' }
    ]
  });
  assert.equal(menu.mode, 'exclusive');
});

test('legacy and new self-role button IDs both parse', () => {
  assert.deepEqual(parseSelfRoleButton(selfRoleButtonId('colors', 'red')), { menuId: 'colors', optionId: 'red', legacy: false });
  assert.deepEqual(parseSelfRoleButton('kn-role:colors:red'), { menuId: 'colors', optionId: 'red', legacy: true });
  assert.equal(parseSelfRoleButton('other:colors:red'), null);
});

test('changing colors replaces sibling color without touching unrelated roles', () => {
  const menu = {
    id: 'colors',
    kind: 'colors',
    options: [
      { id: 'red', label: 'Red', roleId: '11111', color: '#ff0000' },
      { id: 'blue', label: 'Blue', roleId: '22222', color: '#0000ff' }
    ]
  };
  const mutation = selfRoleMutation(menu, 'blue', ['11111', '99999']);
  assert.equal(mutation.action, 'replaced');
  assert.equal(mutation.addRoleId, '22222');
  assert.deepEqual(mutation.removeRoleIds, ['11111']);
});

test('normal self roles remain independent toggles', () => {
  const menu = {
    id: 'platforms',
    kind: 'roles',
    options: [
      { id: 'pc', label: 'PC', roleId: '33333' },
      { id: 'xbox', label: 'Xbox', roleId: '44444' }
    ]
  };
  const mutation = selfRoleMutation(menu, 'xbox', ['33333', '99999']);
  assert.equal(mutation.action, 'added');
  assert.equal(mutation.addRoleId, '44444');
  assert.deepEqual(mutation.removeRoleIds, []);
});

test('role-menu config accepts legacy discordAutomation and current discord selfRoleMenus', () => {
  const menus = configuredSelfRoleMenus({
    discordAutomation: { roleMenus: [{ id: 'colors', kind: 'colors', options: [{ id: 'red', label: 'Red', roleId: '11111' }] }] },
    discord: { selfRoleMenus: [{ id: 'platforms', options: [{ id: 'pc', label: 'PC', roleId: '33333' }] }] }
  });
  assert.deepEqual(menus.map((menu) => menu.id), ['colors', 'platforms']);
});

test('rendered self-role menus stay within Discord button limits', () => {
  const menu = normalizeSelfRoleMenu({
    id: 'games',
    options: Array.from({ length: 12 }, (_, index) => ({ id: `g${index}`, label: `Game ${index}`, roleId: String(10000 + index) }))
  });
  const payload = renderSelfRoleMenu(menu);
  assert.deepEqual(payload.components.map((row) => row.components.length), [5, 5, 2]);
  assert.ok(payload.components[0].components[0].custom_id.startsWith(SELF_ROLE_BUTTON_PREFIX));
});

test('legacy Khaos Nexus menu can be rediscovered by old button IDs and exact role labels', () => {
  const message = {
    id: '77777',
    channelId: '88888',
    embeds: [{ title: 'Name Colors', description: 'Pick one.', footer: { text: 'Khaos Nexus • One color at a time' } }],
    components: [{
      type: 1,
      components: [
        { type: 2, label: 'Red', custom_id: 'kn-role:colors:red' },
        { type: 2, label: 'Blue', custom_id: 'kn-role:colors:blue' }
      ]
    }]
  };
  const roles = [
    { id: '11111', name: 'Red', hexColor: '#ff0000' },
    { id: '22222', name: 'Blue', hexColor: '#0000ff' }
  ];
  assert.equal(isLegacySelfRoleMessage(message), true);
  const menu = discoverLegacySelfRoleMenu(message, roles);
  assert.ok(menu);
  assert.equal(menu.kind, 'colors');
  assert.equal(menu.mode, 'exclusive');
  assert.equal(menu.messageId, '77777');
  assert.deepEqual(menu.options.map((option) => option.roleId), ['11111', '22222']);
});

test('color priority is placed above supporter/access roles but below moderation roles', () => {
  const plan = planColorRolePositions({
    botPosition: 20,
    staffRoles: [{ id: 'staff', position: 15 }],
    ordinaryRoles: [{ id: 'rank', position: 8 }, { id: 'access', position: 7 }],
    colorRoles: [{ id: 'red', position: 4 }, { id: 'blue', position: 5 }]
  });
  assert.equal(plan.skipped, false);
  assert.deepEqual(plan.positions, [
    { role: 'red', position: 13 },
    { role: 'blue', position: 14 }
  ]);
});

test('color priority refuses to cross a moderation boundary', () => {
  const plan = planColorRolePositions({
    botPosition: 20,
    staffRoles: [{ id: 'staff', position: 10 }],
    ordinaryRoles: [{ id: 'rank', position: 8 }],
    colorRoles: [{ id: 'red', position: 4 }, { id: 'blue', position: 5 }]
  });
  assert.equal(plan.skipped, true);
  assert.equal(plan.reason, 'ordinary-role-overlap');
});
