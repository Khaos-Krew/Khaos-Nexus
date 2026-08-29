'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { arkCommand, CACHE_CHOICES, formatCacheResult } = require('../src/sentinel/ark-ops-extension.cjs');
const { cacheCooldown } = require('../src/sentinel/ark-dino-cache-purchase.cjs');

test('public ARK command exposes all seven Nexus Dino Cache choices', () => {
  const json = arkCommand().toJSON();
  const command = json.options.find((entry) => entry.name === 'shop-cache');
  assert.ok(command, 'shop-cache subcommand must exist');
  const cache = command.options.find((entry) => entry.name === 'cache');
  assert.equal(cache.required, true);
  assert.deepEqual(cache.choices.map((entry) => entry.value), ['coastal', 'forest', 'swamp', 'mountain', 'ocean', 'deepcave', 'apex']);
  assert.equal(CACHE_CHOICES.length, 7);
});

test('cache response never exposes connection credentials and clearly reports delivery', () => {
  const message = formatCacheResult({
    ok: true,
    transactionId: 'tx-123',
    roll: { cacheId: 'coastal', price: 800, species: 'Parasaur', level: 225, rarity: 'common' }
  });
  assert.match(message, /Nexus Dino Cache delivered/);
  assert.match(message, /Parasaur/);
  assert.match(message, /Level \*\*225/);
  assert.match(message, /Dino Ball/);
});

test('Apex cache enforces its seven-day cooldown before another charge', () => {
  const now = Date.parse('2026-08-29T18:00:00.000Z');
  const journal = {
    read() {
      return {
        version: 1,
        transactions: [{
          id: 'previous', eosId: 'EOS_PLAYER_123', cacheId: 'apex', state: 'delivered',
          createdAt: '2026-08-28T18:00:00.000Z', updatedAt: '2026-08-28T18:00:00.000Z'
        }]
      };
    }
  };
  const result = cacheCooldown(journal, 'EOS_PLAYER_123', 'apex', now);
  assert.equal(result.active, true);
  assert.equal(result.cooldownHours, 168);
  assert.equal(result.remainingSeconds, 6 * 24 * 60 * 60);
});

test('non-Apex caches do not receive an artificial cooldown', () => {
  const journal = { read: () => { throw new Error('should not read journal for no-cooldown cache'); } };
  const result = cacheCooldown(journal, 'EOS_PLAYER_123', 'coastal');
  assert.deepEqual(result, { active: false, cooldownHours: 0, remainingSeconds: 0 });
});
