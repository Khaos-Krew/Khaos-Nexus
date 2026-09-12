'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  runtimeLiveness,
  runtimeOperationalReadiness
} = require('../src/economy-worker/server.cjs');

function healthyRuntime(overrides = {}) {
  const calls = { health: 0, listCatalog: 0, pendingBuyOrders: 0, mutation: 0 };
  const worker = {
    health() {
      calls.health += 1;
      return overrides.health || { ok: true, accounts: 2, linkedArkIds: 2, ledgerEntries: 4 };
    },
    credit() { calls.mutation += 1; },
    spend() { calls.mutation += 1; },
    recordPresence() { calls.mutation += 1; },
    accrueOffline() { calls.mutation += 1; }
  };
  const shop = {
    listCatalog() {
      calls.listCatalog += 1;
      if (overrides.catalogError) throw overrides.catalogError;
      return overrides.catalog || [
        { id: 'buy', buyable: true, sellable: false },
        { id: 'sell', buyable: false, sellable: true }
      ];
    },
    pendingBuyOrders() {
      calls.pendingBuyOrders += 1;
      return [];
    },
    createBuyOrder() { calls.mutation += 1; },
    createSellOrder() { calls.mutation += 1; },
    confirmSellRemoval() { calls.mutation += 1; },
    markBuyDelivery() { calls.mutation += 1; }
  };
  return { worker, shop, calls };
}

test('liveness is process-local and does not inspect economy state', () => {
  assert.deepEqual(runtimeLiveness(), {
    ok: true,
    service: 'nexus-economy-worker',
    status: 'live'
  });
});

test('readiness is healthy in read-only migration mode without enabling writes', () => {
  const { worker, shop, calls } = healthyRuntime();
  const result = runtimeOperationalReadiness({ worker, shop, token: '', writesEnabled: false });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.status, 'ready');
  assert.equal(result.body.migrationMode, 'read-only');
  assert.equal(result.body.checkoutReady, false);
  assert.equal(result.body.sellbackCreditReady, false);
  assert.equal(calls.mutation, 0);
});

test('readiness fails closed when the wallet store health check fails', () => {
  const { worker, shop, calls } = healthyRuntime({ health: { ok: false, error: 'store-invalid' } });
  const result = runtimeOperationalReadiness({ worker, shop, token: 'configured', writesEnabled: true });

  assert.equal(result.statusCode, 503);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.status, 'not-ready');
  assert.equal(result.body.error, 'store-invalid');
  assert.equal(calls.mutation, 0);
});

test('readiness converts diagnostic exceptions into a non-mutating 503', () => {
  const { worker, shop, calls } = healthyRuntime({ catalogError: new Error('catalog-unavailable') });
  const result = runtimeOperationalReadiness({ worker, shop, token: 'configured', writesEnabled: true });

  assert.equal(result.statusCode, 503);
  assert.deepEqual(result.body, {
    ok: false,
    service: 'nexus-economy-worker',
    status: 'not-ready',
    error: 'catalog-unavailable'
  });
  assert.equal(calls.mutation, 0);
});
