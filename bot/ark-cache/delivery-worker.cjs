'use strict';

const { ServerConnection } = require('../server-client.cjs');

const DEFINITE_PRE_SEND_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH']);

function cleanToken(value, label) {
  const token = String(value || '').trim();
  if (!token) throw new Error(`${label} is required.`);
  if (/\r|\n/.test(token)) throw new Error(`${label} contains an invalid line break.`);
  return token;
}

function renderCommandTemplate(template, purchase) {
  const source = String(template || '').trim();
  if (!source) throw new Error('Dino Depot commandTemplate is not configured. Delivery remains disabled until the verified command syntax is supplied.');
  if (!source.includes('{eosId}') || !source.includes('{blueprintPath}')) throw new Error('Dino Depot commandTemplate must include {eosId} and {blueprintPath}.');

  const values = {
    eosId: cleanToken(purchase.eosId, 'EOS ID'),
    blueprintPath: cleanToken(purchase.reward?.blueprintPath, 'Blueprint path'),
    level: cleanToken(purchase.reward?.level, 'Level'),
    sex: cleanToken(purchase.reward?.sex, 'Sex'),
    cacheId: cleanToken(purchase.cacheId, 'Cache ID'),
  };
  return source.replace(/\{(eosId|blueprintPath|level|sex|cacheId)\}/g, (_, key) => values[key]);
}

function playerListContainsEos(payload, eosId) {
  const target = String(eosId || '').trim().toLowerCase();
  if (!target) return false;
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload ?? '');
  return text.toLowerCase().includes(target);
}

function eligibleArkServers(servers, purchase) {
  const allowed = new Set((purchase.eligibleMaps || []).map((value) => String(value).toLowerCase()));
  return (Array.isArray(servers) ? servers : []).filter((server) => {
    if (String(server?.game || '').toLowerCase() !== 'ark') return false;
    if (!allowed.size) return true;
    return allowed.has(String(server.id || '').toLowerCase()) || allowed.has(String(server.name || '').toLowerCase());
  });
}

async function findOnlineServer(purchase, servers, options = {}) {
  const connectionFactory = options.connectionFactory || ((server) => new ServerConnection(server));
  for (const server of eligibleArkServers(servers, purchase)) {
    try {
      const connection = connectionFactory(server);
      const players = await connection.action('raw', { command: 'ListPlayers' });
      if (playerListContainsEos(players, purchase.eosId)) return { server, connection, players };
    } catch (error) {
      options.logger?.warn?.('[ark-cache] ListPlayers failed', { serverId: server?.id, error: error?.message });
    }
  }
  return null;
}

function responseConfirmsDelivery(response, successPattern) {
  if (!successPattern) return false;
  const text = typeof response === 'string' ? response : JSON.stringify(response ?? '');
  const pattern = successPattern instanceof RegExp ? successPattern : new RegExp(String(successPattern), 'i');
  return pattern.test(text);
}

function classifyDeliveryError(error) {
  const code = String(error?.code || error?.cause?.code || '').toUpperCase();
  if (DEFINITE_PRE_SEND_CODES.has(code)) return 'DELIVERY_FAILED';
  return 'DELIVERY_UNKNOWN';
}

async function deliverPurchase(purchase, serverMatch, deliveryConfig = {}) {
  let command;
  try {
    command = renderCommandTemplate(deliveryConfig.commandTemplate, purchase);
  } catch (error) {
    return { status: 'DELIVERY_FAILED', command: null, error, reason: error.message, preSend: true };
  }

  const connection = serverMatch?.connection || new ServerConnection(serverMatch.server);
  try {
    const response = await connection.action('raw', { command });
    if (!responseConfirmsDelivery(response, deliveryConfig.successPattern)) {
      return {
        status: 'DELIVERY_UNKNOWN',
        command,
        response,
        reason: 'RCON accepted the command but no configured success acknowledgement matched; automatic resend is forbidden.',
      };
    }
    return { status: 'DELIVERED', command, response };
  } catch (error) {
    return { status: classifyDeliveryError(error), command, error, reason: error?.message || 'RCON delivery failed.' };
  }
}

async function processPendingDeliveries({ store, servers, deliveryConfig, logger = console, limit = 20, connectionFactory }) {
  if (!store || typeof store.listAwaiting !== 'function' || typeof store.lockDelivery !== 'function' || typeof store.markDelivering !== 'function') {
    throw new Error('A cache delivery store implementing listAwaiting(), lockDelivery(), and markDelivering() is required.');
  }
  if (!deliveryConfig?.enabled) return [];
  if (!String(deliveryConfig.commandTemplate || '').trim()) {
    logger.warn?.('[ark-cache] Dino Depot delivery is enabled but commandTemplate is empty; leaving rewards queued.');
    return [];
  }

  const pending = await store.listAwaiting(Math.max(1, Math.min(100, Number(limit) || 20)));
  const results = [];

  for (const candidate of pending) {
    const online = await findOnlineServer(candidate, servers, { logger, connectionFactory });
    if (!online) continue;

    const locked = await store.lockDelivery(candidate.cacheId);
    if (!locked) continue;
    const purchase = await store.markDelivering(locked.cacheId);
    if (!purchase) continue;

    const result = await deliverPurchase(purchase, online, deliveryConfig);
    const mapName = online.server.name || online.server.id;

    if (result.status === 'DELIVERED') {
      await store.markDelivered(purchase.cacheId, { mapName, response: result.response });
    } else if (result.status === 'DELIVERY_FAILED') {
      await store.markFailed(purchase.cacheId, { mapName, reason: result.reason });
    } else {
      await store.markUnknown(purchase.cacheId, { mapName, reason: result.reason, response: result.response });
    }
    results.push({ cacheId: purchase.cacheId, mapName, status: result.status });
  }

  return results;
}

module.exports = {
  renderCommandTemplate,
  playerListContainsEos,
  eligibleArkServers,
  findOnlineServer,
  responseConfirmsDelivery,
  classifyDeliveryError,
  deliverPurchase,
  processPendingDeliveries,
};
