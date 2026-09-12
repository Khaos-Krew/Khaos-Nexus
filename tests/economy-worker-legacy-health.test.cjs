'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runtimeLegacyHealth } = require('../src/economy-worker/server.cjs');

function runtime(overrides = {}) {
  const worker = {
    health() {
      if (overrides.healthError) throw overrides.healthError;
      return overrides.health || { ok: true, accounts: 1, linkedArkIds: 1, ledgerEntries: 2 };
    }
  };
  const shop = {
    listCatalog() {
      if (overrides.catalogError) throw overrides.catalogError;
      return [{ id: 'buy', buyable: true, sellable: false }];
    },
    pendingBuyOrders() {
      if (overrides.pendingError) throw overrides.pendingError;
      return [];
    }
  };
  return { worker, shop };
}

test('legacy health preserves healthy compatibility response', () => {
  const { worker, shop } = runtime();
  const result = runtimeLegacyHealth({ worker, shop, token: 'configured', writesEnabled: false });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.service, 'nexus-economy-worker');
  assert.equal(result.body.migrationMode, 'read-only');
});

test('legacy health redacts catalog exceptions instead of exposing unauthenticated diagnostics', () => {
  const secret = 'postgres://user:password@private-host/economy';
  const { worker, shop } = runtime({ catalogError: new Error(secret) });
  const result = runtimeLegacyHealth({ worker, shop, token: 'configured', writesEnabled: true });

  assert.equal(result.statusCode, 503);
  assert.deepEqual(result.body, {
    ok: false,
    service: 'nexus-economy-worker',
    status: 'not-ready',
    error: 'diagnostic-unavailable'
  });
  assert.equal(JSON.stringify(result.body).includes(secret), false);
});

test('legacy health redacts pending-order diagnostic exceptions', () => {
  const secret = '/private/economy/orders.json';
  const { worker, shop } = runtime({ pendingError: new Error(secret) });
  const result = runtimeLegacyHealth({ worker, shop, token: '', writesEnabled: false });

  assert.equal(result.statusCode, 503);
  assert.equal(result.body.error, 'diagnostic-unavailable');
  assert.equal(JSON.stringify(result.body).includes(secret), false);
});
