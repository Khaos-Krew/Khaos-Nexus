'use strict';

const { ArkRconClient } = require('./ark-rcon.cjs');
const { findOnlineServer } = require('./ark-dino-box-delivery-worker.cjs');
const { NexusEconomyClient } = require('./nexus-economy-client.cjs');
const { deliverShopOrderWithRewardsAscended } = require('./cluster-shop-rewards-delivery.cjs');

const INSTALLED = Symbol.for('khaos.nexus.cluster.shop.delivery.worker');
let timer = null;
let running = false;

function enabled(env = process.env) {
  return String(env.NEXUS_CLUSTER_SHOP_DELIVERY_ENABLED || '').trim().toLowerCase() === 'true';
}

function pollMs(env = process.env) {
  return Math.max(5000, Math.min(60000, Number(env.NEXUS_CLUSTER_SHOP_DELIVERY_POLL_MS || 10000) || 10000));
}

async function deliverOne({ economyClient = new NexusEconomyClient(), findServer = findOnlineServer, clientFactory = (server) => new ArkRconClient(server), rewardDelivery = deliverShopOrderWithRewardsAscended } = {}) {
  if (!economyClient.configured()) return { skipped: 'economy-worker-unconfigured' };
  const pending = await economyClient.pendingShopOrders();
  const order = (pending.orders || [])[0];
  if (!order) return { skipped: 'none-pending' };

  const target = await findServer(order.eosId);
  if (!target) {
    if (order.status !== 'PLAYER_OFFLINE') await economyClient.markShopBuyDelivery({ orderId: order.orderId, status: 'PLAYER_OFFLINE' });
    return { skipped: 'player-offline', orderId: order.orderId };
  }

  await economyClient.markShopBuyDelivery({ orderId: order.orderId, status: 'DELIVERY_IN_PROGRESS' });
  try {
    const client = clientFactory(target.server);
    const delivery = await rewardDelivery({ prefix: target.prefix, order, client });
    const status = delivery.outcome?.state || 'SENT_UNCONFIRMED';
    await economyClient.markShopBuyDelivery({
      orderId: order.orderId,
      status,
      deliveryReceipt: String(delivery.outcome?.details || delivery.result?.response || '').slice(0, 500),
      error: status === 'DELIVERY_FAILED' ? String(delivery.outcome?.details || '').slice(0, 500) : ''
    });
    return { orderId: order.orderId, server: target.prefix, rewardId: delivery.configured?.rewardId || '', status };
  } catch (error) {
    const beforeRewardSend = error?.beforeRewardSend === true;
    const status = beforeRewardSend ? 'DELIVERY_FAILED' : 'SENT_UNCONFIRMED';
    await economyClient.markShopBuyDelivery({ orderId: order.orderId, status, error: String(error?.message || error).slice(0, 500) });
    return { orderId: order.orderId, server: target.prefix, status, error: String(error?.message || error).slice(0, 300) };
  }
}

async function runCycle(options = {}) {
  if (running) return [{ skipped: 'busy' }];
  running = true;
  try {
    const results = [];
    for (let index = 0; index < 10; index += 1) {
      const result = await deliverOne(options);
      results.push(result);
      if (result?.skipped) break;
    }
    return results;
  } finally {
    running = false;
  }
}

function installClusterShopDeliveryWorker() {
  if (globalThis[INSTALLED]) return false;
  globalThis[INSTALLED] = true;
  if (!enabled()) {
    console.log('[Nexus Economy] Cluster Shop delivery worker disabled; storefront/orders remain fail-closed.');
    return false;
  }
  const interval = pollMs();
  setTimeout(() => runCycle().catch((error) => console.error('[Nexus Economy] Cluster Shop delivery startup failed:', String(error?.message || error).slice(0, 500))), 3000).unref?.();
  timer = setInterval(() => runCycle().catch((error) => console.error('[Nexus Economy] Cluster Shop delivery cycle failed:', String(error?.message || error).slice(0, 500))), interval);
  timer.unref?.();
  console.log(`[Nexus Economy] Cluster Shop RewardsAscended delivery worker enabled (${interval}ms).`);
  return true;
}

module.exports = { enabled, pollMs, deliverOne, runCycle, installClusterShopDeliveryWorker };
