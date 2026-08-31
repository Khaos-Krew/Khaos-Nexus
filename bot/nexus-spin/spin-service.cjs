'use strict';

const { rollReward, freezeSpin } = require('./spin-engine.cjs');
const { SupabaseNexusSpinStore } = require('./supabase-store.cjs');
const { ArkShopPointsGateway, withPlayerLock, cleanEosId } = require('../ark-cache/arkshop-points.cjs');
const { findOnlineServer, responseConfirmsDelivery } = require('../ark-cache/delivery-worker.cjs');

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function safeToken(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} is required.`);
  if (/\r|\n/.test(text)) throw new Error(`${label} contains an invalid line break.`);
  return text;
}

function renderResourceCommand(template, row) {
  const source = String(template || '').trim();
  if (!source) throw new Error('Nexus Spin resource commandTemplate is not configured.');
  for (const token of ['{eosId}', '{resourceKey}', '{amount}', '{spinId}']) {
    if (!source.includes(token)) throw new Error(`Nexus Spin resource commandTemplate must include ${token}.`);
  }
  const values = {
    eosId: safeToken(row.eos_id || row.eosId, 'EOS ID'),
    resourceKey: safeToken(row.resource_key || row.resourceKey, 'Resource key'),
    amount: safeToken(row.amount, 'Resource amount'),
    spinId: safeToken(row.spin_id || row.spinId, 'Spin ID'),
  };
  return source.replace(/\{(eosId|resourceKey|amount|spinId)\}/g, (_, key) => values[key]);
}

async function creditPointsVerified(gateway, eosId, amount, preferredServer) {
  const id = cleanEosId(eosId);
  const points = Number(amount);
  if (!Number.isSafeInteger(points) || points <= 0) throw new Error('Point reward must be a positive integer.');
  return withPlayerLock(id, async () => {
    const before = await gateway.getBalance(id, preferredServer);
    const { response } = await gateway.executeOnArk(`ChangePoints ${id} ${points}`, before.server.id || before.server.name);
    const after = await gateway.getBalance(id, before.server.id || before.server.name);
    const expected = before.balance + points;
    if (after.balance !== expected) {
      const error = new Error(`Nexus Points reward verification failed: expected ${expected}, ArkShop reports ${after.balance}.`);
      error.code = 'NEXUS_SPIN_POINT_CREDIT_UNKNOWN';
      error.before = before.balance;
      error.after = after.balance;
      error.expected = expected;
      throw error;
    }
    return { beforeBalance: before.balance, afterBalance: after.balance, response };
  });
}

class NexusSpinService {
  constructor(options = {}) {
    this.config = options.config || {};
    this.store = options.store || new SupabaseNexusSpinStore(options.storeOptions);
    this.servers = options.servers || [];
    this.logger = options.logger || console;
    this.points = options.pointsGateway || new ArkShopPointsGateway({ servers: this.servers, logger: this.logger });
    this.rng = options.rng;
  }

  assertEnabled(channelId) {
    if (!this.config.enabled) {
      const error = new Error('Nexus Spin is not enabled yet.');
      error.code = 'NEXUS_SPIN_DISABLED';
      throw error;
    }
    const configuredChannel = String(this.config.channelId || '').trim();
    if (configuredChannel && configuredChannel !== String(channelId || '')) {
      const error = new Error('Nexus Spin can only be played in its configured Discord channel.');
      error.code = 'NEXUS_SPIN_WRONG_CHANNEL';
      throw error;
    }
  }

  async linkedAccount(discordId) {
    const link = await this.store.resolveVerifiedLink(discordId);
    if (!link?.eosId) {
      const error = new Error('Your Discord account is not linked to a verified ARK account. Link it before playing Nexus Spin.');
      error.code = 'NEXUS_SPIN_NOT_LINKED';
      throw error;
    }
    return link;
  }

  async play({ discordId, channelId }) {
    this.assertEnabled(channelId);
    const link = await this.linkedAccount(discordId);
    const reward = rollReward(this.config.rewards, this.rng);
    const spin = freezeSpin({ discordId, eosId: link.eosId, reward });
    const claim = await this.store.createSpinIfCooldownReady(spin, this.config.cooldownSeconds || 86400);
    if (!claim.allowed) {
      const error = new Error('Your Nexus Spin is still on cooldown.');
      error.code = 'NEXUS_SPIN_COOLDOWN';
      error.retryAfterSeconds = claim.retryAfterSeconds;
      error.nextAllowedAt = claim.nextAllowedAt;
      throw error;
    }

    const payout = await this.applyFreshReward(spin);
    return { spin, link, payout };
  }

  async applyFreshReward(spin) {
    const reward = spin.reward;
    if (reward.type === 'points') {
      try {
        const result = await creditPointsVerified(this.points, spin.eosId, reward.amount);
        await this.store.setStatus(spin.spinId, 'ROLLED', 'REWARDED', { payout: 'ARKSHOP_POINTS', afterBalance: result.afterBalance });
        return { status: 'REWARDED', mode: 'points', details: result };
      } catch (error) {
        await this.store.setStatus(spin.spinId, 'ROLLED', 'PENDING_POINTS', { error: error.code || error.message });
        this.logger.warn?.('[nexus-spin] Point reward queued for retry.', { spinId: spin.spinId, error: error.message });
        return { status: 'PENDING_POINTS', mode: 'points' };
      }
    }

    if (reward.type === 'cache_token') {
      try {
        const token = await this.store.createCacheToken(spin);
        await this.store.setStatus(spin.spinId, 'ROLLED', 'REWARDED', { payout: 'CACHE_TOKEN', tokenId: token?.token_id || null });
        return { status: 'REWARDED', mode: 'cache_token', token };
      } catch (error) {
        await this.store.setStatus(spin.spinId, 'ROLLED', 'PENDING_TOKEN', { error: error.message });
        this.logger.warn?.('[nexus-spin] Cache Token queued for retry.', { spinId: spin.spinId, error: error.message });
        return { status: 'PENDING_TOKEN', mode: 'cache_token' };
      }
    }

    await this.store.setStatus(spin.spinId, 'ROLLED', 'PENDING_RESOURCE', { payout: 'ARK_RESOURCE' });
    const immediate = await this.tryClaimOne({
      spin_id: spin.spinId,
      discord_id: spin.discordId,
      eos_id: spin.eosId,
      reward_type: reward.type,
      reward_key: reward.id,
      reward_label: reward.label,
      resource_key: reward.resourceKey,
      amount: reward.amount,
      status: 'PENDING_RESOURCE',
    });
    return immediate || { status: 'PENDING_RESOURCE', mode: 'resource' };
  }

  async deliverResource(row) {
    const delivery = this.config.resourceDelivery || {};
    if (!delivery.enabled || !String(delivery.commandTemplate || '').trim()) return { status: 'PENDING_RESOURCE', reason: 'Resource delivery is not enabled.' };
    const purchaseLike = { eosId: row.eos_id, eligibleMaps: delivery.eligibleMaps || [] };
    const online = await findOnlineServer(purchaseLike, this.servers, { logger: this.logger });
    if (!online) return { status: 'PENDING_RESOURCE', reason: 'Linked ARK player is offline.' };

    const locked = await this.store.lockPending(row.spin_id, 'PENDING_RESOURCE');
    if (!locked) return { status: 'SKIPPED' };
    const command = renderResourceCommand(delivery.commandTemplate, locked);
    try {
      const response = await online.connection.action('raw', { command });
      if (!responseConfirmsDelivery(response, delivery.successPattern)) {
        await this.store.setStatus(row.spin_id, 'REWARDING', 'DELIVERY_UNKNOWN', { mapName: online.server.name || online.server.id, response: String(response || '').slice(0, 4000) });
        return { status: 'DELIVERY_UNKNOWN' };
      }
      await this.store.setStatus(row.spin_id, 'REWARDING', 'REWARDED', { mapName: online.server.name || online.server.id, response: String(response || '').slice(0, 4000) });
      return { status: 'REWARDED', mode: 'resource', mapName: online.server.name || online.server.id };
    } catch (error) {
      await this.store.setStatus(row.spin_id, 'REWARDING', 'DELIVERY_UNKNOWN', { error: error.message });
      return { status: 'DELIVERY_UNKNOWN' };
    }
  }

  async tryClaimOne(row) {
    if (row.status === 'PENDING_RESOURCE') return this.deliverResource(row);

    if (row.status === 'PENDING_POINTS') {
      const locked = await this.store.lockPending(row.spin_id, 'PENDING_POINTS');
      if (!locked) return { status: 'SKIPPED' };
      try {
        const result = await creditPointsVerified(this.points, locked.eos_id, Number(locked.amount));
        await this.store.setStatus(row.spin_id, 'REWARDING', 'REWARDED', { payout: 'ARKSHOP_POINTS', afterBalance: result.afterBalance });
        return { status: 'REWARDED', mode: 'points' };
      } catch (error) {
        await this.store.setStatus(row.spin_id, 'REWARDING', 'PENDING_POINTS', { error: error.code || error.message });
        return { status: 'PENDING_POINTS' };
      }
    }

    if (row.status === 'PENDING_TOKEN') {
      const locked = await this.store.lockPending(row.spin_id, 'PENDING_TOKEN');
      if (!locked) return { status: 'SKIPPED' };
      const spin = {
        spinId: locked.spin_id,
        discordId: locked.discord_id,
        eosId: locked.eos_id,
        reward: { type: 'cache_token', id: locked.reward_key, label: locked.reward_label },
      };
      try {
        const token = await this.store.createCacheToken(spin);
        await this.store.setStatus(row.spin_id, 'REWARDING', 'REWARDED', { payout: 'CACHE_TOKEN', tokenId: token?.token_id || null });
        return { status: 'REWARDED', mode: 'cache_token' };
      } catch (error) {
        await this.store.setStatus(row.spin_id, 'REWARDING', 'PENDING_TOKEN', { error: error.message });
        return { status: 'PENDING_TOKEN' };
      }
    }

    return { status: row.status || 'SKIPPED' };
  }

  async claimPending(discordId) {
    await this.linkedAccount(discordId);
    const rows = await this.store.listPending(discordId, 20);
    const results = [];
    for (const row of rows) {
      results.push({ spinId: row.spin_id, rewardLabel: row.reward_label, ...(await this.tryClaimOne(row)) });
      await sleep(25);
    }
    return results;
  }
}

module.exports = { NexusSpinService, creditPointsVerified, renderResourceCommand };
