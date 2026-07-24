'use strict';

const crypto = require('node:crypto');

const MOBILE_ROLES = Object.freeze(['viewer', 'operator', 'owner']);
const ROLE_RANK = Object.freeze({ viewer: 1, operator: 2, owner: 3 });
const MAX_DEVICES = 20;
const DEFAULT_PAIRING_TTL_MS = 5 * 60 * 1000;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

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
  return cleanText(value, 200).replace(/[^a-fA-F0-9:]/g, '').toUpperCase();
}

function normalizeDevice(input = {}) {
  const createdAt = input.createdAt ? String(input.createdAt) : new Date().toISOString();
  return {
    id: /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(String(input.id || '')) ? String(input.id) : `device-${crypto.randomUUID()}`,
    name: cleanText(input.name, 80, 'Android device'),
    role: normalizeRole(input.role),
    publicKeyFingerprint: normalizeFingerprint(input.publicKeyFingerprint),
    credentialSalt: cleanText(input.credentialSalt, 128),
    credentialHash: cleanText(input.credentialHash, 256),
    createdAt,
    lastSeenAt: input.lastSeenAt ? String(input.lastSeenAt) : null,
    lastAddress: cleanText(input.lastAddress, 120),
    revokedAt: input.revokedAt ? String(input.revokedAt) : null,
    enabled: input.enabled !== false && !input.revokedAt
  };
}

function publicDevice(device = {}) {
  const normalized = normalizeDevice(device);
  const { credentialSalt, credentialHash, lastAddress, ...safe } = normalized;
  return safe;
}

function defaultMobileGatewayConfig() {
  return {
    schemaVersion: 1,
    enabled: false,
    port: 43120,
    transport: 'https-required',
    remoteAccessMode: 'disabled',
    allowLanPairing: false,
    requireBiometricForOwnerActions: true,
    devices: []
  };
}

function normalizeMobileGatewayConfig(input = {}) {
  const defaults = defaultMobileGatewayConfig();
  const devices = [];
  const ids = new Set();
  for (const source of Array.isArray(input.devices) ? input.devices : []) {
    const device = normalizeDevice(source);
    if (ids.has(device.id)) continue;
    ids.add(device.id);
    devices.push(device);
    if (devices.length >= MAX_DEVICES) break;
  }
  return {
    schemaVersion: 1,
    enabled: Boolean(input.enabled),
    port: normalizePort(input.port, defaults.port),
    transport: 'https-required',
    remoteAccessMode: ['disabled', 'private-network', 'relay'].includes(input.remoteAccessMode) ? input.remoteAccessMode : defaults.remoteAccessMode,
    allowLanPairing: Boolean(input.allowLanPairing),
    requireBiometricForOwnerActions: input.requireBiometricForOwnerActions !== false,
    devices
  };
}

function createPairingSession(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const ttlMs = Math.min(15 * 60 * 1000, Math.max(60 * 1000, Number(options.ttlMs) || DEFAULT_PAIRING_TTL_MS));
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  return {
    id: `pair-${crypto.randomUUID()}`,
    code,
    requestedRole: normalizeRole(options.requestedRole),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    usedAt: null,
    nonce: crypto.randomBytes(24).toString('base64url')
  };
}

function publicPairingSession(session) {
  if (!session) return null;
  return {
    id: session.id,
    code: session.code,
    requestedRole: session.requestedRole,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    usedAt: session.usedAt || null
  };
}

function pairingSessionActive(session, now = new Date()) {
  if (!session || session.usedAt) return false;
  return new Date(session.expiresAt).getTime() > new Date(now).getTime();
}

function verifyPairingCode(session, code, now = new Date()) {
  if (!pairingSessionActive(session, now)) return false;
  const expected = Buffer.from(String(session.code || ''), 'utf8');
  const provided = Buffer.from(String(code || ''), 'utf8');
  return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}

function consumePairingSession(session, now = new Date()) {
  if (!pairingSessionActive(session, now)) throw new Error('The mobile pairing session expired or was already used.');
  return { ...session, usedAt: new Date(now).toISOString() };
}

function hashCredential(credential, salt) {
  return crypto.scryptSync(String(credential || ''), String(salt || ''), 32).toString('hex');
}

function issueDeviceCredential(input = {}, now = new Date()) {
  const credential = crypto.randomBytes(32).toString('base64url');
  const salt = crypto.randomBytes(16).toString('hex');
  const device = normalizeDevice({
    id: input.id,
    name: input.name,
    role: input.role,
    publicKeyFingerprint: input.publicKeyFingerprint,
    credentialSalt: salt,
    credentialHash: hashCredential(credential, salt),
    createdAt: new Date(now).toISOString(),
    enabled: true
  });
  return { credential, device, publicDevice: publicDevice(device) };
}

function verifyDeviceCredential(device, credential) {
  const normalized = normalizeDevice(device);
  if (!normalized.enabled || normalized.revokedAt || !normalized.credentialHash || !normalized.credentialSalt) return false;
  const actual = Buffer.from(hashCredential(credential, normalized.credentialSalt), 'hex');
  const expected = Buffer.from(normalized.credentialHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function revokeDevice(device, now = new Date()) {
  const normalized = normalizeDevice(device);
  const revokedAt = new Date(now).toISOString();
  return { ...normalized, enabled: false, revokedAt };
}

function mobileRoleAllows(role, requiredRole) {
  return (ROLE_RANK[normalizeRole(role)] || 0) >= (ROLE_RANK[normalizeRole(requiredRole)] || 0);
}

function publicMobileGatewayState(config, pairingSession = null) {
  const normalized = normalizeMobileGatewayConfig(config);
  return {
    ...clone(normalized),
    devices: normalized.devices.map(publicDevice),
    pairingSession: publicPairingSession(pairingSession),
    transportReady: false,
    transportStatus: 'planned',
    securityBoundary: 'Desktop-only secrets; HTTPS mobile gateway not active yet.'
  };
}

module.exports = {
  MOBILE_ROLES,
  ROLE_RANK,
  MAX_DEVICES,
  DEFAULT_PAIRING_TTL_MS,
  normalizeRole,
  normalizePort,
  normalizeFingerprint,
  normalizeDevice,
  publicDevice,
  defaultMobileGatewayConfig,
  normalizeMobileGatewayConfig,
  createPairingSession,
  publicPairingSession,
  pairingSessionActive,
  verifyPairingCode,
  consumePairingSession,
  hashCredential,
  issueDeviceCredential,
  verifyDeviceCredential,
  revokeDevice,
  mobileRoleAllows,
  publicMobileGatewayState
};
