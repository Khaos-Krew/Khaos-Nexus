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

function giveAlreadySent(order) {
  return (order?.lines || []).some((line) => line.status === 'DELIVERED' || line.status === 'SENT_UNCONFIRMED');
}

async function recordStatus(points, input) {
  const result = await points.markDelivery(input);
  if (!result?.ok) {
    return {
      orderId: input.orderId,
      statusUpdateFailed: true,
      reason: result?.reason || 'status-update-failed'
    };
  }
  return null;
}

async function requeueBeforeGive(order, points, note) {
  const status = giveAlreadySent(order) ? 'SENT_UNCONFIRMED' : 'PLAYER_OFFLINE';
  const failed = await recordStatus(points, {
    orderId: order.orderId,
    status,
    expectedStatus: 'DELIVERY_IN_PROGRESS',
    leaseToken: order.leaseToken,
    note
  });
  if (failed) return failed;
  return { orderId: order.orderId, status, requeued: status === 'PLAYER_OFFLINE', note };
}

async function deliverMcOrder(order, { rcon, points, deliveryEnabled = false } = {}) {
  if (!order) return { skipped: 'none' };
  if (!deliveryEnabled) return { skipped: 'delivery-disabled', orderId: order.orderId };
  if (order.status === 'SENT_UNCONFIRMED' || order.status === 'DELIVERED' || order.status === 'REFUNDED' || order.status === 'DELIVERY_FAILED') {
    return { skipped: 'no-retry', orderId: order.orderId, status: order.status };
  }
  if (!order.leaseToken || order.status !== 'DELIVERY_IN_PROGRESS') return { skipped: 'lease-required', orderId: order.orderId, status: order.status };
  if (!catalogPinned(order)) {
    const failed = await recordStatus(points, {
      orderId: order.orderId,
      status: 'SENT_UNCONFIRMED',
      expectedStatus: 'DELIVERY_IN_PROGRESS',
      leaseToken: order.leaseToken,
      note: 'catalog-hash-mismatch'
    });
    if (failed) return failed;
    return { orderId: order.orderId, status: 'SENT_UNCONFIRMED' };
  }
  let listed;
  try {
    listed = parseListUuids(await rcon('list uuids'));
  } catch {
    return requeueBeforeGive(order, points, 'rcon-failed');
  }
  if (!listed.ok) return requeueBeforeGive(order, points, 'rcon-unparseable');
  const player = listed.players.find((entry) => entry.uuid === order.mcUuid);
  if (!player) return requeueBeforeGive(order, points, 'player-offline');
  let free = 0;
  try {
    const inventory = await rcon(dataGetCommand(player.uuid, 'Inventory'));
    free = countInventorySlots(inventory).free;
  } catch {
    return requeueBeforeGive(order, points, 'inventory-unreadable');
  }
  const needed = stacksRemaining(order);
  if (free < needed) {
    try {
      await rcon(tellrawCommand(player.uuid, `Free ${needed} slots to receive order ${order.orderId}`));
    } catch {}
    const waiting = await requeueBeforeGive(order, points, 'inventory-full');
    return { ...waiting, waitingSlots: needed, free };
  }
  for (let index = 0; index < order.lines.length; index += 1) {
    const line = order.lines[index];
    if (line.status === 'DELIVERED') continue;
    if (line.status === 'SENT_UNCONFIRMED') {
      const failed = await recordStatus(points, {
        orderId: order.orderId,
        status: 'SENT_UNCONFIRMED',
        expectedStatus: 'DELIVERY_IN_PROGRESS',
        leaseToken: order.leaseToken
      });
      if (failed) return failed;
      return { orderId: order.orderId, status: 'SENT_UNCONFIRMED' };
    }
    let stillOnline;
    try {
      stillOnline = parseListUuids(await rcon('list uuids'));
    } catch {
      return requeueBeforeGive(order, points, 'rcon-failed');
    }
    if (!stillOnline.ok || !stillOnline.players.some((entry) => entry.uuid === order.mcUuid)) {
      return requeueBeforeGive(order, points, 'player-offline');
    }
    let response = '';
    try {
      response = await rcon(giveCommand(player.uuid, line.itemId, line.count));
    } catch {
      response = '';
    }
    const parsed = parseGiveResponse(response, { count: line.count, itemId: line.itemId });
    if (parsed.outcome === 'delivered') {
      const failed = await recordStatus(points, {
        orderId: order.orderId,
        status: 'DELIVERY_IN_PROGRESS',
        expectedStatus: 'DELIVERY_IN_PROGRESS',
        leaseToken: order.leaseToken,
        lineIndex: index,
        lineStatus: 'DELIVERED'
      });
      if (failed) return failed;
      continue;
    }
    const failed = await recordStatus(points, {
      orderId: order.orderId,
      status: 'SENT_UNCONFIRMED',
      expectedStatus: 'DELIVERY_IN_PROGRESS',
      leaseToken: order.leaseToken,
      lineIndex: index,
      lineStatus: 'SENT_UNCONFIRMED',
      note: response
    });
    if (failed) return failed;
    return { orderId: order.orderId, status: 'SENT_UNCONFIRMED' };
  }
  const failed = await recordStatus(points, {
    orderId: order.orderId,
    status: 'DELIVERED',
    expectedStatus: 'DELIVERY_IN_PROGRESS',
    leaseToken: order.leaseToken
  });
  if (failed) return failed;
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
      let outcome;
      try {
        outcome = await deliverMcOrder(order, { rcon, points, deliveryEnabled: true });
      } catch (error) {
        outcome = { orderId: order.orderId, statusUpdateFailed: true, reason: String(error?.message || error).slice(0, 200) };
      }
      results.push(outcome);
      if (outcome?.statusUpdateFailed) break;
    }
    return results;
  } finally {
    delivering = false;
  }
}

module.exports = { stacksRemaining, deliverMcOrder, runMcDeliveryCycle, catalogPinned };
