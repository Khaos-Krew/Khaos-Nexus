'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createMobileLoginRecord,
  verifyMobileLogin,
  publicMobileLogin,
  normalizeMobileLoginUsername
} = require('../shared/mobile-login.cjs');

test('mobile login stores a salted verifier and never returns the password', () => {
  const record = createMobileLoginRecord({ username: 'Owner.Admin', password: 'correct-horse-battery' }, new Date('2026-08-20T06:00:00Z'));
  assert.equal(record.username, 'Owner.Admin');
  assert.equal(record.usernameKey, 'owner.admin');
  assert.equal(typeof record.salt, 'string');
  assert.equal(typeof record.passwordHash, 'string');
  assert.equal(record.password, undefined);
  assert.equal(publicMobileLogin(record).configured, true);
  assert.deepEqual(Object.keys(publicMobileLogin(record)).sort(), ['configured', 'updatedAt', 'username']);
});

test('mobile login verification is case-insensitive for username and exact for password', () => {
  const record = createMobileLoginRecord({ username: 'NexusOwner', password: 'A-Strong-Passphrase-38' });
  assert.equal(verifyMobileLogin(record, 'nexusowner', 'A-Strong-Passphrase-38'), true);
  assert.equal(verifyMobileLogin(record, 'NEXUSOWNER', 'A-Strong-Passphrase-38'), true);
  assert.equal(verifyMobileLogin(record, 'NexusOwner', 'wrong-password'), false);
  assert.equal(verifyMobileLogin(record, 'someone-else', 'A-Strong-Passphrase-38'), false);
});

test('mobile login rejects weak or malformed credentials', () => {
  assert.throws(() => createMobileLoginRecord({ username: 'ok-user', password: 'short' }), /10-256/);
  assert.throws(() => normalizeMobileLoginUsername('bad user name'), /may contain/);
});
