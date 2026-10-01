'use strict';

const { mcPointsFlags } = require('../shared/mc-points-flags.cjs');
const {
  parseListUuids,
  countInventorySlots,
  parseGiveResponse,
  giveCommand,
  dataGetCommand,
  tellrawCommand
} = require('./mc-rcon-text.cjs');

function stacksRemaining(order) {
  return (order?.lines || []).filter((line) => line.status !== 'DELIVERED').length;
}

async function deliverMcOrder(order, { rcon, points, deliveryEnabled = false, writesEnabled = false } = {}) {
  if (!order) return { skipped: 'none' };
  if (!deliveryEnabled) return { skipped: 'delivery-disabled', orderId: order.orderId };
  if (order.status === 'SENT_UNCONFIRMED' || order.status === 'DELIVERY_IN_PROGRESS' || order.status === 'DELIVERED' || order.status === 'REFUNDED') {
    return { skipped: 'no-retry', orderId: order.orderId, status: order.status };
  }
  let listed;
  try {
    listed = parseListUuids(await rcon('list uuids'));
  } catch (error) {
    return { skipped: 'rcon-failed', orderId: order.orderId, error: String(error?.message || error).slice(0, 200) };
  }
  if (!listed.ok) return { skipped: 'rcon-unparseable', orderId: order.orderId };
  const player = listed.players.find((entry) => entry.uuid === order.mcUuid);
  if (!player) {
    await points.markDelivery({ orderId: order.orderId, status: 'PLAYER_OFFLINE' });
    return { orderId: order.orderId, status: 'PLAYER_OFFLINE' };
  }
  let free = 0;
  try {
    const inventory = await rcon(dataGetCommand(player.name, 'Inventory'));
    free = countInventorySlots(inventory).free;
  } catch (error) {
    return { skipped: 'inventory-unreadable', orderId: order.orderId, error: String(error?.message || error).slice(0, 200) };
  }
  const needed = stacksRemaining(order);
  if (free < needed) {
    try {
      await rcon(tellrawCommand(player.name, `Free ${needed} slots to receive order ${order.orderId}`));
    } catch {}
    return { orderId: order.orderId, status: order.status, waitingSlots: needed, free };
  }
  const started = await points.markDelivery({ orderId: order.orderId, status: 'DELIVERY_IN_PROGRESS' });
  if (!started?.ok) return { orderId: order.orderId, status: started?.reason || 'not-claimed' };
  for (let index = 0; index < order.lines.length; index += 1) {
    const line = order.lines[index];
    if (line.status === 'DELIVERED') continue;
    if (line.status === 'SENT_UNCONFIRMED') {
      await points.markDelivery({ orderId: order.orderId, status: 'SENT_UNCONFIRMED' });
      return { orderId: order.orderId, status: 'SENT_UNCONFIRMED' };
    }
    let response = '';
    try {
      response = await rcon(giveCommand(player.name, line.itemId, line.count));
    } catch {
      await points.markDelivery({ orderId: order.orderId, status: 'SENT_UNCONFIRMED', lineIndex: index, lineStatus: 'SENT_UNCONFIRMED' });
      return { orderId: order.orderId, status: 'SENT_UNCONFIRMED' };
    }
    const parsed = parseGiveResponse(response);
    if (parsed.outcome === 'delivered') {
      await points.markDelivery({ orderId: order.orderId, status: 'DELIVERY_IN_PROGRESS', lineIndex: index, lineStatus: 'DELIVERED' });
      continue;
    }
    if (parsed.outcome === 'failed') {
      await points.markDelivery({ orderId: order.orderId, status: 'DELIVERY_FAILED', lineIndex: index, lineStatus: 'DELIVERY_FAILED', note: response });
      await points.refund({ orderId: order.orderId, reason: 'delivery-failed', actor: 'auto', writesEnabled });
      return { orderId: order.orderId, status: 'DELIVERY_FAILED' };
    }
    if (parsed.outcome === 'offline') {
      await points.markDelivery({ orderId: order.orderId, status: 'PLAYER_OFFLINE' });
      return { orderId: order.orderId, status: 'PLAYER_OFFLINE' };
    }
    await points.markDelivery({ orderId: order.orderId, status: 'SENT_UNCONFIRMED', lineIndex: index, lineStatus: 'SENT_UNCONFIRMED', note: response });
    return { orderId: order.orderId, status: 'SENT_UNCONFIRMED' };
  }
  await points.markDelivery({ orderId: order.orderId, status: 'DELIVERED' });
  try {
    await rcon(tellrawCommand(player.name, `Delivered: ${order.sku} (${order.orderId})`));
  } catch {}
  return { orderId: order.orderId, status: 'DELIVERED' };
}

async function runMcDeliveryCycle({ points, rcon, env = process.env, limit = 10, writesEnabled = false } = {}) {
  const flags = mcPointsFlags(env);
  if (!flags.shopDeliveryEnabled || !points) return [{ skipped: 'delivery-disabled' }];
  const results = [];
  await points.sweepRefunds?.({ writesEnabled });
  for (let index = 0; index < limit; index += 1) {
    const order = points.claimNext?.();
    if (!order) {
      results.push({ skipped: 'none-pending' });
      break;
    }
    results.push(await deliverMcOrder(order, { rcon, points, deliveryEnabled: true, writesEnabled }));
  }
  return results;
}

module.exports = { stacksRemaining, deliverMcOrder, runMcDeliveryCycle };
