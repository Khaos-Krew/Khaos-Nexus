'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BUTTON_PREFIX,
  LATER_BUTTON_ID,
  sealedCacheEmbed,
  sealedButtons,
  revealedEmbed,
  announcementWorthy,
  publicRevealText
} = require('../src/sentinel/ark-dino-cache-discord-extension.cjs');

const sealed = {
  id: '11111111-2222-3333-4444-555555555555',
  source_item_name: 'NEXUS_CACHE_COASTAL',
  server_id: 'gen1',
  map_name: 'Genesis Part 1',
  cache_type: 'coastal',
  nexus_point_cost: 800,
  state: 'SEALED',
  created_at: '2026-09-01T06:00:00.000Z',
  species: 'Rex',
  variant: 's',
  rolled_level: 300
};

test('sealed cache embed never leaks the fixed reward', () => {
  const json = sealedCacheEmbed([sealed]).toJSON();
  const text = JSON.stringify(json);
  assert.match(text, /SEALED/);
  assert.doesNotMatch(text, /Rex/);
  assert.doesNotMatch(text, /\b300\b/);
  assert.doesNotMatch(text, /\bS\b/);
});

test('sealed cache buttons expose reveal and reveal-later without reward data', () => {
  const rows = sealedButtons([sealed]);
  assert.equal(rows.length, 1);
  const components = rows[0].toJSON().components;
  assert.equal(components[0].custom_id, `${BUTTON_PREFIX}${sealed.id}`);
  assert.equal(components[1].custom_id, LATER_BUTTON_ID);
  assert.equal(components[0].label, 'Reveal Now');
  assert.equal(components[1].label, 'Reveal Later');
  assert.doesNotMatch(JSON.stringify(components), /Rex|300/);
});

test('revealed embed shows the exact persisted outcome', () => {
  const json = revealedEmbed({ ...sealed, state: 'REVEALED' }).toJSON();
  const text = JSON.stringify(json);
  assert.match(text, /Rex/);
  assert.match(text, /300/);
  assert.match(text, /exact reward stored at purchase time/i);
});

test('announcement criteria are configurable and public text is compact', () => {
  assert.equal(announcementWorthy({ variant: 'x', rolled_level: 225 }, {}), true);
  assert.equal(announcementWorthy({ variant: 'normal', rolled_level: 299 }, {}), false);
  assert.equal(announcementWorthy({ variant: 'normal', rolled_level: 300 }, {}), true);
  assert.equal(announcementWorthy({ variant: 'normal', rolled_level: 250 }, { NEXUS_DINO_CACHE_ANNOUNCE_VARIANTS: 's', NEXUS_DINO_CACHE_ANNOUNCE_MIN_LEVEL: '250' }), true);
  const text = publicRevealText({ ...sealed, state: 'REVEALED' }, '123456789012345678');
  assert.match(text, /<@123456789012345678>/);
  assert.match(text, /Rex/);
  assert.match(text, /Lv\. 300/);
});
