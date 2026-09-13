'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EconomyRequestError,
  publicRequestError
} = require('../src/economy-worker/server.cjs');

test('request error mapping keeps parser-owned body size failures explicit', () => {
  assert.deepEqual(publicRequestError(new EconomyRequestError('request-body-too-large')), {
    statusCode: 413,
    body: { ok: false, error: 'request-body-too-large' }
  });
});

test('request error mapping reports parser-owned malformed JSON without reflecting parser text', () => {
  const error = new EconomyRequestError('invalid-json', 'Unexpected token SECRET_DATABASE_URL at position 4');
  const result = publicRequestError(error);

  assert.deepEqual(result, {
    statusCode: 400,
    body: { ok: false, error: 'invalid-json' }
  });
  assert.equal(JSON.stringify(result).includes('SECRET_DATABASE_URL'), false);
});

test('downstream errors cannot spoof parser error responses by message or error type', () => {
  assert.deepEqual(publicRequestError(new Error('Request body too large.')), {
    statusCode: 500,
    body: { ok: false, error: 'internal-error' }
  });
  assert.deepEqual(publicRequestError(new SyntaxError('provider parser exploded')), {
    statusCode: 500,
    body: { ok: false, error: 'internal-error' }
  });
});

test('request error mapping redacts unexpected wallet and shop diagnostics', () => {
  const secret = 'postgres://user:password@private-host/economy';
  const result = publicRequestError(new Error(secret));

  assert.deepEqual(result, {
    statusCode: 500,
    body: { ok: false, error: 'internal-error' }
  });
  assert.equal(JSON.stringify(result).includes(secret), false);
});
