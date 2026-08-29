'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BASIC_SELLS,
  sellEntry,
  buybackRatio,
  validateCatalog,
  hasCatalog
} = require('../src/sentinel/arkshop-nexus-launch-v7-basic-sell-startup.cjs');

test('v7 basic sell catalog uses seven exact temporary listings', () => {
  assert.equal(Object.keys(BASIC_SELLS).length, 7);
  assert.equal(validateCatalog(), true);
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

test('sell entries match ArkShop native sell schema', () => {
  const entry = sellEntry(BASIC_SELLS.ingots);
  assert.deepEqual(entry, {
    Type: 'item',
    Description: 'Metal Ingots x5,000',
    Price: 90,
    Amount: 5000,
    Blueprint: BASIC_SELLS.ingots[3]
  });
});

test('catalog verification rejects partial or extra sell markets', () => {
  const complete = {
    data: {
      SellItems: Object.fromEntries(Object.entries(BASIC_SELLS).map(([id, spec]) => [id, sellEntry(spec)]))
    }
  };
  assert.equal(hasCatalog(complete), true);
  delete complete.data.SellItems.stone;
  assert.equal(hasCatalog(complete), false);

  complete.data.SellItems.stone = sellEntry(BASIC_SELLS.stone);
  complete.data.SellItems.unreviewed = { Type: 'item', Description: 'Bad', Price: 999, Amount: 1, Blueprint: "Blueprint'/Bad.Bad'" };
  assert.equal(hasCatalog(complete), false);
});
