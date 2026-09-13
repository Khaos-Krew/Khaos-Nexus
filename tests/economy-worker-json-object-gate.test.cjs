'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EconomyRequestError, requestObject, publicRequestError } = require('../src/economy-worker/server.cjs');

test('economy request bodies accept plain JSON objects', () => {
  const payload = { discordUserId: '123', amount: 10 };
  assert.equal(requestObject(payload), payload);
  assert.deepEqual(requestObject({}), {});
});

test('economy request bodies reject valid JSON primitives and arrays', () => {
  for (const value of [null, true, false, 0, 1, 'wallet', [], ['123']]) {
    assert.throws(
      () => requestObject(value),
      (error) => error instanceof EconomyRequestError && error.code === 'invalid-json-object'
    );
  }
});

test('invalid JSON object shape maps to a stable public 400 response', () => {
  const error = new EconomyRequestError('invalid-json-object', 'secret downstream detail');
  assert.deepEqual(publicRequestError(error), {
    statusCode: 400,
    body: { ok: false, error: 'invalid-json-object' }
  });
});
