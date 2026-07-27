'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { redactText, redactObject, errorFingerprint } = require('../shared/redaction.cjs');

test('redacts explicit secrets and token-shaped values', () => {
  const secret = 'super-secret-password';
  const token = 'abcdefghijklmnopqrstuv.abcdef.abcdefghijklmnopqrstuvwxyz';
  const output = redactText(`password=${secret} token=${token}`, [secret]);
  assert.equal(output.includes(secret), false);
  assert.equal(output.includes(token), false);
  assert.match(output, /REDACTED/);
});

test('redacts sensitive object keys recursively', () => {
  const result = redactObject({ token: 'abc', nested: { rconPassword: 'def', safe: 'ok' } });
  assert.equal(result.token, '[REDACTED]');
  assert.equal(result.nested.rconPassword, '[REDACTED]');
  assert.equal(result.nested.safe, 'ok');
});

test('fingerprints similar errors consistently', () => {
  const first = errorFingerprint('Error at C:\\Users\\A\\app.js:123');
  const second = errorFingerprint('Error at C:\\Users\\B\\app.js:999');
  assert.equal(first, second);
});
