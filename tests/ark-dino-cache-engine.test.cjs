'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LEVEL_BUCKETS, SHINY_CHANCE, CACHE_POOLS, deterministicRng, rollLevel, rollVariant, rollCache, cacheForPurchase } = require('../src/sentinel/ark-dino-cache-engine.cjs');
const sequence = (values) => { let index = 0; return () => values[index++ % values.length]; };

test('level buckets exactly match the approved 200-300 distribution', () => {
  assert.deepEqual(LEVEL_BUCKETS, [
    { min: 200, max: 224, weight: 30 }, { min: 225, max: 249, weight: 30 }, { min: 250, max: 274, weight: 22 },
    { min: 275, max: 289, weight: 12 }, { min: 290, max: 299, weight: 5 }, { min: 300, max: 300, weight: 1 }
  ]);
  assert.equal(LEVEL_BUCKETS.reduce((sum, bucket) => sum + bucket.weight, 0), 100);
  assert.equal(rollLevel(sequence([0, 0])), 200);
  assert.equal(rollLevel(sequence([0.299999, 0.999999])), 224);
  assert.equal(rollLevel(sequence([0.30, 0])), 225);
  assert.equal(rollLevel(sequence([0.999999, 0])), 300);
});

test('all configured caches are central, bounded, and explicitly non-Shiny', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(CACHE_POOLS).map(([id, pool]) => [id, pool.price])), {
    coastal: 800,
    forest: 1250,
    swamp: 1400,
    mountain: 1800,
    ocean: 2200,
    deepcave: 2200,
    apex: 8000,
    'fantastical-tames': 4000,
    'bobs-tall-tales': 4000
  });
  assert.equal(Object.keys(CACHE_POOLS).length, 9);
  for (const pool of Object.values(CACHE_POOLS)) {
    assert.ok(pool.entries.length > 0 && pool.entries.length <= 64, 'cache pools must stay explicitly bounded');
    for (const entry of pool.entries) assert.match(entry.blueprint, /^\/Game\//);
  }
  assert.equal(SHINY_CHANCE, 0);
});

test('variant selection only considers variants the selected creature supports', () => {
  const normalOnly = CACHE_POOLS.coastal.entries.find((entry) => entry.name === 'Moschops');
  const result = rollVariant(normalOnly, { normal: 1, x: 100, s: 100 }, () => 0.999);
  assert.deepEqual(result, { requested: 'normal', applied: 'normal', fallback: false, blueprint: normalOnly.blueprint });
  const trike = CACHE_POOLS.coastal.entries.find((entry) => entry.name === 'Trike');
  assert.equal(rollVariant(trike, { normal: 0, x: 1, s: 0 }, () => 0).applied, 'x');
  assert.equal(rollVariant(trike, { normal: 0, x: 0, s: 1 }, () => 0).applied, 's');
});

test('a stable purchase identity produces a deterministic, deliverable roll', () => {
  const secret = 'a'.repeat(32);
  const first = rollCache('coastal', deterministicRng(secret, 'arkshop:1:42'));
  const second = rollCache('coastal', deterministicRng(secret, 'arkshop:1:42'));
  assert.deepEqual(first, second);
  assert.ok(first.level >= 200 && first.level <= 300);
  assert.ok(['normal', 'x', 's'].includes(first.variant));
  assert.equal(first.variantFallback, false);
  assert.equal(first.shiny, false);
  assert.notDeepEqual(first, rollCache('coastal', deterministicRng(secret, 'arkshop:1:43')));
});

test('ArkShop receipt aliases resolve per map and unknown products fail closed', () => {
  assert.equal(cacheForPurchase('NEXUS_CACHE_COASTAL', 'Genesis Part 1').id, 'coastal');
  assert.equal(cacheForPurchase('ordinary_shop_item', 'Genesis Part 1'), null);
  assert.throws(() => rollCache('lostcolony', () => 0.5), /Unknown dino cache/);
});
