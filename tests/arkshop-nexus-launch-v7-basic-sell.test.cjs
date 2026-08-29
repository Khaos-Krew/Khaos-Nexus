'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REBUNDLED_BUYS,
  BASIC_SELLS,
  buyEntry,
  sellEntry,
  buybackRatio,
  validateCatalog,
  hasCatalog
} = require('../src/sentinel/arkshop-nexus-launch-v7-basic-sell-startup.cjs');

test('v7 rebundles every V4 resource purchase into practical quantities', () => {
  assert.equal(Object.keys(REBUNDLED_BUYS).length, 20);
  assert.deepEqual(REBUNDLED_BUYS.wood10k, ['Wood x1,000', 15, 'Wood', 1000]);
  assert.deepEqual(REBUNDLED_BUYS.ingots5k, ['Metal Ingots x500', 45, 'MetalIngot', 500]);
  assert.deepEqual(REBUNDLED_BUYS.blackpearls1k, ['Black Pearls x100', 65, 'BlackPearl', 100]);
  assert.equal(validateCatalog(), true);
});

test('v7 basic sell catalog uses seven exact temporary listings at practical bundle sizes', () => {
  assert.equal(Object.keys(BASIC_SELLS).length, 7);
  assert.deepEqual(BASIC_SELLS.wood.slice(0, 3), ['Wood x1,000', 3, 1000]);
  assert.deepEqual(BASIC_SELLS.ingots.slice(0, 3), ['Metal Ingots x500', 9, 500]);
  assert.deepEqual(BASIC_SELLS.blackpearls.slice(0, 3), ['Black Pearls x100', 10, 100]);
  assert.match(BASIC_SELLS.stone[3], /TG_Stack_10000_90\/Resources\/PrimalItemResource_Stone_Child/);
  assert.match(BASIC_SELLS.blackpearls[3], /PrimalItemResource_BlackPearl_Child/);
});

test('every temporary sell payout stays at or below 20 percent of matching buy value', () => {
  for (const [id, spec] of Object.entries(BASIC_SELLS)) {
    const ratio = buybackRatio(spec);
    assert.ok(ratio > 0, `${id} ratio must be positive`);
    assert.ok(ratio <= 0.20 + Number.EPSILON, `${id} ratio ${ratio} exceeds 20%`);
  }
});

test('resource buy entries use command delivery at reduced bundle sizes', () => {
  assert.deepEqual(buyEntry(REBUNDLED_BUYS.ingots5k), {
    Type: 'command',
    Description: 'Metal Ingots x500',
    Price: 45,
    Items: [{ Command: 'gfi MetalIngot 500 0 0', ExecuteAsAdmin: true, DisplayAs: 'Metal Ingots x500' }]
  });
});

test('sell entries match ArkShop native sell schema', () => {
  const entry = sellEntry(BASIC_SELLS.ingots);
  assert.deepEqual(entry, {
    Type: 'item',
    Description: 'Metal Ingots x500',
    Price: 9,
    Amount: 500,
    Blueprint: BASIC_SELLS.ingots[3]
  });
});

test('catalog verification requires the full rebundled buy and exact sell market', () => {
  const complete = {
    data: {
      ShopItems: Object.fromEntries(Object.entries(REBUNDLED_BUYS).map(([id, spec]) => [id, buyEntry(spec)])),
      SellItems: Object.fromEntries(Object.entries(BASIC_SELLS).map(([id, spec]) => [id, sellEntry(spec)]))
    }
  };
  assert.equal(hasCatalog(complete), true);
  delete complete.data.SellItems.stone;
  assert.equal(hasCatalog(complete), false);
  complete.data.SellItems.stone = sellEntry(BASIC_SELLS.stone);
  complete.data.ShopItems.wood10k.Price = 999;
  assert.equal(hasCatalog(complete), false);
});
