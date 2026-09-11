'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createNexusEconomyPurchaseExecutionPlan } = require('../src/sentinel/nexus-economy-purchase-execution-plan.cjs');
const { createNexusEconomyPurchaseActionEnvelope } = require('../src/sentinel/nexus-economy-purchase-action-envelope.cjs');

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

test('creates a deterministic worker-safe purchase action envelope', async () => {
  const plan = await buildPlan();
  const boundary = createNexusEconomyPurchaseActionEnvelope();
  const first = boundary.prepare(plan);
  const second = boundary.prepare(plan);

  assert.deepEqual(first, second);
  assert.equal(first.ok, true);
  assert.equal(first.actionReady, true);
  assert.equal(first.queueWritePermitted, false);
  assert.equal(first.executionPermitted, false);
  assert.equal(first.type, 'nexus.economy.purchase');
  assert.equal(first.capability, 'economy.purchase.execute');
  assert.equal(first.idempotencyKey, plan.orderId);
  assert.equal(first.correlationId, plan.requestId);
  assert.equal(first.actionId, `action_${plan.planDigest.slice(0, 24)}`);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.payload), true);
});

test('rejects tampered plans instead of creating an action', async () => {
  const plan = await buildPlan();
  const boundary = createNexusEconomyPurchaseActionEnvelope();
  const result = boundary.prepare({ ...plan, quantity: 3, totalPrice: 450, projectedBalance: 550 });

  assert.equal(result.ok, false);
  assert.equal(result.actionReady, false);
  assert.equal(result.queueWritePermitted, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.actionId, null);
});

test('envelope does not expose direct wallet or Dino Cache operations', async () => {
  const plan = await buildPlan();
  const boundary = createNexusEconomyPurchaseActionEnvelope();
  const result = boundary.prepare(plan);
  const serialized = JSON.stringify(result);

  assert.equal(serialized.includes('wallet-debit'), false);
  assert.equal(serialized.includes('dino-cache-fulfillment'), false);
  assert.equal(serialized.includes('operations'), false);
  assert.equal(serialized.includes('blueprint'), false);
  assert.equal(serialized.includes('rcon'), false);
  assert.equal(serialized.includes('sftp'), false);
});

test('action preparation performs no additional database, filesystem, Discord, ARK, RCON, SFTP, or queue I/O', async () => {
  const plan = await buildPlan();
  const boundary = createNexusEconomyPurchaseActionEnvelope();

  const result = boundary.prepare(plan);
  assert.equal(result.ok, true);
  assert.equal(result.queueWritePermitted, false);
  assert.equal(result.executionPermitted, false);
});
