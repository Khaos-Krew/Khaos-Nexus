'use strict';

const crypto = require('node:crypto');
const { verifyParticipantProgressSnapshot } = require('./nexus-protocol-participant-snapshot.cjs');

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_TTL_MS = 30 * 60 * 1000;

function cleanSecret(secret) {
  const value = Buffer.isBuffer(secret) ? secret : Buffer.from(String(secret || ''), 'utf8');
  if (value.length < 32) throw new Error('Protocol participant Discord token secret must be at least 32 bytes');
  return value;
}

function cleanId(value, label, max = 96) {
  const result = String(value ?? '').trim();
  if (!result || result.length > max || !/^[A-Za-z0-9:_-]+$/.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decode(value) {
  try { return JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8')); }
  catch { throw new Error('Invalid Protocol participant Discord token payload'); }
}

function signature(body, secret) {
  return crypto.createHmac('sha256', cleanSecret(secret)).update(body).digest('base64url');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createProtocolParticipantDiscordToken(snapshot, options = {}) {
  if (!verifyParticipantProgressSnapshot(snapshot)) throw new Error('Invalid Protocol participant progress snapshot');
  const viewerAccountId = cleanId(options.viewerAccountId, 'Protocol participant viewer account id');
  const accountId = cleanId(snapshot.accountId, 'Protocol participant account id');
  if (viewerAccountId !== accountId) throw new Error('Protocol participant view may only be bound to its owning account');
  const now = Number(options.now ?? Date.now());
  const ttlMs = Number(options.ttlMs ?? DEFAULT_TTL_MS);
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('Invalid Protocol participant Discord token timestamp');
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) throw new Error('Invalid Protocol participant Discord token TTL');

  const payload = {
    version: 1,
    purpose: 'participant_progress_view',
    viewerAccountId,
    accountId,
    runId: cleanId(snapshot.runId, 'Protocol run id'),
    ledgerRevision: Number(snapshot.ledgerRevision),
    snapshotDigest: String(snapshot.digest).toLowerCase(),
    issuedAt: now,
    expiresAt: now + ttlMs,
    nonce: crypto.randomBytes(12).toString('base64url'),
    readOnly: true,
    authorizesMutation: false,
    rewardAuthority: false,
    mutatesPersistence: false
  };
  const body = encode(payload);
  return `${body}.${signature(body, options.secret)}`;
}

function verifyProtocolParticipantDiscordToken(token, snapshot, options = {}) {
  if (!verifyParticipantProgressSnapshot(snapshot)) throw new Error('Invalid Protocol participant progress snapshot');
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('Invalid Protocol participant Discord token');
  if (!safeEqual(parts[1], signature(parts[0], options.secret))) throw new Error('Protocol participant Discord token signature mismatch');
  const payload = decode(parts[0]);
  if (!payload || Number(payload.version) !== 1 || payload.purpose !== 'participant_progress_view'
    || payload.readOnly !== true || payload.authorizesMutation !== false || payload.rewardAuthority !== false
    || payload.mutatesPersistence !== false) {
    throw new Error('Invalid Protocol participant Discord token claims');
  }

  const viewerAccountId = cleanId(options.viewerAccountId, 'Protocol participant viewer account id');
  cleanId(payload.viewerAccountId, 'Protocol participant token viewer account id');
  cleanId(payload.accountId, 'Protocol participant token account id');
  cleanId(payload.runId, 'Protocol participant token run id');
  if (!Number.isSafeInteger(payload.ledgerRevision) || payload.ledgerRevision < 0
    || !Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt)
    || payload.expiresAt <= payload.issuedAt || payload.expiresAt - payload.issuedAt > MAX_TTL_MS
    || !/^[a-f0-9]{64}$/.test(String(payload.snapshotDigest || ''))) {
    throw new Error('Invalid Protocol participant Discord token claims');
  }

  const now = Number(options.now ?? Date.now());
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('Invalid Protocol participant Discord verification timestamp');
  if (now > payload.expiresAt) throw new Error('Protocol participant Discord token expired');
  if (now < payload.issuedAt - 5_000) throw new Error('Protocol participant Discord token issued in the future');
  if (payload.viewerAccountId !== viewerAccountId || payload.accountId !== viewerAccountId) {
    throw new Error('Protocol participant Discord token belongs to another account');
  }
  if (payload.accountId !== String(snapshot.accountId) || payload.runId !== String(snapshot.runId)
    || payload.ledgerRevision !== Number(snapshot.ledgerRevision) || payload.snapshotDigest !== String(snapshot.digest).toLowerCase()) {
    throw new Error('Protocol participant Discord token is stale for current progress snapshot');
  }
  return Object.freeze(payload);
}

module.exports = {
  DEFAULT_TTL_MS,
  MAX_TTL_MS,
  createProtocolParticipantDiscordToken,
  verifyProtocolParticipantDiscordToken
};
