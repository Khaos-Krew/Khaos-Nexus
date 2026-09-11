'use strict';

const crypto = require('node:crypto');

const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;

function cleanHeader(value, max = 512) {
  return String(Array.isArray(value) ? value[0] : value || '').trim().slice(0, max);
}

function readHeader(headers = {}, name) {
  const wanted = String(name || '').toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key).toLowerCase() === wanted) return cleanHeader(value);
  }
  return '';
}

function parseTimestamp(value) {
  const raw = cleanHeader(value, 32);
  if (!/^\d{10,13}$/.test(raw)) return 0;
  const numeric = Number(raw);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) return 0;
  return raw.length <= 10 ? numeric * 1000 : numeric;
}

function signatureDigest(secret, timestamp, rawBody) {
  return crypto.createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex');
}

function validSignature(actual, expected) {
  const supplied = cleanHeader(actual, 256).replace(/^sha256=/i, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(supplied)) return false;
  const suppliedBuffer = Buffer.from(supplied, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return suppliedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
}

function authenticateArkIdentityWebhook({ headers = {}, rawBody = Buffer.alloc(0), secret = '', now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  const key = String(secret || '');
  if (key.length < 32 || /\s/.test(key)) return { ok: false, status: 503, code: 'ARK_IDENTITY_WEBHOOK_DISABLED' };
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  if (body.length > MAX_BODY_BYTES) return { ok: false, status: 413, code: 'ARK_IDENTITY_WEBHOOK_TOO_LARGE' };
  const timestampHeader = readHeader(headers, 'x-nexus-timestamp');
  const timestamp = parseTimestamp(timestampHeader);
  if (!timestamp) return { ok: false, status: 401, code: 'ARK_IDENTITY_TIMESTAMP_INVALID' };
  const age = Math.abs(Number(now) - timestamp);
  if (!Number.isFinite(age) || age > Math.max(1_000, Number(maxAgeMs) || DEFAULT_MAX_AGE_MS)) {
    return { ok: false, status: 401, code: 'ARK_IDENTITY_TIMESTAMP_STALE' };
  }
  const expected = signatureDigest(key, timestampHeader, body);
  if (!validSignature(readHeader(headers, 'x-nexus-signature'), expected)) {
    return { ok: false, status: 401, code: 'ARK_IDENTITY_SIGNATURE_INVALID' };
  }
  return { ok: true, timestamp };
}

function parseIdentityPayload(rawBody) {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  if (!body.length) return { ok: false, status: 400, code: 'ARK_IDENTITY_BODY_REQUIRED' };
  let payload;
  try {
    payload = JSON.parse(body.toString('utf8'));
  } catch {
    return { ok: false, status: 400, code: 'ARK_IDENTITY_JSON_INVALID' };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, status: 400, code: 'ARK_IDENTITY_PAYLOAD_INVALID' };
  }
  return { ok: true, payload };
}

async function handleArkIdentityWebhook({ headers = {}, rawBody = Buffer.alloc(0), secret = '', consumeEvent, now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  const authenticated = authenticateArkIdentityWebhook({ headers, rawBody, secret, now, maxAgeMs });
  if (!authenticated.ok) return authenticated;
  if (typeof consumeEvent !== 'function') return { ok: false, status: 503, code: 'ARK_IDENTITY_CONSUMER_UNAVAILABLE' };
  const parsed = parseIdentityPayload(rawBody);
  if (!parsed.ok) return parsed;
  const result = await consumeEvent(parsed.payload);
  if (!result?.ok) {
    return { ok: false, status: 422, code: 'ARK_IDENTITY_EVENT_REJECTED', reason: String(result?.reason || 'rejected').slice(0, 120) };
  }
  return {
    ok: true,
    status: result.duplicate ? 200 : 202,
    duplicate: Boolean(result.duplicate),
    ignored: Boolean(result.ignored)
  };
}

module.exports = {
  DEFAULT_MAX_AGE_MS,
  MAX_BODY_BYTES,
  authenticateArkIdentityWebhook,
  handleArkIdentityWebhook,
  parseIdentityPayload,
  parseTimestamp,
  readHeader,
  signatureDigest,
  validSignature
};
