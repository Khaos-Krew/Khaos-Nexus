'use strict';

const http = require('node:http');
const https = require('node:https');
const { arkNpFlags } = require('../shared/ark-np-flags.cjs');
const { buildKitReward, loadArkNpCatalog } = require('../shared/ark-np-catalog.cjs');
const { buildRewardEntry, classifyReloadResult, classifyRewardResult, upsertRewardDefinition } = require('./rewards-ascended-delivery.cjs');
const { findOnlineServer } = require('./ark-dino-box-delivery-worker.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.np.delivery.installed');

function rewardIdFor(order) {
  const raw = String(order?.orderId || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!raw) throw new Error('ARK order is missing an id.');
  return `NexusNp_${raw}`.slice(0, 60);
}

function cacheDesired(order) {
  const roll = order?.roll || {};
  return buildRewardEntry({
    blueprint: roll.blueprint,
    level: roll.level,
    sex: roll.sex,
    saddleBlueprint: roll.saddle || ''
  });
}

function kitDesired(order) {
  const catalog = loadArkNpCatalog();
  const lines = Array.isArray(order?.lines) && order.lines.length
    ? order.lines.map((line) => ({ blueprint: line.blueprint, amount: line.count || line.amount, quality: line.quality || 0 }))
    : catalog.kit.items;
  return buildKitReward(lines);
}

function desiredFor(order) {
  if (order?.sku === 'ark-starter-kit' || order?.source === 'ark-starter-kit') return kitDesired(order);
  return cacheDesired(order);
}

async function deliverPreparedOrder(order, deps) {
  const eosIds = [...new Set((order?.eosIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  const located = [];
  let multi = false;
  for (const eosId of eosIds) {
    try {
      const hit = await deps.findOnline(eosId);
      if (hit) located.push({ eosId, hit });
    } catch (error) {
      if (/multiple ARK maps/i.test(String(error?.message || ''))) multi = true;
      else throw error;
    }
  }
  const prefixes = new Set(located.map((item) => item.hit.prefix));
  if (multi || prefixes.size > 1 || located.length > 1) {
    await deps.markOffline(order, { multi: true });
    return { ok: false, reason: 'player-offline', multi: true, raCalled: false };
  }
  if (!located.length) {
    await deps.markOffline(order, { multi: false });
    return { ok: false, reason: 'player-offline', raCalled: false };
  }
  const target = located[0];
  const rewardId = rewardIdFor(order);
  await deps.writeReward(target.hit.prefix, rewardId, deps.desired ? deps.desired(order) : desiredFor(order));
  let reload;
  try {
    reload = await deps.reload(target.hit);
  } catch {
    await deps.markPreSendFailure(order, 'reload transport failed');
    return { ok: false, reason: 'delivery-failed', raCalled: false };
  }
  const reloadClass = deps.classifyReload(reload);
  if (!reloadClass.ok) {
    await deps.markPreSendFailure(order, reloadClass.response || 'reload failed');
    return { ok: false, reason: 'delivery-failed', raCalled: false };
  }
  const progressed = await deps.markInProgress(order);
  if (!progressed?.ok) return { ...progressed, raCalled: false };
  let rewardResult;
  try {
    rewardResult = await deps.reward(target.hit, target.eosId, rewardId);
  } catch {
    await deps.markDelivery({
      orderId: order.orderId,
      leaseToken: progressed.order.leaseToken,
      status: 'SENT_UNCONFIRMED',
      details: 'transport'
    });
    return { ok: false, reason: 'sent-unconfirmed', raCalled: true };
  }
  const outcome = deps.classifyReward(rewardResult);
  const marked = await deps.markDelivery({
    orderId: order.orderId,
    leaseToken: progressed.order.leaseToken,
    status: outcome.state,
    failureClass: outcome.failureClass,
    details: outcome.details
  });
  return { ok: outcome.state === 'DELIVERED', reason: outcome.state, raCalled: true, order: marked.order || progressed.order };
}

async function runDeliveryPass(deps) {
  const flags = deps.flags();
  if (!flags.shopDeliveryEnabled || flags.dryRun) return { ok: true, skipped: 'delivery-off', raCalled: false };
  const order = await deps.claim();
  if (!order) return { ok: true, skipped: 'empty', raCalled: false };
  return deliverPreparedOrder(order, deps);
}

function arkRequest(env, pathname, { method = 'GET', body = null } = {}) {
  const base = String(env.NEXUS_ECONOMY_URL || '').trim().replace(/\/$/, '');
  const token = String(env.NEXUS_ECONOMY_ARK_DELIVERY_TOKEN || '').trim();
  if (!base || !token) return Promise.reject(new Error('ark-delivery-not-configured'));
  const url = new URL(`${base}${pathname}`);
  const transport = url.protocol === 'https:' ? https : http;
  const payload = body == null ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = transport.request(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {})
      }
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try { resolve(raw ? JSON.parse(raw) : {}); }
        catch { reject(new Error('ark-delivery-bad-response')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('ark-delivery-timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

function httpDeps(env) {
  return {
    flags: () => arkNpFlags(env),
    async claim() {
      const body = await arkRequest(env, '/np-shop/claim', { method: 'POST', body: { owner: 'sentinal-ark' } });
      return body.order || null;
    },
    async findOnline(eosId) { return findOnlineServer(eosId, env); },
    async writeReward(prefix, rewardId, desired) { return upsertRewardDefinition(prefix, rewardId, desired, env); },
    async reload(hit) {
      const { ArkRconClient } = require('./ark-rcon.cjs');
      const client = new ArkRconClient(hit.server);
      return client.executeDetailed('RA.Reload');
    },
    classifyReload: classifyReloadResult,
    async markOffline(order, { multi = false } = {}) {
      return arkRequest(env, '/np-shop/delivery-status', {
        method: 'POST',
        body: { action: 'offline', orderId: order.orderId, leaseToken: order.leaseToken, multi }
      });
    },
    async markPreSendFailure(order, details) {
      return arkRequest(env, '/np-shop/delivery-status', {
        method: 'POST',
        body: { action: 'pre-send-failed', orderId: order.orderId, leaseToken: order.leaseToken, details }
      });
    },
    async markInProgress(order) {
      return arkRequest(env, '/np-shop/delivery-status', {
        method: 'POST',
        body: { action: 'in-progress', orderId: order.orderId, leaseToken: order.leaseToken }
      });
    },
    async markDelivery(input) {
      return arkRequest(env, '/np-shop/delivery-status', { method: 'POST', body: { action: 'result', ...input } });
    },
    async reward(hit, eosId, rewardId) {
      const { ArkRconClient } = require('./ark-rcon.cjs');
      const client = new ArkRconClient(hit.server);
      return client.executeDetailed(`RA.Reward ${eosId} ${rewardId}`);
    },
    classifyReward: classifyRewardResult,
    desired: desiredFor
  };
}

async function runSweep(env = process.env) {
  if (!arkNpFlags(env).npShopWritesEnabled) return { ok: true, skipped: 'writes-off' };
  if (!String(env.NEXUS_ECONOMY_URL || '').trim() || !String(env.NEXUS_ECONOMY_ARK_DELIVERY_TOKEN || '').trim()) {
    return { ok: true, skipped: 'not-configured' };
  }
  return arkRequest(env, '/np-shop/refund-sweep', { method: 'POST', body: {} });
}

function installArkNpDelivery({ env = process.env } = {}) {
  if (globalThis[INSTALLED]) return false;
  globalThis[INSTALLED] = true;
  const sweep = setInterval(() => {
    runSweep(env).catch((error) => {
      console.warn(`[Nexus Economy] ark_refund_sweep ${String(error?.message || error).slice(0, 160)}`);
    });
  }, 60 * 1000);
  sweep.unref?.();
  const delivery = setInterval(() => {
    const flags = arkNpFlags(env);
    if (!flags.shopDeliveryEnabled || flags.dryRun) return;
    runDeliveryPass(httpDeps(env)).catch((error) => {
      console.warn(`[Nexus Economy] ark_delivery ${String(error?.message || error).slice(0, 160)}`);
    });
  }, 15 * 1000);
  delivery.unref?.();
  return true;
}

module.exports = {
  rewardIdFor,
  desiredFor,
  deliverPreparedOrder,
  runDeliveryPass,
  runSweep,
  installArkNpDelivery,
  httpDeps
};
