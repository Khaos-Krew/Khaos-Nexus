'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ACCESS_BUTTON_PREFIX,
  ROLE_MENU_MARKER,
  enabledAccessDefinitions,
  parseAccessButton,
  buildRoleMenuPayloads,
  stripWebsiteLines,
  stripWebsiteComponents,
  websiteCleanupPayload
} = require('../src/sentinel/role-menu.cjs');

test('Pokémon GO automatically becomes a Games access role when the module is enabled', () => {
  const definitions = enabledAccessDefinitions({ modules: { pokemongo: { enabled: true } } });
  const pogo = definitions.find((item) => item.moduleId === 'pokemongo');
  assert.ok(pogo);
  assert.equal(pogo.section, 'Games');
  assert.equal(pogo.roleName, 'Pokémon GO Access');
  assert.equal(pogo.label, 'Pokémon GO');
});

test('disabled modules are omitted from the self-role menu without changing the module catalog', () => {
  const definitions = enabledAccessDefinitions({ modules: { pokemongo: { enabled: false } } });
  assert.equal(definitions.some((item) => item.moduleId === 'pokemongo'), false);
  assert.equal(parseAccessButton(`${ACCESS_BUTTON_PREFIX}pokemongo`), 'pokemongo');
});

test('role menu payload uses deterministic module IDs and Discord-safe button rows', () => {
  const definitions = enabledAccessDefinitions({ modules: {} });
  const payloads = buildRoleMenuPayloads(definitions);
  assert.ok(payloads.length >= 1);
  for (const payload of payloads) {
    assert.equal(payload.embeds[0].footer.text, ROLE_MENU_MARKER);
    assert.ok(payload.components.length <= 5);
    for (const row of payload.components) {
      assert.ok(row.components.length <= 5);
      for (const button of row.components) {
        assert.ok(button.custom_id.startsWith(ACCESS_BUTTON_PREFIX));
        assert.ok(parseAccessButton(button.custom_id));
      }
    }
  }
});

test('role-menu button parser rejects unrelated and unknown custom IDs', () => {
  assert.equal(parseAccessButton('pogo:raid:rsvp'), null);
  assert.equal(parseAccessButton(`${ACCESS_BUTTON_PREFIX}not-a-module`), null);
});

test('rules cleanup removes website-labelled URL lines but preserves other rule text and links', () => {
  const input = [
    '**Server Rules**',
    '1. Be respectful.',
    'Website: https://example.invalid',
    'Discord help: https://discord.com/safety'
  ].join('\n');
  const cleaned = stripWebsiteLines(input);
  assert.match(cleaned, /Be respectful/);
  assert.match(cleaned, /discord\.com\/safety/);
  assert.doesNotMatch(cleaned, /example\.invalid/);
});

test('rules cleanup removes only website link buttons or the exact configured website URL', () => {
  const rows = [{
    type: 1,
    components: [
      { type: 2, style: 5, label: 'Website', url: 'https://example.invalid' },
      { type: 2, style: 5, label: 'Discord Safety', url: 'https://discord.com/safety' },
      { type: 2, style: 2, label: 'Acknowledge', custom_id: 'rules:ack' }
    ]
  }];
  const cleaned = stripWebsiteComponents(rows);
  assert.equal(cleaned.length, 1);
  assert.deepEqual(cleaned[0].components.map((item) => item.label), ['Discord Safety', 'Acknowledge']);
});

test('rules cleanup returns no edit when a Sentinal message has no website link', () => {
  const message = {
    content: 'Read the rules and be respectful.',
    components: [{ type: 1, components: [{ type: 2, style: 2, label: 'Acknowledge', custom_id: 'rules:ack' }] }]
  };
  assert.equal(websiteCleanupPayload(message), null);
});
