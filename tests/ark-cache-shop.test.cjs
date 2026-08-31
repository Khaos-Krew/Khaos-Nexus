'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIG } = require('../src/sentinel/ark-dino-cache-engine.cjs');
const { imageBuffer, THEMES } = require('../src/sentinel/ark-cache-shop-art.cjs');
const { committedRoll, pickLinkedArkAccount } = require('../src/sentinel/ark-cache-shop-service.cjs');
const { cacheIds, raritySummary, detailPayload } = require('../src/sentinel/ark-cache-shop-extension.cjs');
const { buildInfoButtons, BUTTON_CACHE_SHOP } = require('../src/sentinel/ark-cluster-panel.cjs');

test('ARK status panel exposes Cache Shop action', () => {
  const json = buildInfoButtons().toJSON();
  assert.ok(json.components.some((item) => item.custom_id === BUTTON_CACHE_SHOP && item.label === 'Cache Shop'));
});

test('cache shop contains all configured caches and no shiny roll surface', () => {
  assert.deepEqual(cacheIds().sort(), Object.keys(CONFIG.caches).sort());
  for (const id of cacheIds()) {
    const payload = detailPayload(id, null);
    const text = JSON.stringify(payload.embeds);
    assert.doesNotMatch(text, /shiny/i);
    assert.match(text, /Sex Roll/);
    assert.match(raritySummary(CONFIG.caches[id]), /Common|Rare|Ultra|Uncommon/);
  }
});

test('each cache has a valid generated PNG image', () => {
  for (const id of Object.keys(THEMES)) {
    const png = imageBuffer(id);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.ok(png.length > 1000);
  }
});

test('Discord cache roll is deterministic including sex and never shiny', () => {
  const secret = '0123456789abcdef0123456789abcdef';
  const first = committedRoll('mountain', secret, 'discord-cache:test');
  const second = committedRoll('mountain', secret, 'discord-cache:test');
  assert.deepEqual(first, second);
  assert.ok(['male', 'female'].includes(first.sex));
  assert.equal(first.shiny, false);
});

test('linked ARK account selection requires a verified account', () => {
  assert.throws(() => pickLinkedArkAccount(null), /Link your Discord account/);
  const account = pickLinkedArkAccount({ arkAccounts: [{ eosId:'EOS_12345678', playerName:'LinkedPlayer', verifiedAt:'2026-08-31T00:00:00Z' }] });
  assert.equal(account.playerName, 'LinkedPlayer');
});
