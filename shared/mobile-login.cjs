'use strict';

const crypto = require('node:crypto');

const USERNAME_MIN = 3;
const USERNAME_MAX = 64;
const PASSWORD_MIN = 10;
const PASSWORD_MAX = 256;

function clean(value, max) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function normalizeMobileLoginUsername(value) {
  const username = clean(value, USERNAME_MAX);
  if (username.length < USERNAME_MIN) throw new Error(`Username must be at least ${USERNAME_MIN} characters.`);
  if (!/^[A-Za-z0-9._@-]+$/.test(username)) throw new Error('Username may contain letters, numbers, dot, underscore, @, and hyphen only.');
  return username;
}

function normalizeMobileLoginPassword(value) {
  const password = String(value ?? '');
  if (password.length < PASSWORD_MIN) throw new Error(`Password must be at least ${PASSWORD_MIN} characters.`);
  if (password.length > PASSWORD_MAX) throw new Error(`Password must be ${PASSWORD_MAX} characters or fewer.`);
  return password;
}

function derive(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

function createMobileLoginRecord(input = {}, now = new Date()) {
  const username = normalizeMobileLoginUsername(input.username);
  const password = normalizeMobileLoginPassword(input.password);
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    schemaVersion: 1,
    username,
    usernameKey: username.toLowerCase(),
    salt,
    passwordHash: derive(password, salt),
    updatedAt: new Date(now).toISOString()
  };
}

function verifyMobileLogin(record, username, password) {
  if (!record?.salt || !record?.passwordHash || !record?.usernameKey) return false;
  const providedUsername = clean(username, USERNAME_MAX).toLowerCase();
  if (!providedUsername || providedUsername !== String(record.usernameKey).toLowerCase()) return false;
  const providedPassword = String(password ?? '');
  if (!providedPassword || providedPassword.length > PASSWORD_MAX) return false;
  try {
    const actual = Buffer.from(derive(providedPassword, String(record.salt)), 'hex');
    const expected = Buffer.from(String(record.passwordHash), 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function publicMobileLogin(record) {
  if (!record?.username) return { configured: false, username: '', updatedAt: null };
  return { configured: true, username: String(record.username), updatedAt: record.updatedAt || null };
}

module.exports = {
  USERNAME_MIN,
  USERNAME_MAX,
  PASSWORD_MIN,
  PASSWORD_MAX,
  normalizeMobileLoginUsername,
  normalizeMobileLoginPassword,
  createMobileLoginRecord,
  verifyMobileLogin,
  publicMobileLogin
};
