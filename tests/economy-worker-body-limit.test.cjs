'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

const {
  MAX_REQUEST_BODY_BYTES,
  body,
} = require('../src/economy-worker/server.cjs');

function requestFrom(payload, headers = {}) {
  const req = Readable.from([Buffer.from(payload)]);
  req.headers = headers;
  return req;
}

test('economy request body limit is enforced by UTF-8 bytes, not JavaScript character count', async () => {
  const payload = JSON.stringify({ note: '😀'.repeat(33_000) });

  assert.ok(payload.length < MAX_REQUEST_BODY_BYTES, 'regression payload must fit the old character-count limit');
  assert.ok(Buffer.byteLength(payload, 'utf8') > MAX_REQUEST_BODY_BYTES, 'regression payload must exceed the byte limit');

  await assert.rejects(
    body(requestFrom(payload)),
    /Request body too large\./,
  );
});

test('declared oversized bodies fail before request streaming begins', async () => {
  let iterated = false;
  const req = {
    headers: { 'content-length': String(MAX_REQUEST_BODY_BYTES + 1) },
    async *[Symbol.asyncIterator]() {
      iterated = true;
      throw new Error('body should not be consumed');
    },
  };

  await assert.rejects(body(req), /Request body too large\./);
  assert.equal(iterated, false);
});

test('valid JSON below the byte cap still parses normally', async () => {
  const payload = JSON.stringify({ discordUserId: '123', note: 'safe' });

  assert.deepEqual(
    await body(requestFrom(payload, { 'content-length': String(Buffer.byteLength(payload)) })),
    { discordUserId: '123', note: 'safe' },
  );
});
