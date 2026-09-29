'use strict';

function parseLinkRate(value) {
  const text = String(value == null || value === '' ? '5/600s' : value).trim();
  const match = /^(\d+)\s*\/\s*(\d+)\s*s?$/i.exec(text);
  if (!match) return { limit: 5, windowMs: 600_000 };
  const limit = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(seconds) || seconds < 1) {
    return { limit: 5, windowMs: 600_000 };
  }
  return { limit, windowMs: seconds * 1000 };
}

function cooldownMs(value, fallbackSeconds) {
  const seconds = Number(value == null || value === '' ? fallbackSeconds : value);
  if (!Number.isFinite(seconds) || seconds < 0) return fallbackSeconds * 1000;
  return seconds * 1000;
}

class CardRateLimits {
  constructor(options = {}) {
    const link = parseLinkRate(options.linkRate);
    this.linkLimit = options.linkLimit || link.limit;
    this.linkWindowMs = options.linkWindowMs || link.windowMs;
    this.perGameWindowMs = options.perGameWindowMs == null ? 60_000 : options.perGameWindowMs;
    this.dailyLimit = options.dailyLimit == null ? 20 : options.dailyLimit;
    this.dailyWindowMs = options.dailyWindowMs == null ? 86_400_000 : options.dailyWindowMs;
    this.viewCooldownMs = options.viewCooldownMs == null ? cooldownMs(options.viewCooldownS, 5) : options.viewCooldownMs;
    this.channelWindowMs = options.channelWindowMs == null ? 30_000 : options.channelWindowMs;
    this.hits = new Map();
  }

  #recent(key, windowMs, now) {
    const prev = (this.hits.get(key) || []).filter((at) => now - at < windowMs);
    this.hits.set(key, prev);
    return prev;
  }

  #peek(key, limit, windowMs, now) {
    if (windowMs <= 0 || limit < 1) return { ok: true, prev: this.#recent(key, windowMs, now) };
    const prev = this.#recent(key, windowMs, now);
    if (prev.length >= limit) {
      return { ok: false, retryAfterMs: Math.max(0, windowMs - (now - prev[0])), prev };
    }
    return { ok: true, prev };
  }

  #commit(key, prev, now) {
    prev.push(now);
    this.hits.set(key, prev);
  }

  takeLink(userId, gameId, now = Date.now()) {
    const checks = [
      ['rate-daily', `link:day:${userId}`, this.dailyLimit, this.dailyWindowMs],
      ['rate-burst', `link:burst:${userId}`, this.linkLimit, this.linkWindowMs],
      ['rate-game', `link:game:${userId}:${gameId}`, 1, this.perGameWindowMs]
    ];
    const peeked = checks.map(([reason, key, limit, windowMs]) => ({ reason, key, ...this.#peek(key, limit, windowMs, now) }));
    const blocked = peeked.find((item) => !item.ok);
    if (blocked) return { ok: false, reason: blocked.reason, retryAfterMs: blocked.retryAfterMs };
    for (const item of peeked) this.#commit(item.key, item.prev, now);
    return { ok: true };
  }

  takeView(viewerId, now = Date.now()) {
    const key = `view:${viewerId}`;
    const peeked = this.#peek(key, 1, this.viewCooldownMs, now);
    if (!peeked.ok) return { ok: false, reason: 'rate-view', retryAfterMs: peeked.retryAfterMs };
    this.#commit(key, peeked.prev, now);
    return { ok: true };
  }

  takePublicChannel(channelId, now = Date.now()) {
    const key = `channel:${channelId}`;
    const peeked = this.#peek(key, 1, this.channelWindowMs, now);
    if (!peeked.ok) return { ok: false, reason: 'rate-channel', retryAfterMs: peeked.retryAfterMs };
    this.#commit(key, peeked.prev, now);
    return { ok: true };
  }
}

function createRateLimiters(options = {}) {
  return new CardRateLimits(options);
}

const FIND_BURST_LIMIT = 10;
const FIND_BURST_WINDOW_MS = 10 * 60 * 1000;
const FIND_DAILY_LIMIT = 30;
const FIND_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const FIND_MISS_LIMIT = 5;
const FIND_MISS_COOLDOWN_MS = 15 * 60 * 1000;
const FIND_GUILD_LIMIT = 300;
const FIND_GUILD_WINDOW_MS = 60 * 60 * 1000;

class LookupRateLimits {
  constructor(options = {}) {
    this.burstLimit = options.burstLimit ?? FIND_BURST_LIMIT;
    this.burstWindowMs = options.burstWindowMs ?? FIND_BURST_WINDOW_MS;
    this.dailyLimit = options.dailyLimit ?? FIND_DAILY_LIMIT;
    this.dailyWindowMs = options.dailyWindowMs ?? FIND_DAILY_WINDOW_MS;
    this.missLimit = options.missLimit ?? FIND_MISS_LIMIT;
    this.missCooldownMs = options.missCooldownMs ?? FIND_MISS_COOLDOWN_MS;
    this.guildLimit = options.guildLimit ?? FIND_GUILD_LIMIT;
    this.guildWindowMs = options.guildWindowMs ?? FIND_GUILD_WINDOW_MS;
    this.hits = new Map();
    this.misses = new Map();
    this.guildAlerted = new Set();
  }

  #recent(key, windowMs, now) {
    const prev = (this.hits.get(key) || []).filter((at) => now - at < windowMs);
    this.hits.set(key, prev);
    return prev;
  }

  #peek(key, limit, windowMs, now) {
    const prev = this.#recent(key, windowMs, now);
    if (prev.length >= limit) {
      return { ok: false, retryAfterMs: Math.max(0, windowMs - (now - prev[0])), prev };
    }
    return { ok: true, prev };
  }

  #commit(key, prev, now) {
    prev.push(now);
    this.hits.set(key, prev);
  }

  take(userId, guildId, now = Date.now()) {
    const miss = this.misses.get(userId);
    if (miss?.until && now < miss.until) return { ok: false, reason: 'miss-cooldown' };
    if (miss?.until && now >= miss.until) this.misses.set(userId, { streak: 0, until: 0 });
    const burst = this.#peek(`find:burst:${userId}`, this.burstLimit, this.burstWindowMs, now);
    if (!burst.ok) return { ok: false, reason: 'rate-10m', retryAfterMs: burst.retryAfterMs };
    const daily = this.#peek(`find:day:${userId}`, this.dailyLimit, this.dailyWindowMs, now);
    if (!daily.ok) return { ok: false, reason: 'rate-24h', retryAfterMs: daily.retryAfterMs };
    const guildKey = `find:guild:${guildId}`;
    const guild = this.#peek(guildKey, this.guildLimit, this.guildWindowMs, now);
    if (!guild.ok) {
      const alert = !this.guildAlerted.has(String(guildId));
      this.guildAlerted.add(String(guildId));
      return { ok: false, reason: 'guild-breaker', alert, retryAfterMs: guild.retryAfterMs };
    }
    if (this.guildAlerted.has(String(guildId))) this.guildAlerted.delete(String(guildId));
    this.#commit(`find:burst:${userId}`, burst.prev, now);
    this.#commit(`find:day:${userId}`, daily.prev, now);
    this.#commit(guildKey, guild.prev, now);
    return { ok: true };
  }

  noteMiss(userId, now = Date.now()) {
    const prev = this.misses.get(userId) || { streak: 0, until: 0 };
    const streak = (prev.until && now < prev.until) ? prev.streak : prev.streak + 1;
    if (streak >= this.missLimit) {
      this.misses.set(userId, { streak: 0, until: now + this.missCooldownMs });
      return { cooled: true, streak: this.missLimit };
    }
    this.misses.set(userId, { streak, until: 0 });
    return { cooled: false, streak };
  }

  noteHit(userId) {
    this.misses.set(userId, { streak: 0, until: 0 });
  }
}

function createLookupLimits(options = {}) {
  return new LookupRateLimits(options);
}

module.exports = {
  parseLinkRate,
  CardRateLimits,
  createRateLimiters,
  LookupRateLimits,
  createLookupLimits,
  FIND_BURST_LIMIT,
  FIND_BURST_WINDOW_MS,
  FIND_DAILY_LIMIT,
  FIND_DAILY_WINDOW_MS,
  FIND_MISS_LIMIT,
  FIND_MISS_COOLDOWN_MS,
  FIND_GUILD_LIMIT,
  FIND_GUILD_WINDOW_MS
};
