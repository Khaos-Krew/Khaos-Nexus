'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  legacyButtonMenuLooksRelevant,
  reactionMenuLooksRelevant,
  exactRoleCandidates
} = require('../src/sentinel/reaction-self-role-model.cjs');

function button(label, customId) {
  return { type: 2, style: 2, label, custom_id: customId };
}

function message({ title, description = '', footer = '', buttons = [], reactions = [] }) {
  return {
    id: '777777777777777777',
    author: { id: '999999999999999999', bot: true },
    content: '',
    embeds: [{ title, description, ...(footer ? { footer: { text: footer } } : {}) }],
    components: buttons.length ? [{ type: 1, components: buttons }] : [],
    reactions: { cache: new Map(reactions.map((item, index) => [String(index), item])) }
  };
}

test('community rules report button is not classified as a legacy role menu', () => {
  const source = message({
    title: 'KHAOS NEXUS • COMMUNITY RULES',
    description: 'Use Open Private Report if you need staff assistance.',
    footer: 'Khaos Nexus • Community Rules',
    buttons: [button('Open Private Report', 'nexus:safety:report')]
  });
  assert.equal(legacyButtonMenuLooksRelevant(source), false);
});

test('generic testing poll reactions are not classified as a role menu', () => {
  const source = message({
    title: '🧪 Testing Needed • Khaos Nexus 0.41.2',
    description: 'React with ✅ if the test passed or ❌ if it failed.',
    reactions: [
      { emoji: { name: '✅', id: null, animated: false } },
      { emoji: { name: '❌', id: null, animated: false } }
    ]
  });
  assert.equal(reactionMenuLooksRelevant(source), false);
});

test('exact role candidates preserve duplicate role ids for diagnostic resolution', () => {
  const roles = [
    { id: '111111111111111111', name: 'PC' },
    { id: '222222222222222222', name: 'PC' },
    { id: '333333333333333333', name: 'Platform • PC' }
  ];
  assert.deepEqual(exactRoleCandidates(roles, 'PC').map((role) => role.id), [
    '111111111111111111',
    '222222222222222222'
  ]);
});