'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { recordPurchasedCache } = require('../bot/ark-cache/cache-service.cjs');

function cache() {
  return {
    id: 'test-cache',
    name: 'Test Cache',
    cost: 100,
    level: { min: 200, max: 200 },
    variantWeights: { Normal: 1, X: 0, S: 0 },
    sexWeights: { Male: 1, Female: 0 },
    species: [{
      id: 'rex',
      name: 'Rex',
      weight: 1,
      blueprints: { Normal: '/Game/Test/Rex.Rex' },
    }],
  };
}

test('purchase is persisted before reveal and queued after reveal', async () => {
  const calls = [];
  const store = {
    async createPurchase(purchase) { calls.push(['persist', purchase.status]); return purchase; },
    async markAwaiting(cacheId) { calls.push(['queue', cacheId]); return { cacheId, status: 'AWAITING_LOGIN' }; },
  };
  const animate = async () => { calls.push(['animate']); };

  const result = await recordPurchasedCache({
    store,
    cache: cache(),
    discordId: 'discord-1',
    eosId: 'eos-1',
    message: {},
    rng: () => 0,
    now: () => Date.UTC(2026, 7, 31, 21, 40, 0),
    animate,
  });

  assert.equal(result.purchase.status, 'ROLLING');
  assert.deepEqual(calls.map((entry) => entry[0]), ['persist', 'animate', 'queue']);
});

test('a Discord reveal failure does not discard the purchased reward', async () => {
  let queued = false;
  const store = {
    async createPurchase(purchase) { return purchase; },
    async markAwaiting(cacheId) { queued = true; return { cacheId, status: 'AWAITING_LOGIN' }; },
  };

  const result = await recordPurchasedCache({
    store,
    cache: cache(),
    discordId: 'discord-1',
    eosId: 'eos-1',
    message: {},
    rng: () => 0,
    now: () => Date.UTC(2026, 7, 31, 21, 40, 0),
    animate: async () => { throw new Error('Discord edit failed'); },
    logger: { warn() {} },
  });

  assert.equal(queued, true);
  assert.match(result.revealError.message, /Discord edit failed/);
});
