'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  rewardIdForShopOrder,
  itemRewardEntry,
  upsertShopReward,
  deliverShopOrderWithRewardsAscended
} = require('../src/sentinel/cluster-shop-rewards-delivery.cjs');

const order = {
  orderId: 'NXARK-ABC-123',
  eosId: 'EOS_player_12345',
  quote: {
    blueprint: '/Game/PrimalEarth/CoreBlueprints/Resources/PrimalItemResource_MetalIngot.PrimalItemResource_MetalIngot',
    totalQuantity: 500
  }
};

test('cluster shop reward ids are deterministic and item rewards preserve exact quantity', () => {
  assert.equal(rewardIdForShopOrder(order), 'NexusShop_NXARK-ABC-123');
  const reward = itemRewardEntry(order);
  assert.equal(reward.Items.length, 1);
  assert.equal(reward.Items[0].Amount, 500);
  assert.equal(reward.Items[0].UseRandomAmount, false);
  assert.equal(reward.Items[0].MinRandomAmount, 500);
  assert.equal(reward.Items[0].MaxRandomAmount, 500);
  assert.match(reward.Items[0].Blueprint, /^Blueprint'\/Game\//);
});

test('invalid delivery quantity and non-item blueprint paths fail closed', () => {
  assert.throws(() => itemRewardEntry({ orderId: 'x', quote: { blueprint: '/bad/path', totalQuantity: 1 } }));
  assert.throws(() => itemRewardEntry({ orderId: 'x', quote: { blueprint: order.quote.blueprint, totalQuantity: 0 } }));
});

test('reward config write is backed up and verified before RCON reward', async () => {
  let current = JSON.stringify({ Config: { UseOverride: false }, Rewards: {} }, null, 2);
  const puts = [];
  const fakeSftp = {
    exists: async () => true,
    get: async () => Buffer.from(current),
    mkdir: async () => {},
    put: async (buffer, file) => {
      puts.push(file);
      if (String(file).endsWith('config.json') && !String(file).includes('NexusBackups')) current = buffer.toString('utf8');
    },
    end: async () => {}
  };
  const connector = async () => ({ client: fakeSftp, settings: { root: '/server' } });
  const result = await upsertShopReward('ARK_GEN1', order, {}, connector);
  assert.equal(result.changed, true);
  assert.equal(JSON.parse(current).Rewards[result.rewardId].Items[0].Amount, 500);
  assert.equal(puts.some((file) => String(file).includes('NexusBackups')), true);
});

test('delivery only reports delivered on exact RewardsAscended acknowledgement', async () => {
  let current = JSON.stringify({ Config: { UseOverride: false }, Rewards: {} }, null, 2);
  const fakeSftp = {
    exists: async () => true,
    get: async () => Buffer.from(current),
    mkdir: async () => {},
    put: async (buffer, file) => { if (!String(file).includes('NexusBackups')) current = buffer.toString('utf8'); },
    end: async () => {}
  };
  const connector = async () => ({ client: fakeSftp, settings: { root: '/server' } });
  const commands = [];
  const client = {
    executeDetailed: async (command) => {
      commands.push(command);
      if (command === 'RA.Reload') return { response: 'Reloaded config' };
      return { response: 'Player rewarded!' };
    }
  };
  const result = await deliverShopOrderWithRewardsAscended({ prefix: 'ARK_GEN1', order, client, env: {}, connector });
  assert.equal(result.outcome.state, 'DELIVERED');
  assert.deepEqual(commands, ['RA.Reload', 'RA.Reward EOS_player_12345 NexusShop_NXARK-ABC-123']);
});
