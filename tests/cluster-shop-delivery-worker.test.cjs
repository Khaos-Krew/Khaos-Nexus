'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { enabled, pollMs, deliverOne } = require('../src/sentinel/cluster-shop-delivery-worker.cjs');

function economyFixture(order) {
  const marks = [];
  return {
    marks,
    client: {
      configured: () => true,
      pendingShopOrders: async () => ({ orders: order ? [order] : [] }),
      markShopBuyDelivery: async (input) => { marks.push(input); return { ok: true, order: { ...order, claimId: 'claim-1' } }; }
    }
  };
}

test('Cluster Shop delivery worker is explicit opt-in and poll interval is bounded', () => {
  assert.equal(enabled({}), false);
  assert.equal(enabled({ NEXUS_CLUSTER_SHOP_DELIVERY_ENABLED: 'true' }), true);
  assert.equal(pollMs({ NEXUS_CLUSTER_SHOP_DELIVERY_POLL_MS: '100' }), 5000);
  assert.equal(pollMs({ NEXUS_CLUSTER_SHOP_DELIVERY_POLL_MS: '999999' }), 60000);
});

test('offline player is held without sending a reward', async () => {
  const order = { orderId: 'NX1', eosId: 'EOS_player_12345', status: 'PAID_QUEUED' };
  const fixture = economyFixture(order);
  let sent = false;
  const result = await deliverOne({
    economyClient: fixture.client,
    findServer: async () => null,
    rewardDelivery: async () => { sent = true; }
  });
  assert.equal(result.skipped, 'player-offline');
  assert.equal(sent, false);
  assert.deepEqual(fixture.marks, [{ orderId: 'NX1', status: 'PLAYER_OFFLINE' }]);
});

test('successful RewardsAscended acknowledgement completes the paid order', async () => {
  const order = { orderId: 'NX2', eosId: 'EOS_player_12345', status: 'PAID_QUEUED' };
  const fixture = economyFixture(order);
  const result = await deliverOne({
    economyClient: fixture.client,
    findServer: async () => ({ prefix: 'ARK_GEN1', server: { host: 'x' } }),
    clientFactory: () => ({ executeDetailed: async () => ({ response: 'unused' }) }),
    rewardDelivery: async () => ({ configured: { rewardId: 'NexusShop_NX2' }, result: { response: 'Player rewarded!' }, outcome: { state: 'DELIVERED', details: 'Player rewarded!' } })
  });
  assert.equal(result.status, 'DELIVERED');
  assert.equal(fixture.marks[0].status, 'DELIVERY_IN_PROGRESS');
  assert.equal(fixture.marks[1].status, 'DELIVERED');
});

test('ambiguous post-send delivery is never automatically retried as failed', async () => {
  const order = { orderId: 'NX3', eosId: 'EOS_player_12345', status: 'PAID_QUEUED' };
  const fixture = economyFixture(order);
  const result = await deliverOne({
    economyClient: fixture.client,
    findServer: async () => ({ prefix: 'ARK_GEN1', server: { host: 'x' } }),
    clientFactory: () => ({}),
    rewardDelivery: async () => ({ configured: { rewardId: 'NexusShop_NX3' }, outcome: { state: 'SENT_UNCONFIRMED', details: 'transport ambiguous' } })
  });
  assert.equal(result.status, 'SENT_UNCONFIRMED');
  assert.equal(fixture.marks[1].status, 'SENT_UNCONFIRMED');
});

test('failures before reward send are marked failed for safe operator retry', async () => {
  const order = { orderId: 'NX4', eosId: 'EOS_player_12345', status: 'PAID_QUEUED' };
  const fixture = economyFixture(order);
  const error = new Error('reload failed');
  error.beforeRewardSend = true;
  const result = await deliverOne({
    economyClient: fixture.client,
    findServer: async () => ({ prefix: 'ARK_GEN1', server: { host: 'x' } }),
    clientFactory: () => ({}),
    rewardDelivery: async () => { throw error; }
  });
  assert.equal(result.status, 'DELIVERY_FAILED');
  assert.equal(fixture.marks[1].status, 'DELIVERY_FAILED');
});
