'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { publicRequestError } = require('../src/economy-worker/server.cjs');

test('request error mapping keeps client-safe body size failures explicit', () => {
  assert.deepEqual(publicRequestError(new Error('Request body too large.')), {
    statusCode: 413,
    body: { ok: false, error: 'request-body-too-large' }
  });
});

test('request error mapping reports malformed JSON without reflecting parser text', () => {
  const error = new SyntaxError('Unexpected token SECRET_DATABASE_URL at position 4');
  const result = publicRequestError(error);

  assert.deepEqual(result, {
    statusCode: 400,
    body: { ok: false, error: 'invalid-json' }
  });
  assert.equal(JSON.stringify(result).includes('SECRET_DATABASE_URL'), false);
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
