'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const RANK_CACHE_ENTITLEMENTS = Object.freeze({
  'shadow-recruit': Object.freeze({ daily: 0, weekly: 0 }),
  'cipher-runner': Object.freeze({ daily: 0, weekly: 1 }),
  'nexus-raider': Object.freeze({ daily: 0, weekly: 1, bonusRolls: 1 }),
  'khaos-warden': Object.freeze({ daily: 0, weekly: 2 }),
  'blackout-legend': Object.freeze({ daily: 1, weekly: 1 }),
  'origin-founder': Object.freeze({ daily: 0, weekly: 1, legacy: true })
});

const DEFAULT_VALUE_BUDGETS = Object.freeze({
  daily: 250,
  weekly: 900,
  founder: 900,
  event: 1200
});

const SUPPORTER_FORBIDDEN_TAGS = Object.freeze(new Set([
  'exclusive-power', 'best-in-slot', 'boss-ready', 'unobtainable-normal-play',
  'admin-item', 'broken-stat', 'instant-progression'
]));

const DEFAULT_POOLS = Object.freeze({
  daily: Object.freeze([
    Object.freeze({ id: 'nexus-points-small', type: 'currency', amount: 75, weight: 32, value: 75, tags: ['currency'] }),
    Object.freeze({ id: 'building-resources-small', type: 'kit', kit: 'nexus_daily_build', weight: 24, value: 120, tags: ['resource', 'convenience'] }),
    Object.freeze({ id: 'consumables-small', type: 'kit', kit: 'nexus_daily_consumables', weight: 20, value: 100, tags: ['consumable', 'convenience'] }),
    Object.freeze({ id: 'dyes-cosmetic', type: 'kit', kit: 'nexus_dyes', weight: 14, value: 60, tags: ['cosmetic'] }),
    Object.freeze({ id: 'event-token', type: 'currency', currency: 'event-token', amount: 1, weight: 10, value: 150, tags: ['event', 'currency'] })
  ]),
  weekly: Object.freeze([
    Object.freeze({ id: 'nexus-points-medium', type: 'currency', amount: 250, weight: 28, value: 250, tags: ['currency'] }),
    Object.freeze({ id: 'building-resources-medium', type: 'kit', kit: 'nexus_weekly_build', weight: 22, value: 375, tags: ['resource', 'convenience'] }),
    Object.freeze({ id: 'consumables-medium', type: 'kit', kit: 'nexus_weekly_consumables', weight: 18, value: 300, tags: ['consumable', 'convenience'] }),
    Object.freeze({ id: 'cosmetic-bundle', type: 'kit', kit: 'nexus_weekly_cosmetic', weight: 14, value: 200, tags: ['cosmetic'] }),
    Object.freeze({ id: 'event-tokens', type: 'currency', currency: 'event-token', amount: 3, weight: 10, value: 450, tags: ['event', 'currency'] }),
    Object.freeze({ id: 'utility-blueprint-roll', type: 'kit', kit: 'nexus_weekly_utility_bp', weight: 8, value: 700, tags: ['blueprint', 'utility', 'normal-play-obtainable'] })
  ]),
  founder: Object.freeze([
    Object.freeze({ id: 'founder-cosmetic', type: 'kit', kit: 'nexus_founder_cosmetic', weight: 45, value: 300, tags: ['cosmetic', 'legacy'] }),
    Object.freeze({ id: 'founder-points', type: 'currency', amount: 300, weight: 30, value: 300, tags: ['currency', 'legacy'] }),
    Object.freeze({ id: 'founder-event-tokens', type: 'currency', currency: 'event-token', amount: 3, weight: 25, value: 450, tags: ['event', 'currency', 'legacy'] })
  ]),
  event: Object.freeze([
    Object.freeze({ id: 'event-points', type: 'currency', amount: 300, weight: 30, value: 300, tags: ['currency', 'event'] }),
    Object.freeze({ id: 'event-resources', type: 'kit', kit: 'nexus_event_resources', weight: 24, value: 500, tags: ['resource', 'event'] }),
    Object.freeze({ id: 'event-consumables', type: 'kit', kit: 'nexus_event_consumables', weight: 20, value: 400, tags: ['consumable', 'event'] }),
    Object.freeze({ id: 'event-cosmetic', type: 'kit', kit: 'nexus_event_cosmetic', weight: 14, value: 250, tags: ['cosmetic', 'event'] }),
    Object.freeze({ id: 'event-tokens-bonus', type: 'currency', currency: 'event-token', amount: 4, weight: 8, value: 600, tags: ['currency', 'event'] }),
    Object.freeze({ id: 'event-utility-blueprint', type: 'kit', kit: 'nexus_event_utility_bp', weight: 4, value: 900, tags: ['blueprint', 'utility', 'event', 'normal-play-obtainable'] })
  ])
});

function randomFloat() {
  return crypto.randomInt(0, 1_000_000_000) / 1_000_000_000;
}

function normalizeRng(rng) {
  const fn = typeof rng === 'function' ? rng : randomFloat;
  return () => {
    const n = Number(fn());
    if (!Number.isFinite(n) || n < 0 || n >= 1) throw new Error('Reward RNG must produce a number in [0, 1).');
    return n;
  };
}

function rewardIsSupporterSafe(reward = {}) {
  const tags = new Set(Array.isArray(reward.tags) ? reward.tags.map((tag) => String(tag).toLowerCase()) : []);
  for (const tag of SUPPORTER_FORBIDDEN_TAGS) if (tags.has(tag)) return false;
  return reward.supporterSafe !== false;
}

function validatePool(pool, { supporter = false, valueBudget = Infinity } = {}) {
  if (!Array.isArray(pool) || !pool.length) throw new Error('Reward pool must contain at least one reward.');
  const budget = Number(valueBudget);
  for (const reward of pool) {
    if (!reward || typeof reward !== 'object') throw new Error('Reward pool contains an invalid entry.');
    if (!String(reward.id || '').trim()) throw new Error('Every reward needs an id.');
    if (!(Number(reward.weight) > 0)) throw new Error(`Reward ${reward.id} must have a positive weight.`);
    if (!(Number(reward.value) >= 0)) throw new Error(`Reward ${reward.id} must have a non-negative value.`);
    if (Number.isFinite(budget) && Number(reward.value) > budget) throw new Error(`Reward ${reward.id} exceeds cache value budget ${budget}.`);
    if (supporter && !rewardIsSupporterSafe(reward)) throw new Error(`Reward ${reward.id} violates supporter non-P2W policy.`);
  }
  return true;
}

function weightedPick(pool, rngInput) {
  const rng = normalizeRng(rngInput);
  const total = pool.reduce((sum, reward) => sum + Math.max(0, Number(reward.weight) || 0), 0);
  if (!(total > 0)) throw new Error('Reward pool has no positive weight.');
  let cursor = rng() * total;
  for (const reward of pool) {
    cursor -= Math.max(0, Number(reward.weight) || 0);
    if (cursor < 0) return reward;
  }
  return pool.at(-1);
}

function rollRewardCache(cacheType, options = {}) {
  const type = String(cacheType || '').toLowerCase();
  const pool = options.pool || DEFAULT_POOLS[type];
  if (!pool) throw new Error(`Unknown reward cache type: ${cacheType}.`);
  const supporter = options.supporter !== false;
  const valueBudget = Number.isFinite(Number(options.valueBudget))
    ? Number(options.valueBudget)
    : (DEFAULT_VALUE_BUDGETS[type] ?? Infinity);
  validatePool(pool, { supporter, valueBudget });
  const reward = weightedPick(pool, options.rng);
  return Object.freeze({
    cacheType: type,
    rewardId: reward.id,
    rewardType: reward.type,
    reward: Object.freeze({ ...reward, tags: Object.freeze([...(reward.tags || [])]) }),
    valueBudget,
    supporterSafe: !supporter || rewardIsSupporterSafe(reward),
    rolledAt: new Date().toISOString()
  });
}

function entitlementForRank(rankId) {
  return RANK_CACHE_ENTITLEMENTS[String(rankId || '').toLowerCase()] || Object.freeze({ daily: 0, weekly: 0 });
}

function cleanId(value, max = 96) {
  return String(value || '').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, max);
}

class RewardJournal {
  constructor(root = process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..', 'data')) {
    this.dir = path.resolve(root);
    this.file = path.join(this.dir, 'ark-reward-cache-journal.json');
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return { version: 1, claims: Array.isArray(parsed?.claims) ? parsed.claims.slice(-10000) : [] };
    } catch {
      return { version: 1, claims: [] };
    }
  }

  write(state) {
    fs.mkdirSync(this.dir, { recursive: true });
    const safe = { version: 1, updatedAt: new Date().toISOString(), claims: (state.claims || []).slice(-10000) };
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(safe, null, 2));
    fs.renameSync(tmp, this.file);
    return safe;
  }

  claimsSince(identityId, cacheType, sinceMs) {
    const id = cleanId(identityId);
    const type = cleanId(cacheType, 32);
    const cutoff = Number(sinceMs) || 0;
    return this.read().claims.filter((claim) => claim.identityId === id && claim.cacheType === type && Date.parse(claim.createdAt) >= cutoff);
  }

  canClaim(identityId, cacheType, allowance, periodMs, now = Date.now()) {
    const allowed = Math.max(0, Number(allowance) || 0);
    if (!allowed) return { ok: false, used: 0, remaining: 0, reason: 'no-entitlement' };
    const used = this.claimsSince(identityId, cacheType, now - periodMs).length;
    return { ok: used < allowed, used, remaining: Math.max(0, allowed - used), reason: used < allowed ? 'available' : 'allowance-used' };
  }

  record({ identityId, discordUserId = '', eosId = '', rankId = '', cacheType, roll, source = 'supporter' } = {}) {
    const claim = {
      id: crypto.randomUUID(),
      identityId: cleanId(identityId),
      discordUserId: cleanId(discordUserId),
      eosId: cleanId(eosId),
      rankId: cleanId(rankId, 48),
      cacheType: cleanId(cacheType, 32),
      source: cleanId(source, 32),
      roll,
      createdAt: new Date().toISOString()
    };
    if (!claim.identityId || !claim.cacheType || !roll) throw new Error('Reward claim requires identity id, cache type, and roll.');
    const state = this.read();
    state.claims.push(claim);
    this.write(state);
    return JSON.parse(JSON.stringify(claim));
  }
}

module.exports = {
  RANK_CACHE_ENTITLEMENTS,
  DEFAULT_VALUE_BUDGETS,
  SUPPORTER_FORBIDDEN_TAGS,
  DEFAULT_POOLS,
  rewardIsSupporterSafe,
  validatePool,
  weightedPick,
  rollRewardCache,
  entitlementForRank,
  RewardJournal
};
