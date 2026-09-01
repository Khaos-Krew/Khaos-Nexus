'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIG } = require('../src/sentinel/ark-dino-cache-engine.cjs');
const {
  HUB_MARKER,
  HUB_SELECT_ID,
  HUB_HOME_ID,
  HUB_MY_SEALED_ID,
  REVEAL_PREFIX,
  REVEAL_LATER_ID,
  hubHomePayload,
  cacheDetailPayload,
  hubPayload,
  sealedResultPayload,
  sealedInventoryPayload,
  publicResultText
} = require('../src/sentinel/ark-dino-box-shop-extension.cjs');

const sealedOrder = {
  id: '11111111-2222-3333-4444-555555555555',
  publicCacheId: 'NC-111122223333',
  cacheType: Object.keys(CONFIG.caches)[0],
  species: 'SECRET_SPECIES_SHOULD_NOT_LEAK',
  rarity: 'ultra',
  variant: 's',
  level: 300,
  sex: 'female',
  state: 'SEALED',
  createdAt: '2026-09-01T07:00:00.000Z'
};

test('Dino Cache Hub home is one embed and explains sealed-reveal lifecycle', () => {
  const payload = hubHomePayload();
  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.components.length, 2);
  const text = JSON.stringify(payload.embeds[0]);
  assert.match(text, /Purchase/i);
  assert.match(text, /SEALED/);
  assert.match(text, /Reveal Now/i);
  assert.match(text, /never rerolls/i);
  assert.match(text, /Cluster Chat/i);
  assert.match(text, /AAT/i);
  assert.match(payload.embeds[0].footer.text, new RegExp(HUB_MARKER));
});

test('hub dropdown contains guide plus every currently configured cache', () => {
  const payload = hubPayload(HUB_HOME_ID);
  const menu = payload.components[0].toJSON().components[0];
  assert.equal(menu.custom_id, HUB_SELECT_ID);
  assert.ok(menu.options.some((option) => option.value === HUB_HOME_ID));
  for (const id of Object.keys(CONFIG.caches)) assert.ok(menu.options.some((option) => option.value === id));
  assert.ok(menu.options.length <= 25);
});

test('selecting a cache produces one replacement embed with navigation and purchase actions', () => {
  const cacheId = Object.keys(CONFIG.caches)[0];
  const payload = cacheDetailPayload(cacheId);
  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.components.length, 2);
  const menu = payload.components[0].toJSON().components[0];
  assert.equal(menu.custom_id, HUB_SELECT_ID);
  assert.equal(menu.options.find((option) => option.value === cacheId).default, true);
  const actions = payload.components[1].toJSON().components;
  assert.ok(actions.some((button) => button.custom_id === HUB_MY_SEALED_ID));
  assert.match(JSON.stringify(payload.embeds[0]), /Purchase & Reveal/);
});

test('sealed purchase payload never leaks the committed reward before Reveal Now', () => {
  const payload = sealedResultPayload(sealedOrder, 1234, 'ArkShop Points');
  const text = JSON.stringify(payload);
  assert.match(text, /SEALED/);
  assert.doesNotMatch(text, /SECRET_SPECIES_SHOULD_NOT_LEAK/);
  assert.doesNotMatch(text, /\b300\b/);
  assert.doesNotMatch(text, /female/i);
  assert.doesNotMatch(text, /ultra/i);
  const buttons = payload.components[0].toJSON().components;
  assert.equal(buttons[0].custom_id, `${REVEAL_PREFIX}${sealedOrder.id}`);
  assert.equal(buttons[1].custom_id, REVEAL_LATER_ID);
});

test('sealed inventory shows cache shells but never stored creature details', () => {
  const payload = sealedInventoryPayload([sealedOrder]);
  const text = JSON.stringify(payload);
  assert.match(text, /NC-111122223333/);
  assert.match(text, /reward hidden/i);
  assert.doesNotMatch(text, /SECRET_SPECIES_SHOULD_NOT_LEAK/);
  assert.doesNotMatch(text, /\b300\b/);
});

test('public result is compact and contains the revealed stored outcome', () => {
  const text = publicResultText({ ...sealedOrder, species: 'Giganotosaurus', variant: 'x', level: 296, sex: 'female', state: 'AWAITING_DELIVERY' }, '123456789012345678');
  assert.match(text, /<@123456789012345678>/);
  assert.match(text, /Giganotosaurus/);
  assert.match(text, /Lv\. 296/);
  assert.match(text, /Female/);
});
