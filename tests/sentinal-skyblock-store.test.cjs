'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  CATALOG,
  RANKS,
  WORKSHOP_GUILD_ID,
  guildIds,
  storeUrl,
  isSkyblockShopGuild,
  shopPayload,
  handleSkyblockShopInteraction
} = require('../src/sentinel/skyblock-store-extension.cjs');

const MAIN = '1016059608789434408';

function chat({ guildId = WORKSHOP_GUILD_ID, commandName = 'shop' } = {}) {
  const replies = [];
  return {
    replies,
    guildId,
    commandName,
    isChatInputCommand: () => true,
    reply: async (payload) => { replies.push(payload); }
  };
}

function text(payload) {
  const embed = payload.embeds[0].toJSON();
  return [embed.title, embed.description, embed.footer?.text, ...(embed.fields || []).map((f) => `${f.name}\n${f.value}`)].join('\n');
}

test('defaults to the workshop guild only', () => {
  assert.deepEqual([...guildIds({})], [WORKSHOP_GUILD_ID]);
  assert.equal(isSkyblockShopGuild(MAIN, {}), false);
  assert.equal(isSkyblockShopGuild(WORKSHOP_GUILD_ID, {}), true);
  assert.deepEqual([...guildIds({ SENTINAL_SKYBLOCK_SHOP_GUILD_IDS: 'abc, 123' })], []);
});

test('store url must be https', () => {
  assert.equal(storeUrl({ SENTINAL_SKYBLOCK_STORE_URL: 'http://x.tebex.io' }), '');
  assert.equal(storeUrl({ SENTINAL_SKYBLOCK_STORE_URL: 'javascript:alert(1)' }), '');
  assert.equal(storeUrl({ SENTINAL_SKYBLOCK_STORE_URL: 'https://khaosnexus.tebex.io' }), 'https://khaosnexus.tebex.io/');
});

test('catalog v1 prices and no pay-to-win items', () => {
  assert.deepEqual(CATALOG.map((i) => i.price), ['2.99', '5.99', '4.99', '3.99', '6.99', '4.99']);
  assert.deepEqual(RANKS.map((i) => i.price), ['9.99', '19.99', '9.99']);
  const all = text(shopPayload({ SENTINAL_SKYBLOCK_SHOP_RANKS: 'true' })).toLowerCase();
  for (const banned of ['fly', 'crate key', 'booster', 'hats?', 'pets?', 'kits?', 'team slots?', 'border']) {
    assert.equal(new RegExp(`\\b${banned}\\b`).test(all), false, `copy must not mention ${banned}`);
  }
  assert.match(all, /never pay-to-win/);
});

test('ranks hidden unless flagged', () => {
  assert.equal(text(shopPayload({})).includes('Shade Creeper'), false);
  assert.equal(text(shopPayload({ SENTINAL_SKYBLOCK_SHOP_RANKS: 'true' })).includes('Shade Creeper'), true);
});

test('link button only when a store url is set', () => {
  assert.equal(shopPayload({}).components.length, 0);
  const payload = shopPayload({ SENTINAL_SKYBLOCK_STORE_URL: 'https://khaosnexus.tebex.io' });
  const button = payload.components[0].toJSON().components[0];
  assert.equal(button.label, 'Open Store');
  assert.equal(button.url, 'https://khaosnexus.tebex.io/');
});

test('handles /shop in the workshop guild and ignores the main guild', async () => {
  const ws = chat();
  assert.equal(await handleSkyblockShopInteraction(ws, {}), true);
  assert.equal(ws.replies.length, 1);
  assert.ok(ws.replies[0].flags);
  const main = chat({ guildId: MAIN });
  assert.equal(await handleSkyblockShopInteraction(main, {}), false);
  assert.equal(main.replies.length, 0);
  const other = chat({ commandName: 'guide' });
  assert.equal(await handleSkyblockShopInteraction(other, {}), false);
});

test('coin shop yields /shop in skyblock store guilds', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/sentinel/coin-shop-ui.cjs'), 'utf8');
  assert.match(src, /commandName === 'shop' && isSkyblockShopGuild\(interactionGuildId\(interaction\)\)\) return false/);
  const entry = fs.readFileSync(path.join(__dirname, '../src/sentinel/entry.cjs'), 'utf8');
  assert.ok(entry.indexOf('installSkyblockStoreExtension') < entry.indexOf("require('./bot.cjs')"));
});
