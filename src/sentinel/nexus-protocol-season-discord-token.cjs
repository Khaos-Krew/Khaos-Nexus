'use strict';

const crypto = require('node:crypto');

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_TTL_MS = 30 * 60 * 1000;

function cleanSecret(secret) {
  const value = Buffer.isBuffer(secret) ? secret : Buffer.from(String(secret || ''), 'utf8');
  if (value.length < 32) throw new Error('Protocol season Discord token secret must be at least 32 bytes');
  return value;
}

function cleanId(value, label, max = 120) {
  const result = String(value ?? '').trim();
  if (!result || result.length > max || !/^[A-Za-z0-9:_ -]+$/.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function encode(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decode(value) {
  try { return JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8')); }
  catch { throw new Error('Invalid Protocol season Discord token payload'); }
}

function signature(body, secret) {
  return crypto.createHmac('sha256', cleanSecret(secret)).update(body).digest('base64url');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function snapshotDigest(model) {
  if (!model || model.readOnly !== true || model.mutatesPersistence !== false || model.executesRewards !== false) {
    throw new Error('Invalid Protocol season read model for Discord token');
  }
  const leaderboard = Array.isArray(model.leaderboard)
    ? model.leaderboard.map((row) => ({ rank: Number(row.rank), accountId: String(row.accountId), score: Number(row.score), runs: Number(row.runs ?? 0) }))
    : [];
  return digest({
    version: Number(model.version), seasonId: model.seasonId, status: model.status,
    storeRevision: Number(model.storeRevision), checkpointCount: Number(model.checkpointCount),
    eventCount: Number(model.eventCount), participantCount: Number(model.participantCount),
    scoreFinalized: model.scoreFinalized === true, leaderboard
  });
}

function createProtocolSeasonDiscordToken(model, options = {}) {
  const now = Number(options.now ?? Date.now());
  const ttlMs = Number(options.ttlMs ?? DEFAULT_TTL_MS);
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('Invalid Protocol season Discord token timestamp');
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) throw new Error('Invalid Protocol season Discord token TTL');
  if (!Number.isSafeInteger(Number(model.storeRevision)) || Number(model.storeRevision) < 0) throw new Error('Invalid Protocol season store revision');

  const payload = {
    version: 1,
    seasonId: cleanId(model.seasonId, 'Protocol season id', 96),
    status: cleanId(model.status, 'Protocol season status', 32),
    storeRevision: Number(model.storeRevision),
    snapshotDigest: snapshotDigest(model),
    issuedAt: now,
    expiresAt: now + ttlMs,
    nonce: crypto.randomBytes(12).toString('base64url'),
    readOnly: true,
    authorizesMutation: false,
    executesRewards: false
  };
  const body = encode(payload);
  return `${body}.${signature(body, options.secret)}`;
}

function verifyProtocolSeasonDiscordToken(token, model, options = {}) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('Invalid Protocol season Discord token');
  if (!safeEqual(parts[1], signature(parts[0], options.secret))) throw new Error('Protocol season Discord token signature mismatch');
  const payload = decode(parts[0]);
  if (!payload || Number(payload.version) !== 1 || payload.readOnly !== true
    || payload.authorizesMutation !== false || payload.executesRewards !== false) {
    throw new Error('Invalid Protocol season Discord token claims');
  }
  cleanId(payload.seasonId, 'Protocol season id', 96);
  cleanId(payload.status, 'Protocol season status', 32);
  if (!Number.isSafeInteger(payload.storeRevision) || payload.storeRevision < 0
    || !Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt)
    || payload.expiresAt <= payload.issuedAt || payload.expiresAt - payload.issuedAt > MAX_TTL_MS
    || !/^[a-f0-9]{64}$/.test(String(payload.snapshotDigest || ''))) {
    throw new Error('Invalid Protocol season Discord token claims');
  }
  const now = Number(options.now ?? Date.now());
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('Invalid Protocol season Discord verification timestamp');
  if (now > payload.expiresAt) throw new Error('Protocol season Discord token expired');
  if (now < payload.issuedAt - 5_000) throw new Error('Protocol season Discord token issued in the future');

  if (payload.seasonId !== String(model.seasonId) || payload.status !== String(model.status)
    || payload.storeRevision !== Number(model.storeRevision) || payload.snapshotDigest !== snapshotDigest(model)) {
    throw new Error('Protocol season Discord token is stale for current season snapshot');
  }
  return Object.freeze(payload);
}

module.exports = {
  DEFAULT_TTL_MS,
  MAX_TTL_MS,
  createProtocolSeasonDiscordToken,
  verifyProtocolSeasonDiscordToken,
  snapshotDigest
};
