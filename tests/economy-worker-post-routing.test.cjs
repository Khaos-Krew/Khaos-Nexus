'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DRAIN_MUTATION_PATHS,
  WRITE_PATHS,
  POST_PATHS
} = require('../src/economy-worker/server.cjs');

test('economy POST allowlist covers every executable POST route', () => {
  const expected = new Set([
    ...DRAIN_MUTATION_PATHS,
    ...WRITE_PATHS,
    '/shop/quote'
  ]);

  assert.deepEqual([...POST_PATHS].sort(), [...expected].sort());
});

test('unknown economy POST routes are rejected before body parsing', () => {
  assert.equal(POST_PATHS.has('/unknown'), false);
  assert.equal(POST_PATHS.has('/shop/order/not-a-post-route'), false);
});
