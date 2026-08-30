'use strict';

const { DEFAULT_POOLS, DEFAULT_PITY_POLICIES, entitlementForRank, rollRewardCacheWithPity, RewardJournal } = require('./ark-reward-engine.cjs');
const { addPlayerPoints } = require('./arkshop-rcon-points.cjs');

const DAY_MS = 24 * 60 * 60_000;
const WEEK_MS = 7 * DAY_MS;

function cleanEos(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) throw new Error('A verified EOS identity is required.');
  return id;
}

function definitiveDeliveryError(message) {
  const error = new Error(message);
  error.definitiveNoDelivery = true;
  return error;
}

function claimPolicy(profile = {}, requestedType = '') {
  const rankId = String(profile.rankId || 'shadow-recruit').toLowerCase();
  const entitlement = entitlementForRank(rankId);
  const type = String(requestedType || '').toLowerCase();
  if (!['daily', 'weekly'].includes(type)) throw new Error('Supporter cache type must be daily or weekly.');
  const allowance = Math.max(0, Number(entitlement[type]) || 0);
  return {
    rankId, entitlementType: type, cacheType: entitlement.legacy && type === 'weekly' ? 'founder' : type,
    allowance, periodMs: type === 'daily' ? DAY_MS : WEEK_MS,
    rollCount: 1 + (type === 'weekly' ? Math.max(0, Number(entitlement.bonusRolls) || 0) : 0)
  };
}

class RewardDeliveryAdapter {
  constructor({ rcon, journal, kitEnabled, kitCommandTemplate } = {}) {
    this.rcon = rcon;
    this.journal = journal;
    this.kitEnabled = kitEnabled ?? String(process.env.ARK_GEN1_REWARD_KIT_DELIVERY_ENABLED || 'false').toLowerCase() === 'true';
    this.kitCommandTemplate = String(kitCommandTemplate || process.env.ARK_GEN1_REWARD_KIT_COMMAND || '').trim();
  }

  supports(reward = {}) {
    if (reward.type === 'currency' && (!reward.currency || reward.currency === 'nexus-points')) return true;
    if (reward.type === 'currency' && reward.currency === 'event-token') return true;
    return reward.type === 'kit' && this.kitEnabled && this.kitCommandTemplate.includes('{eos}') && this.kitCommandTemplate.includes('{kit}');
  }

  async deliver({ identityId, eosId, reward } = {}) {
    let player;
    try { player = cleanEos(eosId); }
    catch (error) { throw definitiveDeliveryError(error.message); }
    if (!this.supports(reward)) throw definitiveDeliveryError(`Reward ${reward?.id || 'unknown'} has no verified delivery adapter.`);
    if (reward.type === 'currency' && reward.currency === 'event-token') {
      const balance = this.journal.addTokens(identityId, Number(reward.amount));
      return { type: 'event-token', amount: Number(reward.amount), balance };
    }
    if (reward.type === 'currency') {
      const result = await addPlayerPoints(this.rcon, player, Number(reward.amount));
      return { type: 'nexus-points', amount: Number(reward.amount), balance: result.points };
    }
    const command = this.kitCommandTemplate.replaceAll('{eos}', player).replaceAll('{kit}', String(reward.kit || ''));
    if (!/^[A-Za-z0-9_.:\-/= ]{10,280}$/.test(command)) throw definitiveDeliveryError('Configured reward kit command contains unsupported characters.');
    const response = String(await this.rcon.execute(command) || '').slice(0, 240);
    return { type: 'kit', kit: String(reward.kit), response };
  }
}

class ArkSupporterCacheService {
  constructor({ rcon, identityStore, journal, delivery, rng, now = Date.now } = {}) {
    if (!identityStore) throw new Error('Supporter cache service requires the Nexus identity store.');
    this.identityStore = identityStore;
    this.journal = journal || new RewardJournal();
    this.delivery = delivery || new RewardDeliveryAdapter({ rcon, journal: this.journal });
    this.rng = rng;
    this.now = now;
    this.locks = new Map();
  }

  async withLock(identityId, fn) {
    const prior = this.locks.get(identityId) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = prior.then(() => gate);
    this.locks.set(identityId, tail);
    await prior;
    try { return await fn(); }
    finally { release(); if (this.locks.get(identityId) === tail) this.locks.delete(identityId); }
  }

  status(discordUserId, requestedType) {
    const profile = this.identityStore.profileByDiscord(discordUserId);
    if (!profile) return { ok: false, reason: 'account-not-linked' };
    if (!profile.arkAccounts?.length) return { ok: false, reason: 'ark-account-not-linked' };
    if (profile.arkAccounts.length > 1) return { ok: false, reason: 'multiple-ark-accounts' };
    const policy = claimPolicy(profile, requestedType);
    const eligibility = this.journal.canClaim(profile.id, policy.entitlementType, policy.allowance, policy.periodMs, this.now());
    return { ok: true, profile, policy, eligibility, eventTokens: this.journal.tokenBalance(profile.id) };
  }

  async claim(discordUserId, requestedType) {
    const initial = this.status(discordUserId, requestedType);
    if (!initial.ok) return initial;
    return this.withLock(initial.profile.id, async () => {
      const current = this.status(discordUserId, requestedType);
      if (!current.eligibility.ok) return { ok: false, reason: current.eligibility.reason, ...current };
      const eosId = cleanEos(current.profile.arkAccounts?.[0]?.eosId);
      const sourcePool = DEFAULT_POOLS[current.policy.cacheType] || [];
      const pool = sourcePool.filter((reward) => this.delivery.supports(reward));
      if (!pool.length) return { ok: false, reason: 'no-verified-delivery-adapter' };
      const pityPolicy = DEFAULT_PITY_POLICIES[current.policy.cacheType];
      const dryStreak = this.journal.lowValueStreak(current.profile.id, current.policy.entitlementType, pityPolicy?.minimumValue || Infinity);
      const rolls = Array.from({ length: current.policy.rollCount }, () => rollRewardCacheWithPity(current.policy.cacheType, { pool, rng: this.rng, dryStreak, pityPolicy }));
      const claim = this.journal.reserve({ identityId: current.profile.id, discordUserId, eosId, rankId: current.policy.rankId, entitlementType: current.policy.entitlementType, cacheType: current.policy.cacheType, rolls });
      const deliveries = [];
      try {
        for (const roll of rolls) deliveries.push(await this.delivery.deliver({ identityId: current.profile.id, eosId, reward: roll.reward }));
        const delivered = this.journal.transition(claim.id, 'delivered', { deliveries });
        return { ok: true, claim: delivered, rolls, deliveries };
      } catch (error) {
        const next = !deliveries.length && error?.definitiveNoDelivery === true ? 'failed' : 'manual-review';
        this.journal.transition(claim.id, next, { deliveries, error: error?.message || error });
        return { ok: false, reason: next, claimId: claim.id, error: String(error?.message || error).slice(0, 240), deliveries };
      }
    });
  }
}

module.exports = { DAY_MS, WEEK_MS, cleanEos, definitiveDeliveryError, claimPolicy, RewardDeliveryAdapter, ArkSupporterCacheService };
