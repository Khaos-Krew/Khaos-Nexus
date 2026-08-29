'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  LEVEL_BUCKETS, CACHE_POOLS, rollLevel, rollVariant, rollCache, DinoCacheJournal
} = require('../src/sentinel/ark-dino-cache-engine.cjs');

function sequence(values) {
  let index = 0;
  return () => values[index++ % values.length];
}

test('cache level buckets exactly preserve approved 200-300 weighting', () => {
  assert.deepEqual(LEVEL_BUCKETS, [
    { min: 200, max: 219, weight: 30 },
    { min: 220, max: 239, weight: 25 },
    { min: 240, max: 259, weight: 20 },
    { min: 260, max: 279, weight: 15 },
    { min: 280, max: 294, weight: 8 },
    { min: 295, max: 300, weight: 2 }
  ]);
  assert.equal(rollLevel(sequence([0, 0])), 200);
  assert.equal(rollLevel(sequence([0.999999, 0.999999])), 300);
});

test('verified launch pools preserve approved prices and use bounded class paths', () => {
  assert.equal(CACHE_POOLS.coastal.price, 800);
  assert.equal(CACHE_POOLS.forest.price, 1250);
  assert.equal(CACHE_POOLS.swamp.price, 1400);
  assert.equal(CACHE_POOLS.mountain.price, 1800);
  assert.equal(CACHE_POOLS.ocean.price, 2200);
  assert.equal(CACHE_POOLS.deepcave.price, 2200);
  assert.equal(CACHE_POOLS.apex.price, 8000);
  for (const pool of Object.values(CACHE_POOLS)) {
    for (const entry of pool.entries) {
      assert.match(entry.blueprint, /^\/Game\//);
      assert.ok(entry.blueprint.length < 240);
    }
  }
});

test('unsupported X/S rolls fall back to normal instead of rerolling species', () => {
  const entry = CACHE_POOLS.coastal.entries[0];
  const result = rollVariant(entry, { normal: 0, x: 100, s: 0 }, () => 0.5);
  assert.equal(result.requested, 'x');
  assert.equal(result.applied, 'normal');
  assert.equal(result.fallback, true);
});

test('cache rolls are deterministic with injected RNG and stay in approved bounds', () => {
  const result = rollCache('coastal', sequence([0.01, 0.01, 0.01, 0.01, 0.01, 0.99]));
  assert.equal(result.cacheId, 'coastal');
  assert.equal(result.price, 800);
  assert.ok(result.level >= 200 && result.level <= 300);
  assert.match(result.blueprint, /^\/Game\//);
  assert.equal(typeof result.shiny, 'boolean');
});

test('unverified caches fail closed rather than inventing creature paths', () => {
  assert.throws(() => rollCache('lostcolony', () => 0.5), /not-yet-verified/);
  assert.throws(() => rollCache('volcanic', () => 0.5), /not-yet-verified/);
});

test('transaction journal only allows charge-deliver or charge-refund terminal paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-cache-journal-'));
  const journal = new DinoCacheJournal(root);
  const tx = journal.create({ eosId: '0002abc123', cacheId: 'coastal', price: 800, roll: { species: 'Parasaur', level: 250 } });
  assert.equal(tx.state, 'prepared');
  const charged = journal.transition(tx.id, 'charged');
  assert.equal(charged.state, 'charged');
  assert.throws(() => journal.transition(tx.id, 'refunded'), /Invalid/);
  assert.equal(journal.transition(tx.id, 'refund_pending', 'delivery failed').state, 'refund_pending');
  assert.equal(journal.transition(tx.id, 'refunded').state, 'refunded');
});
