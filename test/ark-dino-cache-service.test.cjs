'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { purchaseDinoCache } = require('../bot/ark-cache/cache-service.cjs');
const { parsePointBalance } = require('../bot/ark-cache/arkshop-points.cjs');

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

function paidGateway(calls) {
  return {
    async debitForCache({ eosId, cost }) {
      calls.push(['debit', eosId, cost]);
      return { eosId, cost, beforeBalance: 500, afterBalance: 400, serverId: 'ark-1', serverName: 'Astraeos' };
    },
    async refundCacheDebit({ eosId, cost }) {
      calls.push(['refund', eosId, cost]);
      return { eosId, amount: cost, beforeBalance: 400, afterBalance: 500 };
    },
  };
}

test('ArkShop debit is verified before RNG, persistence, reveal, and queue', async () => {
  const calls = [];
  const store = {
    async createPurchase(purchase) { calls.push(['persist', purchase.status]); return purchase; },
    async markAwaiting(cacheId) { calls.push(['queue', cacheId]); return { cacheId, status: 'AWAITING_LOGIN' }; },
  };
  const animate = async () => { calls.push(['animate']); };
  const rng = () => { calls.push(['rng']); return 0; };

  const result = await purchaseDinoCache({
    store,
    pointsGateway: paidGateway(calls),
    cache: cache(),
    discordId: 'discord-1',
    eosId: 'eos-1',
    message: {},
    rng,
    now: () => Date.UTC(2026, 7, 31, 21, 40, 0),
    animate,
  });

  assert.equal(result.purchase.status, 'ROLLING');
  assert.equal(result.purchase.metadata.paymentProvider, 'ARKSHOP');
  assert.equal(result.purchase.metadata.debitVerified, true);
  assert.equal(result.purchase.metadata.balanceBefore, 500);
  assert.equal(result.purchase.metadata.balanceAfter, 400);
  assert.equal(calls[0][0], 'debit');
  assert.ok(calls.findIndex((entry) => entry[0] === 'rng') > calls.findIndex((entry) => entry[0] === 'debit'));
  assert.ok(calls.findIndex((entry) => entry[0] === 'persist') > calls.findIndex((entry) => entry[0] === 'rng'));
});

test('insufficient ArkShop points block RNG completely', async () => {
  let rngCalls = 0;
  let persistCalls = 0;
  const error = new Error('Insufficient ArkShop points: 50 available, 100 required.');
  error.code = 'INSUFFICIENT_ARKSHOP_POINTS';

  await assert.rejects(() => purchaseDinoCache({
    store: {
      async createPurchase() { persistCalls += 1; },
      async markAwaiting() {},
    },
    pointsGateway: {
      async debitForCache() { throw error; },
      async refundCacheDebit() {},
    },
    cache: cache(),
    discordId: 'discord-admin',
    eosId: 'eos-admin',
    message: {},
    isAdmin: true,
    isOwner: true,
    rng: () => { rngCalls += 1; return 0; },
  }), (caught) => caught.code === 'INSUFFICIENT_ARKSHOP_POINTS');

  assert.equal(rngCalls, 0);
  assert.equal(persistCalls, 0);
});

test('admin/owner flags do not bypass or change the ArkShop charge', async () => {
  const calls = [];
  await purchaseDinoCache({
    store: {
      async createPurchase(purchase) { return purchase; },
      async markAwaiting(cacheId) { return { cacheId, status: 'AWAITING_LOGIN' }; },
    },
    pointsGateway: paidGateway(calls),
    cache: cache(),
    discordId: 'discord-admin',
    eosId: 'eos-admin',
    message: {},
    isAdmin: true,
    isOwner: true,
    rng: () => 0,
    animate: async () => {},
  });

  assert.deepEqual(calls[0], ['debit', 'eos-admin', 100]);
  assert.equal(calls.some((entry) => entry[0] === 'refund'), false);
});

test('a Discord reveal failure does not refund or discard the paid reward', async () => {
  const calls = [];
  let queued = false;
  const store = {
    async createPurchase(purchase) { return purchase; },
    async markAwaiting(cacheId) { queued = true; return { cacheId, status: 'AWAITING_LOGIN' }; },
  };

  const result = await purchaseDinoCache({
    store,
    pointsGateway: paidGateway(calls),
    cache: cache(),
    discordId: 'discord-1',
    eosId: 'eos-1',
    message: {},
    rng: () => 0,
    now: () => Date.UTC(2026, 7, 31, 21, 40, 0),
    animate: async () => { throw new Error('Discord edit failed'); },
    logger: { warn() {}, error() {} },
  });

  assert.equal(queued, true);
  assert.match(result.revealError.message, /Discord edit failed/);
  assert.equal(calls.some((entry) => entry[0] === 'refund'), false);
});

test('pre-persistence failure refunds the verified ArkShop debit and never queues', async () => {
  const calls = [];
  await assert.rejects(() => purchaseDinoCache({
    store: {
      async createPurchase() { throw new Error('database unavailable'); },
      async markAwaiting() { throw new Error('must not queue'); },
    },
    pointsGateway: paidGateway(calls),
    cache: cache(),
    discordId: 'discord-1',
    eosId: 'eos-1',
    message: {},
    rng: () => 0,
    animate: async () => {},
    logger: { warn() {}, error() {} },
  }), /database unavailable/);

  assert.deepEqual(calls.map((entry) => entry[0]), ['debit', 'refund']);
});

test('ArkShop balance parser handles normal RCON point responses', () => {
  assert.equal(parsePointBalance('Player has 12,345 points'), 12345);
  assert.equal(parsePointBalance('Points: 400'), 400);
});
