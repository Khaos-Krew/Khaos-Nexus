'use strict';

const { ServerConnection } = require('../server-client.cjs');

const playerLocks = new Map();

function cleanEosId(value) {
  const eosId = String(value || '').trim();
  if (!eosId) throw new Error('EOS ID is required for ArkShop point debit.');
  if (/\s|\r|\n/.test(eosId)) throw new Error('EOS ID contains invalid whitespace.');
  return eosId;
}

function normalizeCost(value) {
  const cost = Number(value);
  if (!Number.isSafeInteger(cost) || cost <= 0) throw new Error('Dino Cache cost must be a positive integer.');
  return cost;
}

function parsePointBalance(response) {
  const text = typeof response === 'string' ? response : JSON.stringify(response ?? '');
  const matches = [...text.matchAll(/-?\d[\d,]*/g)].map((match) => Number(match[0].replace(/,/g, ''))).filter(Number.isSafeInteger);
  if (!matches.length) throw new Error(`ArkShop did not return a readable point balance: ${text.slice(0, 300)}`);
  return matches[matches.length - 1];
}

function arkServerCandidates(servers, preferredServer) {
  const enabled = (Array.isArray(servers) ? servers : []).filter((server) =>
    String(server?.game || '').toLowerCase() === 'ark' && server?.enabled !== false && server?.password
  );
  if (!preferredServer) return enabled;
  const key = String(preferredServer).toLowerCase();
  return enabled.sort((a, b) => {
    const aPreferred = [a.id, a.name].some((value) => String(value || '').toLowerCase() === key) ? 1 : 0;
    const bPreferred = [b.id, b.name].some((value) => String(value || '').toLowerCase() === key) ? 1 : 0;
    return bPreferred - aPreferred;
  });
}

async function withPlayerLock(eosId, fn) {
  const key = cleanEosId(eosId).toLowerCase();
  const previous = playerLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  playerLocks.set(key, previous.then(() => current));
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (playerLocks.get(key) === current) playerLocks.delete(key);
  }
}

class ArkShopPointsGateway {
  constructor(options = {}) {
    this.servers = options.servers || [];
    this.connectionFactory = options.connectionFactory || ((server) => new ServerConnection(server));
    this.logger = options.logger || console;
  }

  async executeOnArk(command, preferredServer) {
    let lastError = null;
    for (const server of arkServerCandidates(this.servers, preferredServer)) {
      try {
        const connection = this.connectionFactory(server);
        const response = await connection.action('raw', { command });
        return { server, response };
      } catch (error) {
        lastError = error;
        this.logger.warn?.('[ark-cache] ArkShop RCON command failed on one ARK server.', {
          serverId: server?.id,
          command: command.split(' ')[0],
          error: error?.message,
        });
      }
    }
    throw lastError || new Error('No enabled ARK RCON server is available for ArkShop point operations.');
  }

  async getBalance(eosId, preferredServer) {
    const id = cleanEosId(eosId);
    const { server, response } = await this.executeOnArk(`GetPlayerPoints ${id}`, preferredServer);
    return { balance: parsePointBalance(response), server, response };
  }

  async debitForCache({ eosId, cost, preferredServer }) {
    const id = cleanEosId(eosId);
    const amount = normalizeCost(cost);

    return withPlayerLock(id, async () => {
      const before = await this.getBalance(id, preferredServer);
      if (before.balance < amount) {
        const error = new Error(`Insufficient ArkShop points: ${before.balance} available, ${amount} required.`);
        error.code = 'INSUFFICIENT_ARKSHOP_POINTS';
        error.balance = before.balance;
        error.cost = amount;
        throw error;
      }

      const connection = this.connectionFactory(before.server);
      let changeResponse;
      try {
        changeResponse = await connection.action('raw', { command: `ChangePoints ${id} -${amount}` });
      } catch (error) {
        const wrapped = new Error(`ArkShop point deduction could not be confirmed before Dino Cache roll: ${error.message}`);
        wrapped.code = 'ARKSHOP_DEBIT_UNKNOWN';
        wrapped.cause = error;
        throw wrapped;
      }

      const after = await this.getBalance(id, before.server.id || before.server.name);
      const expected = before.balance - amount;
      if (after.balance !== expected) {
        const error = new Error(`ArkShop debit verification failed: expected ${expected} points after purchase, ArkShop reports ${after.balance}. Dino Cache roll blocked.`);
        error.code = 'ARKSHOP_DEBIT_VERIFICATION_FAILED';
        error.before = before.balance;
        error.after = after.balance;
        error.expected = expected;
        error.changeResponse = changeResponse;
        throw error;
      }

      return {
        eosId: id,
        cost: amount,
        beforeBalance: before.balance,
        afterBalance: after.balance,
        serverId: before.server.id || null,
        serverName: before.server.name || null,
        response: changeResponse,
      };
    });
  }

  async refundCacheDebit({ eosId, cost, preferredServer }) {
    const id = cleanEosId(eosId);
    const amount = normalizeCost(cost);
    return withPlayerLock(id, async () => {
      const before = await this.getBalance(id, preferredServer);
      const connection = this.connectionFactory(before.server);
      const response = await connection.action('raw', { command: `ChangePoints ${id} ${amount}` });
      const after = await this.getBalance(id, before.server.id || before.server.name);
      const expected = before.balance + amount;
      if (after.balance !== expected) {
        const error = new Error(`ArkShop refund verification failed: expected ${expected}, ArkShop reports ${after.balance}. Manual reconciliation required.`);
        error.code = 'ARKSHOP_REFUND_VERIFICATION_FAILED';
        error.before = before.balance;
        error.after = after.balance;
        error.expected = expected;
        error.response = response;
        throw error;
      }
      return { eosId: id, amount, beforeBalance: before.balance, afterBalance: after.balance, response };
    });
  }

  async debitPoints(options) {
    return this.debitForCache(options);
  }

  async refundPoints(options) {
    return this.refundCacheDebit(options);
  }
}

module.exports = {
  ArkShopPointsGateway,
  parsePointBalance,
  normalizeCost,
  cleanEosId,
  withPlayerLock,
};
