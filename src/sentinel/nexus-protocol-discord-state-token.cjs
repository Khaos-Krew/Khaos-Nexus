'use strict';

const crypto = require('node:crypto');

const DEFAULT_TTL_MS = 2 * 60 * 1000;
const MAX_TTL_MS = 15 * 60 * 1000;

function cleanId(value, label) {
  const result = String(value ?? '').trim();
  if (!/^[A-Za-z0-9:_-]{1,96}$/.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}

function cleanSecret(secret) {
  const value = Buffer.isBuffer(secret) ? secret : Buffer.from(String(secret || ''), 'utf8');
  if (value.length < 32) throw new Error('Nexus Protocol Discord state secret must be at least 32 bytes');
  return value;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decode(value) {
  try {
    return JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid Nexus Protocol Discord state token payload');
  }
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', cleanSecret(secret)).update(payload).digest('base64url');
}

function timingSafeTextEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createDiscordStateToken(input = {}, options = {}) {
  const now = Number(options.now ?? Date.now());
  const ttlMs = Number(options.ttlMs ?? DEFAULT_TTL_MS);
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('Invalid Discord state token timestamp');
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) throw new Error('Invalid Discord state token TTL');

  const revision = Number(input.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid Nexus Protocol store revision');

  const payload = {
    version: 1,
    action: cleanId(input.action, 'Protocol action'),
    accountId: cleanId(input.accountId, 'account id'),
    revision,
    darkZoneState: cleanId(input.darkZoneState, 'Dark Zone state'),
    enrollmentMode: cleanId(input.enrollmentMode || 'solo', 'Dark Zone enrollment mode'),
    issuedAt: now,
    expiresAt: now + ttlMs,
    nonce: crypto.randomBytes(12).toString('base64url')
  };
  const body = encode(payload);
  return `${body}.${sign(body, options.secret)}`;
}

function verifyDiscordStateToken(token, expected = {}, options = {}) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('Invalid Nexus Protocol Discord state token');
  const expectedSignature = sign(parts[0], options.secret);
  if (!timingSafeTextEqual(parts[1], expectedSignature)) throw new Error('Nexus Protocol Discord state token signature mismatch');

  const payload = decode(parts[0]);
  if (!payload || Number(payload.version) !== 1) throw new Error('Unsupported Nexus Protocol Discord state token version');
  cleanId(payload.action, 'Protocol action');
  cleanId(payload.accountId, 'account id');
  cleanId(payload.darkZoneState, 'Dark Zone state');
  cleanId(payload.enrollmentMode, 'Dark Zone enrollment mode');
  if (!Number.isSafeInteger(payload.revision) || payload.revision < 0
    || !Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt)
    || payload.expiresAt <= payload.issuedAt || payload.expiresAt - payload.issuedAt > MAX_TTL_MS) {
    throw new Error('Invalid Nexus Protocol Discord state token claims');
  }

  const now = Number(options.now ?? Date.now());
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('Invalid Discord state verification timestamp');
  if (now > payload.expiresAt) throw new Error('Nexus Protocol Discord state token expired');
  if (now < payload.issuedAt - 5_000) throw new Error('Nexus Protocol Discord state token issued in the future');

  if (expected.action !== undefined && payload.action !== cleanId(expected.action, 'expected Protocol action')) {
    throw new Error('Nexus Protocol Discord state action mismatch');
  }
  if (expected.accountId !== undefined && payload.accountId !== cleanId(expected.accountId, 'expected account id')) {
    throw new Error('Nexus Protocol Discord state account mismatch');
  }
  if (expected.revision !== undefined && payload.revision !== Number(expected.revision)) {
    throw new Error('Nexus Protocol Discord state revision mismatch');
  }
  if (expected.darkZoneState !== undefined && payload.darkZoneState !== cleanId(expected.darkZoneState, 'expected Dark Zone state')) {
    throw new Error('Nexus Protocol Discord state Dark Zone mismatch');
  }
  if (expected.enrollmentMode !== undefined && payload.enrollmentMode !== cleanId(expected.enrollmentMode, 'expected enrollment mode')) {
    throw new Error('Nexus Protocol Discord state enrollment mismatch');
  }

  return Object.freeze(payload);
}

module.exports = {
  DEFAULT_TTL_MS,
  MAX_TTL_MS,
  createDiscordStateToken,
  verifyDiscordStateToken
};
