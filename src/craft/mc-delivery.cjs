'use strict';

const { mcPointsFlags } = require('../shared/mc-points-flags.cjs');
const { orderLineHash } = require('../economy-worker/mc-points-service.cjs');
const {
  parseListUuids,
  countInventorySlots,
  parseGiveResponse,
  giveCommand,
  dataGetCommand,
  tellrawCommand
} = require('./mc-rcon-text.cjs');

let delivering = false;

function stacksRemaining(order) {
  return (order?.lines || []).filter((line) => line.status !== 'DELIVERED' && line.status !== 'SENT_UNCONFIRMED').length;
}

function catalogPinned(order) {
  return order?.catalogHash && order.catalogHash === orderLineHash(order.catalogVersion, order.lines);
}

async function deliverMcOrder(order, { rcon, points, deliveryEnabled = false } = {}) {
  if (!order) return { skipped: 'none' };
  if (!deliveryEnabled) return { skipped: 'delivery-disabled', orderId: order.orderId };
  if (order.status === 'SENT_UNCONFIRMED' || order.status === 'DELIVERED' || order.status === 'REFUNDED' || order.status === 'DELIVERY_FAILED') {
    return { skipped: 'no-retry', orderId: order.orderId, status: order.status };
  }
  if (!order.leaseToken || order.status !== 'DELIVERY_IN_PROGRESS') return { skipped: 'lease-required', orderId: order.orderId, status: order.status };
  if (!catalogPinned(order)) {
    await points.markDelivery({
      orderId: order.orderId,
      status: 'SENT_UNCONFIRMED',
      expectedStatus: 'DELIVERY_IN_PROGRESS',
      leaseToken: order.leaseToken,
      note: 'catalog-hash-mismatch'
    });
    return { orderId: order.orderId, status: 'SENT_UNCONFIRMED' };
  }
  let listed;
  try {
    listed = parseListUuids(await rcon('list uuids'));
  } catch (error) {
    return { skipped: 'rcon-failed', orderId: order.orderId, error: String(error?.message || error).slice(0, 200) };
  }
  if (!listed.ok) return { skipped: 'rcon-unparseable', orderId: order.orderId };
  const player = listed.players.find((entry) => entry.uuid === order.mcUuid);
  const sent = order.lines.some((line) => line.status === 'DELIVERED' || line.status === 'SENT_UNCONFIRMED');
  if (!player) {
    const status = sent ? 'SENT_UNCONFIRMED' : 'PLAYER_OFFLINE';
    await points.markDelivery({
      orderId: order.orderId,
      status,
      expectedStatus: 'DELIVERY_IN_PROGRESS',
      leaseToken: order.leaseToken
    });
    return { orderId: order.orderId, status, requeued: status === 'PLAYER_OFFLINE' };
  }
  let free = 0;
  try {
    const inventory = await rcon(dataGetCommand(player.uuid, 'Inventory'));
    free = countInventorySlots(inventory).free;
  } catch (error) {
    return { skipped: 'inventory-unreadable', orderId: order.orderId, error: String(error?.message || error).slice(0, 200) };
  }
  const needed = stacksRemaining(order);
  if (free < needed) {
    try {
      await rcon(tellrawCommand(player.uuid, `Free ${needed} slots to receive order ${order.orderId}`));
    } catch {}
    return { orderId: order.orderId, status: order.status, waitingSlots: needed, free };
  }
  for (let index = 0; index < order.lines.length; index += 1) {
    const line = order.lines[index];
    if (line.status === 'DELIVERED') continue;
    if (line.status === 'SENT_UNCONFIRMED') {
      await points.markDelivery({
        orderId: order.orderId,
        status: 'SENT_UNCONFIRMED',
        expectedStatus: 'DELIVERY_IN_PROGRESS',
        leaseToken: order.leaseToken
      });
      return { orderId: order.orderId, status: 'SENT_UNCONFIRMED' };
    }
    const stillOnline = parseListUuids(await rcon('list uuids'));
    if (!stillOnline.ok || !stillOnline.players.some((entry) => entry.uuid === order.mcUuid && entry.name === player.name)) {
      const status = order.lines.some((entry) => entry.status === 'DELIVERED') ? 'SENT_UNCONFIRMED' : 'PLAYER_OFFLINE';
      await points.markDelivery({
        orderId: order.orderId,
        status,
        expectedStatus: 'DELIVERY_IN_PROGRESS',
        leaseToken: order.leaseToken
      });
      return { orderId: order.orderId, status, requeued: status === 'PLAYER_OFFLINE' };
    }
    let response = '';
    try {
      response = await rcon(giveCommand(player.uuid, line.itemId, line.count));
    } catch {
      response = '';
    }
    const parsed = parseGiveResponse(response, { count: line.count, itemId: line.itemId, name: player.name });
    if (parsed.outcome === 'delivered') {
      await points.markDelivery({
        orderId: order.orderId,
        status: 'DELIVERY_IN_PROGRESS',
        expectedStatus: 'DELIVERY_IN_PROGRESS',
        leaseToken: order.leaseToken,
        lineIndex: index,
        lineStatus: 'DELIVERED'
      });
      continue;
    }
    await points.markDelivery({
      orderId: order.orderId,
      status: 'SENT_UNCONFIRMED',
      expectedStatus: 'DELIVERY_IN_PROGRESS',
      leaseToken: order.leaseToken,
      lineIndex: index,
      lineStatus: 'SENT_UNCONFIRMED',
      note: response
    });
    return { orderId: order.orderId, status: 'SENT_UNCONFIRMED' };
  }
  await points.markDelivery({
    orderId: order.orderId,
    status: 'DELIVERED',
    expectedStatus: 'DELIVERY_IN_PROGRESS',
    leaseToken: order.leaseToken
  });
  try {
    await rcon(tellrawCommand(player.uuid, `Delivered: ${order.sku} (${order.orderId})`));
  } catch {}
  return { orderId: order.orderId, status: 'DELIVERED' };
}

async function runMcDeliveryCycle({ points, rcon, env = process.env, limit = 10 } = {}) {
  const flags = mcPointsFlags(env);
  if (flags.dryRun) return [{ skipped: 'dry-run' }];
  if (delivering) return [{ skipped: 'in-flight' }];
  delivering = true;
  try {
    if (!flags.shopDeliveryEnabled || !points) return [{ skipped: 'delivery-disabled' }];
    const results = [];
    await points.sweepExpiredLeases?.();
    for (let index = 0; index < limit; index += 1) {
      if (typeof points.claimNext !== 'function') {
        results.push({ skipped: 'none-pending' });
        break;
      }
      const order = await points.claimNext({ owner: 'nexus-craft' });
      if (!order) {
        results.push({ skipped: 'none-pending' });
        break;
      }
      results.push(await deliverMcOrder(order, { rcon, points, deliveryEnabled: true }));
    }
    return results;
  } finally {
    delivering = false;
  }
}

module.exports = { stacksRemaining, deliverMcOrder, runMcDeliveryCycle, catalogPinned };
