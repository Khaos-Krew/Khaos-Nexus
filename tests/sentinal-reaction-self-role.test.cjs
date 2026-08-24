'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  reactionMenuLooksRelevant,
  legacyButtonMenuLooksRelevant,
  parseLegacyButtonRoleMenu,
  parseReactionRoleMenu
} = require('../src/sentinel/reaction-self-role-model.cjs');

function reaction(name, id = null) {
  return { emoji: { name, id, animated: false } };
}

function button(label, customId, emoji = '') {
  return {
    type: 2,
    style: 2,
    label,
    custom_id: customId,
    ...(emoji ? { emoji: { name: emoji, id: null } } : {})
  };
}

function message({
  title = 'Choose Your Roles',
  description,
  footer = '',
  reactions = [],
  buttons = [],
  id = '777777777777777777'
}) {
  return {
    id,
    channelId: '888888888888888888',
    author: { id: '999999999999999999', bot: true },
    content: '',
    embeds: [{ title, description, ...(footer ? { footer: { text: footer } } : {}) }],
    reactions: { cache: new Map(reactions.map((item, index) => [String(index), item])) },
    components: buttons.length ? [{ type: 1, components: buttons }] : []
  };
}

test('maps unicode reaction lines with role mentions to existing roles', () => {
  const roles = [
    { id: '111111111111111111', name: 'PC', color: 0, hexColor: '#000000' },
    { id: '222222222222222222', name: 'Xbox', color: 0, hexColor: '#000000' }
  ];
  const source = message({
    description: '🖥️ <@&111111111111111111>\n🎮 <@&222222222222222222>',
    reactions: [reaction('🖥️'), reaction('🎮')]
  });
  assert.equal(reactionMenuLooksRelevant(source), true);
  const parsed = parseReactionRoleMenu(source, roles);
  assert.ok(parsed.menu);
  assert.equal(parsed.menu.kind, 'roles');
  assert.equal(parsed.menu.mode, 'toggle');
  assert.deepEqual(parsed.menu.options.map((item) => item.roleId), ['111111111111111111', '222222222222222222']);
});

test('maps reaction lines by exact role name when mentions are absent', () => {
  const roles = [
    { id: '111111111111111111', name: 'PC', color: 0, hexColor: '#000000' },
    { id: '222222222222222222', name: 'PlayStation', color: 0, hexColor: '#000000' }
  ];
  const source = message({
    description: '💻 — PC\n🎮 — PlayStation',
    reactions: [reaction('💻'), reaction('🎮')]
  });
  const parsed = parseReactionRoleMenu(source, roles);
  assert.ok(parsed.menu);
  assert.deepEqual(parsed.menu.options.map((item) => item.label), ['PC', 'PlayStation']);
});

test('name-color reaction menus become exclusive color buttons', () => {
  const roles = [
    { id: '111111111111111111', name: 'Red', color: 0xff0000, hexColor: '#ff0000' },
    { id: '222222222222222222', name: 'Blue', color: 0x0000ff, hexColor: '#0000ff' }
  ];
  const source = message({
    title: 'Choose Your Name Color',
    description: '🔴 Red\n🔵 Blue',
    reactions: [reaction('🔴'), reaction('🔵')]
  });
  const parsed = parseReactionRoleMenu(source, roles);
  assert.ok(parsed.menu);
  assert.equal(parsed.menu.kind, 'colors');
  assert.equal(parsed.menu.mode, 'exclusive');
});

test('does not import a partially mapped reaction menu', () => {
  const roles = [{ id: '111111111111111111', name: 'PC', color: 0, hexColor: '#000000' }];
  const source = message({
    description: '💻 PC\n🎮 UnknownRole',
    reactions: [reaction('💻'), reaction('🎮')]
  });
  const parsed = parseReactionRoleMenu(source, roles);
  assert.equal(parsed.candidate, true);
  assert.equal(parsed.menu, null);
  assert.equal(parsed.mapped, 1);
  assert.deepEqual(parsed.unmatched, ['🎮']);
});

test('ordinary testing polls are not treated as reaction-role menus', () => {
  const source = message({
    title: '🧪 Testing Needed • Khaos Nexus 0.41.2',
    description: 'React with ✅ if the build works or ❌ if it fails.',
    reactions: [reaction('✅'), reaction('❌')]
  });
  assert.equal(reactionMenuLooksRelevant(source), false);
  const parsed = parseReactionRoleMenu(source, []);
  assert.equal(parsed.candidate, false);
  assert.equal(parsed.menu, null);
});

test('adopts old Khaos Nexus button menus even when their custom ids use an unknown legacy prefix', () => {
  const roles = [
    { id: '111111111111111111', name: 'PC', color: 0, hexColor: '#000000' },
    { id: '222222222222222222', name: 'PlayStation', color: 0, hexColor: '#000000' },
    { id: '333333333333333333', name: 'Xbox', color: 0, hexColor: '#000000' }
  ];
  const source = message({
    title: 'Platforms',
    description: 'Pick the platforms you play on. Click to toggle.',
    footer: 'Khaos Nexus • Platforms',
    buttons: [
      button('PC', 'old-nexus:platform:pc', '💻'),
      button('PlayStation', 'old-nexus:platform:playstation', '🎮'),
      button('Xbox', 'old-nexus:platform:xbox')
    ]
  });
  assert.equal(legacyButtonMenuLooksRelevant(source), true);
  const parsed = parseLegacyButtonRoleMenu(source, roles);
  assert.ok(parsed.menu);
  assert.equal(parsed.source, 'button');
  assert.equal(parsed.menu.mode, 'toggle');
  assert.deepEqual(parsed.menu.options.map((item) => item.roleId), [
    '111111111111111111',
    '222222222222222222',
    '333333333333333333'
  ]);
});

test('old Name Color pages migrate as exclusive menus and keep distinct ids', () => {
  const roles = [
    { id: '111111111111111111', name: 'Crimson', color: 0xdc143c, hexColor: '#dc143c' },
    { id: '222222222222222222', name: 'Blood Red', color: 0x8a1c1c, hexColor: '#8a1c1c' }
  ];
  const first = message({
    id: '777777777777771111',
    title: 'Name Color — Page 1',
    description: 'Pick one color. Choosing a new color replaces your current one.',
    footer: 'Khaos Nexus • Name Color — Page 1',
    buttons: [button('Crimson', 'old:color:crimson'), button('Blood Red', 'old:color:blood-red')]
  });
  const second = message({
    id: '777777777777772222',
    title: 'Name Color — Page 1',
    description: 'Pick one color. Choosing a new color replaces your current one.',
    footer: 'Khaos Nexus • Name Color — Page 1',
    buttons: [button('Crimson', 'older:color:crimson'), button('Blood Red', 'older:color:blood-red')]
  });
  const a = parseLegacyButtonRoleMenu(first, roles);
  const b = parseLegacyButtonRoleMenu(second, roles);
  assert.ok(a.menu);
  assert.ok(b.menu);
  assert.equal(a.menu.kind, 'colors');
  assert.equal(a.menu.mode, 'exclusive');
  assert.notEqual(a.menu.id, b.menu.id);
});

test('refuses orphaned legacy button menus unless every button maps to an existing role', () => {
  const roles = [{ id: '111111111111111111', name: 'PC', color: 0, hexColor: '#000000' }];
  const source = message({
    title: 'Platforms',
    description: 'Pick the platforms you play on.',
    footer: 'Khaos Nexus • Platforms',
    buttons: [button('PC', 'old:pc'), button('Unknown Platform', 'old:unknown')]
  });
  const parsed = parseLegacyButtonRoleMenu(source, roles);
  assert.equal(parsed.candidate, true);
  assert.equal(parsed.menu, null);
  assert.equal(parsed.mapped, 1);
  assert.deepEqual(parsed.unmatched, ['Unknown Platform']);
});
