'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSelfRoleMenu,
  renderSelfRoleMenu
} = require('../src/sentinel/self-role-model.cjs');
const {
  parseLegacyButtonRoleMenu
} = require('../src/sentinel/reaction-self-role-model.cjs');

function legacyColorMessage(emoji) {
  return {
    id: '1520898635464835193',
    channelId: '1520000000000000000',
    author: { id: '999999999999999999', bot: true },
    content: '',
    embeds: [{
      title: 'Name Color — Page 1',
      description: 'Pick one color. Choosing a new color replaces your current one.',
      footer: { text: 'Khaos Nexus • Name Color — Page 1' }
    }],
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 2,
        label: 'Crimson',
        custom_id: 'old-color-role:crimson',
        emoji
      }]
    }],
    reactions: { cache: new Map() }
  };
}

test('migrated color buttons preserve custom Discord swatch emoji ids', () => {
  const roles = [{
    id: '111111111111111111',
    name: 'Crimson',
    color: 0xdc143c,
    hexColor: '#dc143c'
  }];
  const source = legacyColorMessage({
    id: '222222222222222222',
    name: 'color_crimson',
    animated: false
  });

  const parsed = parseLegacyButtonRoleMenu(source, roles);
  assert.ok(parsed.menu);
  assert.equal(parsed.menu.kind, 'colors');
  assert.equal(parsed.menu.options[0].emoji, 'color_crimson');
  assert.equal(parsed.menu.options[0].emojiId, '222222222222222222');
  assert.equal(parsed.menu.options[0].emojiAnimated, false);

  const payload = renderSelfRoleMenu(parsed.menu);
  assert.deepEqual(payload.components[0].components[0].emoji, {
    id: '222222222222222222',
    name: 'color_crimson'
  });
});

test('unicode emoji remain supported on self-role buttons', () => {
  const menu = normalizeSelfRoleMenu({
    id: 'platforms',
    name: 'Platforms',
    title: 'Platforms',
    options: [{
      id: 'pc',
      label: 'PC',
      roleId: '111111111111111111',
      emoji: '💻'
    }]
  });

  const payload = renderSelfRoleMenu(menu);
  assert.deepEqual(payload.components[0].components[0].emoji, { name: '💻' });
});

test('animated custom emoji retain their animated flag', () => {
  const menu = normalizeSelfRoleMenu({
    id: 'colors',
    kind: 'colors',
    name: 'Colors',
    title: 'Colors',
    options: [{
      id: 'rose',
      label: 'Rose',
      roleId: '111111111111111111',
      emoji: {
        id: '333333333333333333',
        name: 'color_rose',
        animated: true
      },
      color: '#ff3366'
    }]
  });

  const payload = renderSelfRoleMenu(menu);
  assert.deepEqual(payload.components[0].components[0].emoji, {
    id: '333333333333333333',
    name: 'color_rose',
    animated: true
  });
});
