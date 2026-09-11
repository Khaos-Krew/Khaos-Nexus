'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createNexusEconomyPurchaseExecutionPlan } = require('../src/sentinel/nexus-economy-purchase-execution-plan.cjs');
const { createNexusEconomyPurchasePlanVerifier } = require('../src/sentinel/nexus-economy-purchase-plan-verifier.cjs');

const READY_RELATIONS = [
  { relation_name: 'nexus_economy_accounts' },
  { relation_name: 'nexus_economy_ledger' },
  { relation_name: 'nexus_economy_audit' }
];

function catalog(price = 150) {
  return {
    version: 1,
    caches: {
      coastal: {
        displayName: 'Coastal Cache',
        emoji: '🌊',
        tagline: 'Coastal starter pool.',
        price,
        cooldownMinutes: 5,
        groups: ['coastal']
      }
    }
  };
}

async function buildPlan() {
  const pool = {
    query: async (sql) => {
      if (String(sql).includes('pg_catalog')) return { rows: READY_RELATIONS };
      if (String(sql).includes('nexus_economy_accounts')) return { rows: [{ balance: '1000' }] };
      throw new Error(`unexpected query: ${sql}`);
    }
  };
  const planner = createNexusEconomyPurchaseExecutionPlan({
    pool,
    env: {
      NEXUS_ECONOMY_RUNTIME_MODE: 'active',
      NEXUS_ECONOMY_RUNTIME_ENABLED: 'true',
      NEXUS_ECONOMY_AUTHORITY: 'nexus',
      NEXUS_ECONOMY_LEGACY_ARKSHOP_MUTATIONS_ENABLED: 'false',
      NEXUS_ECONOMY_PURCHASES_ENABLED: 'true'
    },
    catalogPath: '/safe/dino-caches.json',
    readFile: async () => JSON.stringify(catalog())
  });

  return planner.prepare('123456789', 'coastal', {
    quantity: 2,
    requestId: 'discord_abc12345',
    expectedTotalPrice: 300
  });
}

test('verifies an untouched execution plan without permitting execution', async () => {
  const plan = await buildPlan();
  const verifier = createNexusEconomyPurchasePlanVerifier();
  const result = verifier.verify(plan);

  assert.equal(result.ok, true);
  assert.equal(result.verificationReady, true);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.reason, 'purchase-plan-verified');
  assert.equal(result.planId, plan.planId);
  assert.equal(result.planDigest, plan.planDigest);
  assert.equal(result.totalPrice, 300);
  assert.equal(result.projectedBalance, 700);
  assert.equal(Object.isFrozen(result), true);
});

test('rejects purchase-critical field tampering', async () => {
  const plan = await buildPlan();
  const verifier = createNexusEconomyPurchasePlanVerifier();
  const tampered = { ...plan, quantity: 3, totalPrice: 450, projectedBalance: 550 };
  const result = verifier.verify(tampered);

  assert.equal(result.ok, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.reason, 'purchase-plan-tampered');
});

test('rejects operation tampering even when purchase payload digest still matches', async () => {
  const plan = await buildPlan();
  const verifier = createNexusEconomyPurchasePlanVerifier();
  const tampered = {
    ...plan,
    operations: [
      { ...plan.operations[0], amount: 1 },
      { ...plan.operations[1] }
    ]
  };
  const result = verifier.verify(tampered);

  assert.equal(result.ok, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.reason, 'purchase-plan-operations-tampered');
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

test('verification performs no database, filesystem, Discord, or ARK I/O', async () => {
  const plan = await buildPlan();
  const verifier = createNexusEconomyPurchasePlanVerifier();
  const first = verifier.verify(plan);
  const second = verifier.verify(plan);

  assert.deepEqual(first, second);
  assert.equal(first.executionPermitted, false);
});
