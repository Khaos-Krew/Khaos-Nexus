'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT_PRICES } = require('../src/sentinel/arkshop-nexus-launch-v3-kits-startup.cjs');
const { REBUNDLED_BUYS, BASIC_SELLS, buyEntry, sellEntry } = require('../src/sentinel/arkshop-nexus-launch-v7-basic-sell-startup.cjs');
const { BOSS_TROPHY_SELLS, bossSellEntry } = require('../src/sentinel/arkshop-nexus-launch-v8-boss-sell-startup.cjs');
const { launchReadiness } = require('../src/sentinel/arkshop-launch-readiness.cjs');

test('launch readiness requires the complete static ARK shop baseline', () => {
  const Kits = { starter: { Price: 0, DefaultAmount: 1 } };
  for (const [id, price] of Object.entries(KIT_PRICES)) Kits[id] = { Price: price };
  const ShopItems = {
    dinoballs5: {}, dinoballs25: {}, dinoballs100: {},
    ...Object.fromEntries(Object.entries(REBUNDLED_BUYS).map(([id, spec]) => [id, buyEntry(spec)]))
  };
  const SellItems = {
    ...Object.fromEntries(Object.entries(BASIC_SELLS).map(([id, spec]) => [id, sellEntry(spec)])),
    ...Object.fromEntries(Object.entries(BOSS_TROPHY_SELLS).map(([id, spec]) => [id, bossSellEntry(spec)]))
  };
  const profile = { data: { Kits, ShopItems, SellItems, General: {
    TimedPointsReward: { Enabled: true, Interval: 5, Groups: { Default: { Amount: 2 }, Premiums: { Amount: 4 } } },
    GiveDinosInCryopods: false
  } } };
  const ready = launchReadiness(profile);
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.missing, []);
});

test('launch readiness reports missing economy pieces', () => {
  const result = launchReadiness({ data: {} });
  assert.equal(result.ready, false);
  assert.ok(result.missing.includes('starter-kit'));
  assert.ok(result.missing.includes('shop:dinoballs5'));
  assert.ok(result.missing.includes('timed-points:enabled'));
});
