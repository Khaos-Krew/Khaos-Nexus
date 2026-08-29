'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CACHE_POOLS } = require('../src/sentinel/ark-dino-cache-engine.cjs');
const {
  TICKETS_PER_CATEGORY,
  categoryName,
  blueprintWeights,
  allocateTickets,
  buildDinoDepotCacheConfig
} = require('../src/sentinel/dinodepot-cache-config.cjs');

test('Dino Depot Nexus config exposes all seven cache categories deterministically', () => {
  const first = buildDinoDepotCacheConfig();
  const second = buildDinoDepotCacheConfig();
  assert.deepEqual(first, second);
  const categories = first.spawnDinoInBallConfig.randomSelectCategories;
  assert.equal(categories.length, 7);
  assert.deepEqual(categories.map((entry) => entry.name), Object.keys(CACHE_POOLS).map(categoryName));
  for (const entry of categories) {
    assert.equal(entry.dinoTypes.length, TICKETS_PER_CATEGORY);
    assert.ok(entry.dinoTypes.every((value) => /^\/(?:Game|SDinoVariants)\//.test(value)));
  }
});

test('ticket allocation is exact and preserves supported X/S paths', () => {
  const mountain = CACHE_POOLS.mountain;
  const weights = blueprintWeights(mountain);
  const tickets = allocateTickets(weights);
  assert.equal(tickets.length, TICKETS_PER_CATEGORY);
  assert.ok(tickets.some((value) => value.startsWith('/Game/Genesis/Dinos/BiomeVariants/')));
  assert.ok(tickets.some((value) => value.startsWith('/SDinoVariants/')));
  assert.ok(tickets.some((value) => value.startsWith('/Game/PrimalEarth/')));
});
