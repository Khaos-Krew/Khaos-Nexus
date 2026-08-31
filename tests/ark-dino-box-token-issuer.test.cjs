'use strict';

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { cacheImageName } = require('../src/sentinel/ark-cache-shop-art.cjs');
const { CONFIG } = require('../src/sentinel/ark-dino-cache-engine.cjs');
const {
  COMMAND_NAME,
  COIN_NAME,
  COIN_PATH,
  cacheChoices,
  tokenCommand,
  isGuildOwner,
  tokenScopeLabel,
  tokenCardPayload
} = require('../src/sentinel/ark-dino-box-token-issuer-extension.cjs');

test('cachetoken command is a one-token owner grant command with all cache scopes', () => {
  const command = tokenCommand().toJSON();
  assert.equal(COMMAND_NAME, 'cachetoken');
  assert.equal(command.name, 'cachetoken');
  assert.equal(command.options[0].name, 'give');
  const scopes = cacheChoices().map((item) => item.value);
  assert.ok(scopes.includes('any'));
  for (const id of Object.keys(CONFIG.caches)) assert.ok(scopes.includes(id));
});

test('Dino Box token mint permission is literal Discord guild ownership only', () => {
  assert.equal(isGuildOwner({ guild: { ownerId: '111' }, user: { id: '111' } }), true);
  assert.equal(isGuildOwner({ guild: { ownerId: '111' }, user: { id: '222' }, memberPermissions: { has: () => true } }), false);
  assert.equal(isGuildOwner({ guild: { ownerId: '111' }, user: { id: '333' }, configuredRole: 'owner' }), false);
});

test('token card uses the Nexus coin asset and never claims to charge ArkShop points', () => {
  assert.equal(COIN_NAME, 'nexus-points-coin.png');
  assert.equal(fs.existsSync(COIN_PATH), true);
  const payload = tokenCardPayload({ token: { code: 'NXC-0123456789ABCDEF0123456789ABCDEF', cacheType: '*' }, recipientId: '1234567890' });
  const embed = payload.embeds[0];
  assert.equal(embed.image.url, `attachment://${COIN_NAME}`);
  assert.match(embed.description, /Any Dino Cache/);
  assert.match(embed.footer.text, /0 ArkShop Points charged/);
  assert.equal(tokenScopeLabel('*'), 'Any Dino Cache');
});

test('every configured cache has a unique generated cache image attachment name', () => {
  const names = Object.keys(CONFIG.caches).map(cacheImageName);
  assert.equal(new Set(names).size, Object.keys(CONFIG.caches).length);
  for (const name of names) assert.match(name, /^nexus-.+-cache\.png$/);
});
