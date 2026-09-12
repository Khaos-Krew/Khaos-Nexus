'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createNexusEconomyPurchaseExecutionPlan } = require('../src/sentinel/nexus-economy-purchase-execution-plan.cjs');
const { createNexusEconomyPurchasePlanVerifier } = require('../src/sentinel/nexus-economy-purchase-plan-verifier.cjs');

const READY_RELATIONS = [
  { relname: 'nexus_economy_accounts', relkind: 'r' },
  { relname: 'nexus_economy_ledger', relkind: 'r' },
  { relname: 'nexus_economy_audit', relkind: 'r' }
];

function clusterCatalog(price = 150) {
  return JSON.stringify([{ id: 'metal-bundle', name: 'Metal Bundle', category: 'Resources', kind: 'item', blueprint: '/Game/PrimalEarth/CoreBlueprints/Resources/PrimalItemResource_Metal.PrimalItemResource_Metal', baseQuantity: 100, buyPrice: price, minBundles: 1, maxBundles: 25 }]);
}

async function buildPlan() {
  const pool = {
    query: async (sql) => {
      if (String(sql).includes('pg_catalog')) return { rows: READY_RELATIONS };
      if (String(sql).includes('nexus_economy_accounts')) return { rows: [{ balance: '1000' }] };
      throw new Error(`unexpected query: ${sql}`);
    },
    connect: async () => { throw new Error('verification setup must not open a write transaction'); }
  };
  const planner = createNexusEconomyPurchaseExecutionPlan({
    pool,
    env: {
      NEXUS_ECONOMY_RUNTIME_MODE: 'active',
      NEXUS_ECONOMY_RUNTIME_ENABLED: 'true',
      NEXUS_ECONOMY_AUTHORITY: 'nexus',
      NEXUS_ECONOMY_LEGACY_ARKSHOP_MUTATIONS_ENABLED: 'false',
      NEXUS_ECONOMY_PURCHASES_ENABLED: 'true',
      NEXUS_CLUSTER_SHOP_CATALOG_JSON: clusterCatalog()
    }
  });
  return planner.prepare('123456789', 'metal-bundle', { quantity: 2, requestId: 'discord_abc12345', expectedTotalPrice: 300 });
}

test('verifies untouched RewardsAscended plan without permitting execution', async () => {
  const plan = await buildPlan();
  const result = createNexusEconomyPurchasePlanVerifier().verify(plan);
  assert.equal(result.ok, true);
  assert.equal(result.verificationReady, true);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.reason, 'purchase-plan-verified');
  assert.equal(result.fulfillment, 'rewards-ascended-item');
  assert.equal(result.totalPrice, 300);
  assert.equal(result.projectedBalance, 700);
  assert.equal(Object.isFrozen(result), true);
});

test('rejects purchase-critical field tampering', async () => {
  const plan = await buildPlan();
  const result = createNexusEconomyPurchasePlanVerifier().verify({ ...plan, quantity: 3, totalPrice: 450, projectedBalance: 550 });
  assert.equal(result.ok, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.reason, 'purchase-plan-tampered');
});

test('rejects operation or fulfillment tampering', async () => {
  const plan = await buildPlan();
  const verifier = createNexusEconomyPurchasePlanVerifier();
  const operationTampered = { ...plan, operations: [{ ...plan.operations[0], amount: 1 }, { ...plan.operations[1] }] };
  assert.equal(verifier.verify(operationTampered).reason, 'purchase-plan-operations-tampered');
  assert.equal(verifier.verify({ ...plan, fulfillment: 'dino-cache' }).reason, 'purchase-plan-fulfillment-invalid');
});

test('rejects malformed and inconsistent plans before verification', async () => {
  const plan = await buildPlan();
  const verifier = createNexusEconomyPurchasePlanVerifier();
  assert.equal(verifier.verify(null).reason, 'purchase-plan-invalid');
  assert.equal(verifier.verify({ ...plan, planVersion: 999 }).reason, 'purchase-plan-version-unsupported');
  assert.equal(verifier.verify({ ...plan, totalPrice: 301 }).reason, 'purchase-plan-total-mismatch');
  assert.equal(verifier.verify({ ...plan, projectedBalance: 699 }).reason, 'purchase-plan-balance-mismatch');
  assert.equal(verifier.verify({ ...plan, planDigest: 'not-a-digest' }).reason, 'purchase-plan-digest-invalid');
});

test('verification is deterministic, inert, and contains no Dino Cache or blueprint internals', async () => {
  const plan = await buildPlan();
  const verifier = createNexusEconomyPurchasePlanVerifier();
  const first = verifier.verify(plan);
  const second = verifier.verify(plan);
  assert.deepEqual(first, second);
  assert.equal(first.executionPermitted, false);
  const serialized = JSON.stringify(first);
  assert.doesNotMatch(serialized, /dino-cache/i);
  assert.doesNotMatch(serialized, /PrimalItemResource_Metal/i);
});
