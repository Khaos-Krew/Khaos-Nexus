'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { BOSS_TROPHY_SELLS, bossSellEntry, validateCatalog } = require('../src/sentinel/arkshop-nexus-launch-v8-boss-sell-startup.cjs');

test('v8 defines all nine Island boss trophy sell entries', () => {
  assert.equal(Object.keys(BOSS_TROPHY_SELLS).length, 9);
  assert.equal(validateCatalog(), true);
  assert.equal(BOSS_TROPHY_SELLS.brood_gamma[1], 300);
  assert.equal(BOSS_TROPHY_SELLS.dragon_alpha[1], 1200);
});

test('v8 boss sells use exact single-item trophy schema', () => {
  const entry = bossSellEntry(BOSS_TROPHY_SELLS.mega_beta);
  assert.equal(entry.Type, 'item');
  assert.equal(entry.Amount, 1);
  assert.equal(entry.Price, 600);
  assert.match(entry.Blueprint, /PrimalItemTrophy_Gorilla_Beta/);
});
