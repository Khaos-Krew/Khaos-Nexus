'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIG } = require('../src/sentinel/ark-dino-cache-engine.cjs');
const {
  CHANNEL_NAME,
  BUY_PREFIX,
  TOKEN_PREFIX,
  TOKEN_MODAL_PREFIX,
  cacheIds,
  cachePanelPayload,
  tokenModal
} = require('../src/sentinel/ark-dino-box-shop-extension.cjs');
const {
  normalizeToken,
  tokenDigest,
  generateTokenCode,
  cacheScope
} = require('../src/sentinel/ark-dino-box-token-service.cjs');

test('Dino Box Shop uses the dedicated channel and exposes every configured cache', () => {
  assert.equal(CHANNEL_NAME, 'dino-box-shop');
  assert.deepEqual(cacheIds().sort(), Object.keys(CONFIG.caches).sort());
});

test('every Dino Box cache panel has exactly Buy and Redeem Token buttons', () => {
  for (const cacheId of cacheIds()) {
    const payload = cachePanelPayload(cacheId);
    assert.equal(payload.embeds.length, 1);
    assert.equal(payload.components.length, 1);
    const row = payload.components[0].toJSON();
    assert.equal(row.components.length, 2);
    assert.match(row.components[0].custom_id, new RegExp(`^${BUY_PREFIX}`));
    assert.match(row.components[0].label, /^Buy/);
    assert.match(row.components[1].custom_id, new RegExp(`^${TOKEN_PREFIX}`));
    assert.equal(row.components[1].label, 'Redeem Token');
    const text = JSON.stringify(payload.embeds[0]);
    assert.match(text, /ArkShop Points/);
    assert.doesNotMatch(text, /shiny/i);
  }
});

test('Dino Box token button opens a cache-scoped token modal', () => {
  const cacheId = cacheIds()[0];
  const modal = tokenModal(cacheId).toJSON();
  assert.equal(modal.custom_id, `${TOKEN_MODAL_PREFIX}${cacheId}`);
  assert.equal(modal.components.length, 1);
  assert.equal(modal.components[0].components.length, 1);
  assert.equal(modal.components[0].components[0].required, true);
});

test('Dino Box token codes normalize and hash deterministically without exposing plaintext', () => {
  const secret = '0123456789abcdef0123456789abcdef';
  const token = generateTokenCode();
  assert.match(token, /^NXC-[A-F0-9]{32}$/);
  assert.equal(normalizeToken(` ${token.toLowerCase()} `), token);
  const first = tokenDigest(token, secret);
  const second = tokenDigest(token, secret);
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, token);
});

test('Dino Box token scope only accepts any or configured caches', () => {
  assert.equal(cacheScope('any'), '*');
  assert.equal(cacheScope('*'), '*');
  assert.equal(cacheScope(cacheIds()[0]), cacheIds()[0]);
  assert.throws(() => cacheScope('not-a-real-cache'), /not available/i);
});
