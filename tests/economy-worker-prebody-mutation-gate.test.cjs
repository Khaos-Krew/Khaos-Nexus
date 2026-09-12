'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mutationRequestGate } = require('../src/economy-worker/server.cjs');

test('mutation request gate rejects financial writes before body parsing in read-only mode', () => {
  assert.deepEqual(mutationRequestGate('/wallet/credit', {
    writesEnabled: false,
    lifecycle: { draining: false }
  }), {
    statusCode: 503,
    body: {
      ok: false,
      error: 'economy-write-cutover-not-enabled',
      writesEnabled: false
    }
  });
});

test('mutation request gate prioritizes drain rejection for all mutation classes', () => {
  for (const path of ['/identity/link', '/wallet/credit', '/shop/buy']) {
    assert.deepEqual(mutationRequestGate(path, {
      writesEnabled: true,
      lifecycle: { draining: true }
    }), {
      statusCode: 503,
      body: {
        ok: false,
        error: 'economy-worker-draining',
        draining: true
      }
    });
  }
});

test('mutation request gate can be re-evaluated after body parsing to catch a drain transition', () => {
  const lifecycle = { draining: false };

  assert.equal(mutationRequestGate('/wallet/credit', {
    writesEnabled: true,
    lifecycle
  }), null);

  lifecycle.draining = true;

  assert.deepEqual(mutationRequestGate('/wallet/credit', {
    writesEnabled: true,
    lifecycle
  }), {
    statusCode: 503,
    body: {
      ok: false,
      error: 'economy-worker-draining',
      draining: true
    }
  });
});

test('mutation request gate leaves non-mutating quote requests readable during drain', () => {
  assert.equal(mutationRequestGate('/shop/quote', {
    writesEnabled: false,
    lifecycle: { draining: true }
  }), null);
});