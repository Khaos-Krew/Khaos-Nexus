'use strict';

const crypto = require('node:crypto');

const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,64}$/;
const SCRYPT_OPTIONS = Object.freeze({ N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024, keyLength: 64 });

function clean(value, max = 256) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function normalizeMobileLoginUsername(value) {
  const username = clean(value, 64);
  if (!USERNAME_PATTERN.test(username)) throw new Error('Mobile login username may contain only letters, numbers, dot, underscore, and hyphen, and must be 3-64 characters.');
  return username;
}

function usernameKey(value) {
  return clean(value, 64).toLowerCase();
}

function derivePassword(password, salt) {
  const value = String(password ?? '');
  return crypto.scryptSync(value, salt, SCRYPT_OPTIONS.keyLength, {
    N: SCRYPT_OPTIONS.N,
    r: SCRYPT_OPTIONS.r,
    p: SCRYPT_OPTIONS.p,
    maxmem: SCRYPT_OPTIONS.maxmem
  });
}

function createMobileLoginRecord({ username, password } = {}, now = new Date()) {
  const normalized = normalizeMobileLoginUsername(username);
  const secret = String(password ?? '');
  if (secret.length < 10 || secret.length > 256) throw new Error('Mobile login password must be 10-256 characters.');
  const salt = crypto.randomBytes(32);
  const passwordHash = derivePassword(secret, salt);
  return {
    username: normalized,
    usernameKey: usernameKey(normalized),
    algorithm: 'scrypt',
    parameters: {
      N: SCRYPT_OPTIONS.N,
      r: SCRYPT_OPTIONS.r,
      p: SCRYPT_OPTIONS.p,
      keyLength: SCRYPT_OPTIONS.keyLength
    },
    salt: salt.toString('base64url'),
    passwordHash: passwordHash.toString('base64url'),
    updatedAt: now.toISOString()
  };
}

function verifyMobileLogin(record, username, password) {
  if (!record || record.algorithm !== 'scrypt') return false;
  const secret = String(password ?? '');
  if (secret.length < 10 || secret.length > 256) return false;
  if (usernameKey(username) !== record.usernameKey) return false;
  try {
    const expected = Buffer.from(String(record.passwordHash || ''), 'base64url');
    const actual = derivePassword(secret, Buffer.from(String(record.salt || ''), 'base64url'));
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function publicMobileLogin(record) {
  return {
    configured: Boolean(record?.usernameKey && record?.passwordHash && record?.salt),
    username: clean(record?.username, 64),
    updatedAt: record?.updatedAt || null
  };
}

module.exports = {
  SCRYPT_OPTIONS,
  createMobileLoginRecord,
  verifyMobileLogin,
  publicMobileLogin,
  normalizeMobileLoginUsername,
  usernameKey
};
