'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  reactionMenuLooksRelevant,
  parseReactionRoleMenu
} = require('../src/sentinel/reaction-self-role-model.cjs');

function reaction(name, id = null) {
  return { emoji: { name, id, animated: false } };
}

function message({ title = 'Choose Your Roles', description, reactions, id = '777777777777777777' }) {
  return {
    id,
    channelId: '888888888888888888',
    author: { id: '999999999999999999', bot: true },
    content: '',
    embeds: [{ title, description }],
    reactions: { cache: new Map(reactions.map((item, index) => [String(index), item])) }
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
