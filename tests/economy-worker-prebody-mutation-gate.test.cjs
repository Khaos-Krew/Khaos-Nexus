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
const { createEconomyServer, WRITE_PATHS } = require('../src/economy-worker/server.cjs');

function drainingRequest(path, { authenticated = true, input = '{}' } = {}) {
  let consumed = false;
  let quoted = false;
  const runtime = createEconomyServer({
    token: 'test-drain-token', writesEnabled: true,
    worker: {},
    shop: { quote: () => { quoted = true; return { totalPrice: 50 }; } }
  });
  runtime.beginDrain();
  const req = {
    method: 'POST', url: path,
    headers: { authorization: authenticated ? 'Bearer test-drain-token' : '' },
    async *[Symbol.asyncIterator]() {
      consumed = true;
      if (input === null) throw new Error('Inadmissible request body was consumed');
      yield Buffer.from(input);
    }
  };
  return new Promise((resolve, reject) => {
    const res = {
      writeHead(status) { this.status = status; },
      end(payload) { resolve({ status: this.status, body: JSON.parse(payload), consumed, quoted }); }
    };
    Promise.resolve(runtime.server.listeners('request')[0](req, res)).catch(reject);
  });
}

test('draining server serves authenticated quote including its body', async () => {
  const result = await drainingRequest('/shop/quote');
  assert.equal(result.status, 200);
  assert.equal(result.consumed, true);
  assert.equal(result.quoted, true);
  assert.equal(result.body.quote.totalPrice, 50);
});

test('draining server rejects unknown and mutation POSTs without consuming bodies', async () => {
  for (const path of ['/unknown', '/shop/quote/unknown', '/shop/quote/', '/identity/link', ...WRITE_PATHS]) {
    const result = await drainingRequest(path, { input: null });
    assert.equal(result.status, 503, path);
    assert.deepEqual(result.body, { ok: false, error: 'economy-worker-draining', draining: true });
    assert.equal(result.consumed, false, path);
    assert.equal(result.quoted, false, path);
  }
});

test('authentication precedes drain and route decisions without consuming bodies', async () => {
  for (const path of ['/unknown', '/shop/quote', '/identity/link', ...WRITE_PATHS]) {
    const result = await drainingRequest(path, { authenticated: false, input: null });
    assert.equal(result.status, 401, path);
    assert.deepEqual(result.body, { ok: false, error: 'unauthorized' });
    assert.equal(result.consumed, false, path);
  }
});
