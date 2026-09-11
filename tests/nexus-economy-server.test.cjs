'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createEconomyServer } = require('../src/economy-worker/server.cjs');

const KEY = 'nexus-unit-test-key';

function fixture(writesEnabled) {
  const calls = { accrue: 0, spend: 0, link: 0 };
  const worker = {
    health: () => ({ ok: true, accounts: 2, linkedArkIds: 2, ledgerEntries: 4 }),
    balance: () => 125,
    accrueOffline: async () => { calls.accrue += 1; return { ok: true, balance: 135 }; },
    spend: async () => { calls.spend += 1; return { ok: true, balance: 100 }; },
    credit: async () => ({ ok: true, balance: 150 }),
    recordPresence: async () => ({ ok: true }),
    linkArkIdentity: () => { calls.link += 1; return { discordUserId: '1', eosId: 'EOS_1' }; }
  };
  const shop = {
    listCatalog: () => [{ id: 'metal', buyable: true, sellable: true }],
    pendingBuyOrders: () => [],
    order: () => null,
    quote: () => ({ itemId: 'metal', bundles: 1, totalQuantity: 100, unitPrice: 50, totalPrice: 50 }),
    createBuyOrder: async () => ({ ok: true }),
    createSellOrder: () => ({ ok: true }),
    confirmSellRemoval: async () => ({ ok: true }),
    markBuyDelivery: () => ({ ok: true })
  };
  return { runtime: createEconomyServer({ worker, shop, token: KEY, writesEnabled }), calls };
}

async function start(runtime) {
  await new Promise((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
  return runtime.server.address().port;
}

function call(port, path, method = 'GET', data = null) {
  const payload = data == null ? null : Buffer.from(JSON.stringify(data));
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: { authorization: `Bearer ${KEY}`, ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}) } }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function close(runtime) {
  return new Promise((resolve) => runtime.server.close(resolve));
}

test('read-only mode exposes readiness and blocks financial cutover', async () => {
  const { runtime, calls } = fixture(false);
  const port = await start(runtime);
  try {
    const health = await call(port, '/health');
    assert.equal(health.body.writesEnabled, false);
    assert.equal(health.body.migrationMode, 'read-only');
    assert.equal(health.body.checkoutReady, false);

    const wallet = await call(port, '/wallet/1');
    assert.equal(wallet.body.balance, 125);
    assert.equal(calls.accrue, 0);

    const spend = await call(port, '/wallet/spend', 'POST', { discordUserId: '1', amount: 25, orderId: 'NX-1' });
    assert.equal(spend.status, 503);
    assert.equal(spend.body.error, 'economy-write-cutover-not-enabled');
    assert.equal(calls.spend, 0);
  } finally { await close(runtime); }
});

test('read-only mode permits identity staging and pricing quotes', async () => {
  const { runtime, calls } = fixture(false);
  const port = await start(runtime);
  try {
    const linked = await call(port, '/identity/link', 'POST', { discordUserId: '1', eosId: 'EOS_1' });
    assert.equal(linked.status, 200);
    assert.equal(calls.link, 1);

    const quote = await call(port, '/shop/quote', 'POST', { itemId: 'metal', bundles: 1, action: 'buy' });
    assert.equal(quote.status, 200);
    assert.equal(quote.body.quote.totalPrice, 50);
  } finally { await close(runtime); }
});

test('write-enabled mode permits wallet accrual and spending', async () => {
  const { runtime, calls } = fixture(true);
  const port = await start(runtime);
  try {
    const health = await call(port, '/health');
    assert.equal(health.body.checkoutReady, true);
    await call(port, '/wallet/1');
    assert.equal(calls.accrue, 1);
    const spend = await call(port, '/wallet/spend', 'POST', { discordUserId: '1', amount: 25, orderId: 'NX-1' });
    assert.equal(spend.status, 200);
    assert.equal(calls.spend, 1);
  } finally { await close(runtime); }
});
