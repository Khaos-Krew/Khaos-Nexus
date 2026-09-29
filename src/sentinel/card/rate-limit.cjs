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

module.exports = {
  parseLinkRate,
  CardRateLimits,
  createRateLimiters
};
