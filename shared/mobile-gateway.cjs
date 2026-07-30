'use strict';

const crypto = require('node:crypto');

const MOBILE_ROLES = Object.freeze(['viewer', 'operator', 'owner']);
const ROLE_RANK = Object.freeze({ viewer: 1, operator: 2, owner: 3 });
const MAX_DEVICES = 20;
const DEFAULT_PAIRING_TTL_MS = 5 * 60 * 1000;
const DEFAULT_PAIRING_REQUEST_TTL_MS = 5 * 60 * 1000;
const AUTH_TIMESTAMP_SKEW_MS = 2 * 60 * 1000;
const NONCE_TTL_MS = 5 * 60 * 1000;
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const DEVICE_PUBLIC_KEY_MAX_BYTES = 8192;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function cleanText(value, maxLength, fallback = '') {
  const text = String(value ?? '').replace(/\u0000/g, '').trim();
  return (text || fallback).slice(0, maxLength);
}
function normalizeRole(value, fallback = 'viewer') {
  const role = String(value || '').toLowerCase();
  return MOBILE_ROLES.includes(role) ? role : fallback;
}
function normalizePort(value, fallback = 43120) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : fallback;
}
function normalizeFingerprint(value) {
  const hex = cleanText(value, 200).replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  return hex.match(/.{1,2}/g)?.join(':') || '';
}
function encodeFingerprint(buffer) { return Buffer.from(buffer).toString('hex').toUpperCase().match(/.{1,2}/g).join(':'); }

function publicKeyDetails(publicKeyPem) {
  const pem = cleanText(publicKeyPem, DEVICE_PUBLIC_KEY_MAX_BYTES);
  if (!pem) throw new Error('The Android device public key is required.');
  let key;
  try { key = crypto.createPublicKey(pem); } catch { throw new Error('The Android device public key is invalid.'); }
  if (key.asymmetricKeyType !== 'ec') throw new Error('Android pairing requires an EC public key.');
  const curve = String(key.asymmetricKeyDetails?.namedCurve || '').toLowerCase();
  if (curve && !['prime256v1', 'secp256r1', 'p-256'].includes(curve)) throw new Error('Android pairing requires a P-256 public key.');
  const normalizedPem = key.export({ type: 'spki', format: 'pem' }).toString();
  const der = key.export({ type: 'spki', format: 'der' });
  return { publicKeyPem: normalizedPem, publicKeyFingerprint: encodeFingerprint(crypto.createHash('sha256').update(der).digest()), keyAlgorithm: 'EC-P256' };
}

function normalizeDevice(input = {}) {
  const createdAt = input.createdAt ? String(input.createdAt) : new Date().toISOString();
  const key = input.publicKeyPem ? publicKeyDetails(input.publicKeyPem) : {
    publicKeyPem: '', publicKeyFingerprint: normalizeFingerprint(input.publicKeyFingerprint),
    keyAlgorithm: cleanText(input.keyAlgorithm, 40, input.publicKeyFingerprint ? 'legacy-fingerprint' : '')
  };
  return {
    id: /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(String(input.id || '')) ? String(input.id) : `device-${crypto.randomUUID()}`,
    name: cleanText(input.name, 80, 'Android device'), role: normalizeRole(input.role),
    publicKeyPem: key.publicKeyPem, publicKeyFingerprint: key.publicKeyFingerprint, keyAlgorithm: key.keyAlgorithm,
    credentialSalt: cleanText(input.credentialSalt, 128), credentialHash: cleanText(input.credentialHash, 256), createdAt,
    lastSeenAt: input.lastSeenAt ? String(input.lastSeenAt) : null, lastAddress: cleanText(input.lastAddress, 120),
    revokedAt: input.revokedAt ? String(input.revokedAt) : null, enabled: input.enabled !== false && !input.revokedAt
  };
}
function publicDevice(device = {}) {
  const normalized = normalizeDevice(device);
  const { credentialSalt, credentialHash, lastAddress, publicKeyPem, ...safe } = normalized;
  return safe;
}
function defaultMobileGatewayConfig() {
  return { schemaVersion: 2, enabled: false, port: 43120, transport: 'https', remoteAccessMode: 'disabled', allowLanPairing: false, requireBiometricForOwnerActions: true, devices: [] };
}
function normalizeMobileGatewayConfig(input = {}) {
  const defaults = defaultMobileGatewayConfig();
  const devices = []; const ids = new Set();
  for (const source of Array.isArray(input.devices) ? input.devices : []) {
    try {
      const device = normalizeDevice(source);
      if (ids.has(device.id)) continue;
      ids.add(device.id); devices.push(device);
      if (devices.length >= MAX_DEVICES) break;
    } catch {}
  }
  return {
    schemaVersion: 2, enabled: Boolean(input.enabled), port: normalizePort(input.port, defaults.port), transport: 'https',
    remoteAccessMode: ['disabled', 'private-network'].includes(input.remoteAccessMode) ? input.remoteAccessMode : defaults.remoteAccessMode,
    allowLanPairing: Boolean(input.allowLanPairing), requireBiometricForOwnerActions: input.requireBiometricForOwnerActions !== false, devices
  };
}

function createPairingSession(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const ttlMs = Math.min(15 * 60 * 1000, Math.max(60 * 1000, Number(options.ttlMs) || DEFAULT_PAIRING_TTL_MS));
  return {
    id: `pair-${crypto.randomUUID()}`, code: String(crypto.randomInt(0, 1000000)).padStart(6, '0'),
    requestedRole: normalizeRole(options.requestedRole), createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    usedAt: null, pendingRequestId: null, nonce: crypto.randomBytes(24).toString('base64url')
  };
}
function pairingSessionActive(session, now = new Date()) {
  if (!session || session.usedAt || session.pendingRequestId) return false;
  return new Date(session.expiresAt).getTime() > new Date(now).getTime();
}
function publicPairingSession(session, options = {}) {
  if (!session) return null;
  return {
    id: session.id, code: options.includeCode === false ? undefined : session.code, requestedRole: session.requestedRole,
    createdAt: session.createdAt, expiresAt: session.expiresAt, usedAt: session.usedAt || null,
    pendingRequestId: session.pendingRequestId || null,
    status: session.usedAt ? 'claimed' : pairingSessionActive(session, options.now || new Date()) ? 'waiting' : 'expired'
  };
}
function verifyPairingCode(session, code, now = new Date()) {
  if (!pairingSessionActive(session, now)) return false;
  const expected = Buffer.from(String(session.code || ''), 'utf8');
  const provided = Buffer.from(String(code || ''), 'utf8');
  return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}
function consumePairingSession(session, requestId = null, now = new Date()) {
  if (requestId instanceof Date || typeof requestId === 'number') { now = requestId; requestId = null; }
  if (!pairingSessionActive(session, now)) throw new Error('The mobile pairing session expired or was already used.');
  return { ...session, usedAt: new Date(now).toISOString(), pendingRequestId: requestId || session.pendingRequestId || null };
}
function hashSecret(value, salt) { return crypto.scryptSync(String(value || ''), String(salt || ''), 32).toString('hex'); }
function hashCredential(credential, salt) { return hashSecret(credential, salt); }
function issueDeviceCredential(input = {}, now = new Date()) {
  const credential = crypto.randomBytes(32).toString('base64url');
  const salt = crypto.randomBytes(16).toString('hex');
  const device = normalizeDevice({
    id: input.id, name: input.name, role: input.role, publicKeyPem: input.publicKeyPem, publicKeyFingerprint: input.publicKeyFingerprint,
    credentialSalt: salt, credentialHash: hashCredential(credential, salt), createdAt: new Date(now).toISOString(), enabled: true
  });
  return { credential, device, publicDevice: publicDevice(device) };
}
function verifyDeviceCredential(device, credential) {
  const normalized = normalizeDevice(device);
  if (!normalized.enabled || normalized.revokedAt || !normalized.credentialHash || !normalized.credentialSalt) return false;
  try {
    const actual = Buffer.from(hashCredential(credential, normalized.credentialSalt), 'hex');
    const expected = Buffer.from(normalized.credentialHash, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}
function createPairingRequest(session, input = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (!verifyPairingCode(session, input.code, now)) throw new Error('The pairing code is invalid, expired, or already used.');
  const key = publicKeyDetails(input.publicKeyPem);
  const ttlMs = Math.min(10 * 60 * 1000, Math.max(60 * 1000, Number(options.ttlMs) || DEFAULT_PAIRING_REQUEST_TTL_MS));
  const claimSecret = crypto.randomBytes(32).toString('base64url');
  const claimSalt = crypto.randomBytes(16).toString('hex');
  const request = {
    id: `mobile-request-${crypto.randomUUID()}`, sessionId: session.id, name: cleanText(input.name, 80, 'Android device'),
    requestedRole: normalizeRole(session.requestedRole), publicKeyPem: key.publicKeyPem, publicKeyFingerprint: key.publicKeyFingerprint,
    keyAlgorithm: key.keyAlgorithm, claimSalt, claimHash: hashSecret(claimSecret, claimSalt), createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(), address: cleanText(options.address, 120), status: 'pending',
    decidedAt: null, deliveredAt: null, rejectionReason: ''
  };
  return { request, claimSecret, consumedSession: consumePairingSession(session, request.id, now) };
}
function publicPairingRequest(input) {
  if (!input) return null;
  return {
    id: input.id, sessionId: input.sessionId, name: input.name, requestedRole: input.requestedRole,
    publicKeyFingerprint: input.publicKeyFingerprint, keyAlgorithm: input.keyAlgorithm, createdAt: input.createdAt,
    expiresAt: input.expiresAt, status: input.status, decidedAt: input.decidedAt || null, deliveredAt: input.deliveredAt || null,
    rejectionReason: cleanText(input.rejectionReason, 200)
  };
}
function verifyClaimSecret(request, secret) {
  if (!request?.claimHash || !request?.claimSalt) return false;
  try {
    const actual = Buffer.from(hashSecret(secret, request.claimSalt), 'hex');
    const expected = Buffer.from(request.claimHash, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}
function pairingRequestActive(request, now = new Date()) {
  if (!request || request.deliveredAt || ['rejected', 'expired'].includes(request.status)) return false;
  return new Date(request.expiresAt).getTime() > new Date(now).getTime();
}
function revokeDevice(device, now = new Date()) {
  const normalized = normalizeDevice(device); const revokedAt = new Date(now).toISOString();
  return { ...normalized, enabled: false, revokedAt };
}
function mobileRoleAllows(role, requiredRole) { return (ROLE_RANK[normalizeRole(role)] || 0) >= (ROLE_RANK[normalizeRole(requiredRole)] || 0); }
function bodyDigest(body = '') { return crypto.createHash('sha256').update(Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8')).digest('hex'); }
function canonicalMobileRequest(input = {}) {
  const method = cleanText(input.method, 12).toUpperCase(); const path = cleanText(input.path, 2048);
  const timestamp = String(input.timestamp || ''); const nonce = cleanText(input.nonce, 160);
  if (!/^[A-Z]+$/.test(method)) throw new Error('The signed request method is invalid.');
  if (!path.startsWith('/v1/')) throw new Error('The signed request path is invalid.');
  if (!/^\d{10,16}$/.test(timestamp)) throw new Error('The signed request timestamp is invalid.');
  if (nonce.length < 16 || !BASE64URL_PATTERN.test(nonce)) throw new Error('The signed request nonce is invalid.');
  return `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyDigest(input.body)}`;
}
function verifyMobileRequestSignature(device, input = {}, now = Date.now()) {
  const normalized = normalizeDevice(device);
  if (!normalized.enabled || normalized.revokedAt) return { ok: false, code: 'DEVICE_REVOKED' };
  if (!normalized.publicKeyPem) return { ok: false, code: 'DEVICE_KEY_MISSING' };
  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(Number(now) - timestamp) > AUTH_TIMESTAMP_SKEW_MS) return { ok: false, code: 'TIMESTAMP_INVALID' };
  let signature;
  try { signature = Buffer.from(String(input.signature || ''), 'base64url'); } catch { return { ok: false, code: 'SIGNATURE_INVALID' }; }
  if (!signature.length) return { ok: false, code: 'SIGNATURE_INVALID' };
  try {
    const canonical = canonicalMobileRequest(input);
    const ok = crypto.verify('sha256', Buffer.from(canonical, 'utf8'), normalized.publicKeyPem, signature);
    return { ok, code: ok ? null : 'SIGNATURE_INVALID', canonical };
  } catch { return { ok: false, code: 'SIGNATURE_INVALID' }; }
}
function publicMobileGatewayState(config, pairingSession = null, runtime = {}) {
  const normalized = normalizeMobileGatewayConfig(config);
  return {
    ...clone(normalized), devices: normalized.devices.map(publicDevice), pairingSession: publicPairingSession(pairingSession),
    pendingPairing: publicPairingRequest(runtime.pendingPairing), transportReady: Boolean(runtime.transportReady),
    transportStatus: cleanText(runtime.transportStatus, 40, runtime.transportReady ? 'online' : normalized.enabled ? 'starting' : 'disabled'),
    certificateFingerprint: normalizeFingerprint(runtime.certificateFingerprint), certificateExpiresAt: runtime.certificateExpiresAt ? String(runtime.certificateExpiresAt) : null,
    endpoints: Array.isArray(runtime.endpoints) ? runtime.endpoints.map((value) => cleanText(value, 300)).filter(Boolean).slice(0, 20) : [],
    activeSessions: Math.max(0, Number(runtime.activeSessions) || 0), lastStartedAt: runtime.lastStartedAt ? String(runtime.lastStartedAt) : null,
    lastError: cleanText(runtime.lastError, 500), qrDataUrl: cleanText(runtime.qrDataUrl, 200000), pairingUri: cleanText(runtime.pairingUri, 4000),
    securityBoundary: 'Desktop-only secrets; HTTPS, certificate pinning, one-time pairing, hashed credentials, signed requests, nonce replay protection, and role checks are enforced by the desktop.'
  };
}

module.exports = {
  MOBILE_ROLES, ROLE_RANK, MAX_DEVICES, DEFAULT_PAIRING_TTL_MS, DEFAULT_PAIRING_REQUEST_TTL_MS,
  AUTH_TIMESTAMP_SKEW_MS, NONCE_TTL_MS, MAX_REQUEST_BODY_BYTES, normalizeRole, normalizePort, normalizeFingerprint,
  publicKeyDetails, normalizeDevice, publicDevice, defaultMobileGatewayConfig, normalizeMobileGatewayConfig,
  createPairingSession, publicPairingSession, pairingSessionActive, verifyPairingCode, consumePairingSession,
  hashCredential, issueDeviceCredential, verifyDeviceCredential, createPairingRequest, publicPairingRequest,
  verifyClaimSecret, pairingRequestActive, revokeDevice, mobileRoleAllows, bodyDigest, canonicalMobileRequest,
  verifyMobileRequestSignature, publicMobileGatewayState
};
