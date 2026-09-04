'use strict';

const DEFAULT_DINO_LIFETIME_MAX_MS = 8 * 60 * 60 * 1000;
const DEFAULT_EXPIRY_GRACE_MS = 5 * 60 * 1000;

function parseDurationMs(value, fallbackMs = 0) {
  if (value === null || value === undefined || value === '') return fallbackMs;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  const raw = String(value).trim().toLowerCase();
  if (!raw) return fallbackMs;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Math.max(0, Number(raw));
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/);
  if (!match) return fallbackMs;
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === 'ms' ? 1
    : unit === 's' ? 1000
      : unit === 'm' ? 60 * 1000
        : unit === 'h' ? 60 * 60 * 1000
          : 24 * 60 * 60 * 1000;
  return Math.max(0, amount * multiplier);
}

function resolveLifecyclePolicy(env = process.env) {
  const maxLifetimeMs = parseDurationMs(
    env.ARN_SHINY_DINO_LIFETIME_MAX,
    DEFAULT_DINO_LIFETIME_MAX_MS
  );
  const graceMs = parseDurationMs(
    env.ARN_SHINY_EXPIRY_GRACE,
    DEFAULT_EXPIRY_GRACE_MS
  );
  return {
    maxLifetimeMs,
    graceMs,
    hardExpiryMs: maxLifetimeMs > 0 ? maxLifetimeMs + graceMs : 0
  };
}

function pruneStaleActive(anomalies, now = Date.now(), policy = resolveLifecyclePolicy()) {
  if (!(anomalies instanceof Map) || !policy?.hardExpiryMs) return [];
  const removed = [];
  for (const [key, item] of anomalies) {
    if (!item || item.status !== 'ACTIVE') continue;
    const detectedAt = Number(item.detectedAt || item.createdAt || item.updatedAt || 0);
    if (!detectedAt || now - detectedAt < policy.hardExpiryMs) continue;
    anomalies.delete(key);
    removed.push({
      key,
      dinoName: item.dinoName || '',
      mapName: item.mapName || '',
      detectedAt,
      expiredAt: now,
      reason: 'lifecycle-max-exceeded'
    });
  }
  return removed;
}

module.exports = {
  DEFAULT_DINO_LIFETIME_MAX_MS,
  DEFAULT_EXPIRY_GRACE_MS,
  parseDurationMs,
  resolveLifecyclePolicy,
  pruneStaleActive
};
