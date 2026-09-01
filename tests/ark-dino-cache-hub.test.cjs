'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIG } = require('../src/sentinel/ark-dino-cache-engine.cjs');
const {
  HUB_SELECT_ID,
  HUB_MY_CACHES_ID,
  HUB_HOME_ID,
  HUB_MARKER,
  cacheHubHomeEmbed,
  cacheDetailEmbed,
  cacheHubSelect,
  cacheHubActions,
  hubPayload
} = require('../src/sentinel/ark-dino-cache-hub-extension.cjs');

test('Cache Hub home explains the full sealed-reveal lifecycle in one embed', () => {
  const json = cacheHubHomeEmbed().toJSON();
  const text = JSON.stringify(json);
  assert.match(text, /Purchase/i);
  assert.match(text, /permanently locks/i);
  assert.match(text, /sealed/i);
  assert.match(text, /Reveal Now/i);
  assert.match(text, /delivery/i);
  assert.match(text, /Cluster Chat/i);
  assert.match(text, /AAT/i);
  assert.match(json.footer.text, new RegExp(HUB_MARKER));
});

test('Cache Hub dropdown contains guide plus each configured cache without exceeding Discord limit', () => {
  const row = cacheHubSelect(HUB_HOME_ID).toJSON();
  assert.equal(row.components.length, 1);
  const menu = row.components[0];
  assert.equal(menu.custom_id, HUB_SELECT_ID);
  assert.equal(menu.options.length, Object.keys(CONFIG.caches).length + 1);
  assert.ok(menu.options.length <= 25);
  assert.equal(menu.options[0].value, HUB_HOME_ID);
  for (const cacheId of Object.keys(CONFIG.caches)) assert.ok(menu.options.some((option) => option.value === cacheId));
});

test('Selecting a cache produces one replacement embed and keeps navigation attached', () => {
  const cacheId = Object.keys(CONFIG.caches)[0];
  const payload = hubPayload(cacheId);
  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.components.length, 2);
  const text = JSON.stringify(payload.embeds[0].toJSON());
  assert.match(text, /Possible Creatures/i);
  assert.match(text, /Normal \/ X \/ S/i);
  assert.match(text, /200–300/);
  assert.doesNotMatch(text, /How Dino Caches work/i);
  const menu = payload.components[0].toJSON().components[0];
  assert.ok(menu.options.find((option) => option.value === cacheId)?.default);
});

test('My Sealed Caches action is available from every hub view', () => {
  const row = cacheHubActions().toJSON();
  assert.equal(row.components.length, 1);
  assert.equal(row.components[0].custom_id, HUB_MY_CACHES_ID);
  assert.match(row.components[0].label, /Sealed Caches/i);
});

test('cache detail only renders the selected cache roster, not every cache as a long list', () => {
  const ids = Object.keys(CONFIG.caches);
  assert.ok(ids.length >= 2);
  const selected = ids[0];
  const other = ids[1];
  const text = JSON.stringify(cacheDetailEmbed(selected).toJSON());
  assert.match(text, new RegExp(selected === 'deepcave' ? 'Deep Cave' : selected, 'i'));
  const otherSpecies = CONFIG.caches[other].entries.map((entry) => entry.name).find((name) => !CONFIG.caches[selected].entries.some((entry) => entry.name === name));
  if (otherSpecies) assert.doesNotMatch(text, new RegExp(otherSpecies.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
