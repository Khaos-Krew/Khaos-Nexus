'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readPathId } = require('../src/economy-worker/server.cjs');

test('economy read routes accept one canonical identifier segment', () => {
  assert.equal(readPathId('/wallet/123456789012345678', '/wallet/'), '123456789012345678');
  assert.equal(readPathId('/shop/order/ORDER_123-abc', '/shop/order/'), 'ORDER_123-abc');
  assert.equal(readPathId('/wallet/econ%3A123', '/wallet/'), 'econ:123');
});

test('economy read routes reject path separators instead of collapsing identifiers', () => {
  for (const path of [
    '/wallet/12/34',
    '/wallet/12%2F34',
    '/wallet/12%5C34',
    '/shop/order/ORDER/123',
    '/shop/order/ORDER%2F123',
    '/shop/order/ORDER%5C123'
  ]) {
    const prefix = path.startsWith('/wallet/') ? '/wallet/' : '/shop/order/';
    assert.equal(readPathId(path, prefix), null);
  }
});

test('economy read routes reject malformed, empty, unsafe, or oversized identifiers', () => {
  assert.equal(readPathId('/wallet/', '/wallet/'), null);
  assert.equal(readPathId('/wallet/%', '/wallet/'), null);
  assert.equal(readPathId('/wallet/has%20space', '/wallet/'), null);
  assert.equal(readPathId(`/wallet/${'a'.repeat(129)}`, '/wallet/'), null);
});
