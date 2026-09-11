'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PURCHASE_EXECUTION_PLAN_VERSION,
  createNexusEconomyPurchaseExecutionPlan
} = require('../src/sentinel/nexus-economy-purchase-execution-plan.cjs');

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
        groups: ['coastal'],
        delivery: {
          command: 'SpawnDinoInBall',
          blueprint: '/Game/Secret/Internal/Blueprint'
        }
      }
    }
  };
}

function fixture({ balance = '1000', price = 150 } = {}) {
  const calls = [];
  let reads = 0;
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes('pg_catalog')) return { rows: READY_RELATIONS };
      if (String(sql).includes('nexus_economy_accounts')) return { rows: [{ balance }] };
      throw new Error(`unexpected query: ${sql}`);
    }
  };

  return {
    calls,
    get reads() { return reads; },
    options: {
      pool,
      env: {
        NEXUS_ECONOMY_RUNTIME_MODE: 'active',
        NEXUS_ECONOMY_RUNTIME_ENABLED: 'true',
        NEXUS_ECONOMY_AUTHORITY: 'nexus',
        NEXUS_ECONOMY_LEGACY_ARKSHOP_MUTATIONS_ENABLED: 'false',
        NEXUS_ECONOMY_PURCHASES_ENABLED: 'true'
      },
      catalogPath: '/safe/dino-caches.json',
      readFile: async () => {
        reads += 1;
        return JSON.stringify(catalog(price));
      }
    }
  };
}

function assertNoMutationSql(calls) {
  for (const call of calls) {
    assert.doesNotMatch(call.sql, /\b(insert|update|delete|alter|create|drop|truncate)\b/i);
  }
}

test('off mode remains inert and cannot build an execution plan', async () => {
  let queries = 0;
  let reads = 0;
  const planner = createNexusEconomyPurchaseExecutionPlan({
    pool: { query: async () => { queries += 1; throw new Error('must not query'); } },
    env: {
      NEXUS_ECONOMY_RUNTIME_MODE: 'off',
      NEXUS_ECONOMY_AUTHORITY: 'nexus',
      NEXUS_ECONOMY_PURCHASES_ENABLED: 'true'
    },
    readFile: async () => { reads += 1; throw new Error('must not read'); }
  });

  const result = await planner.prepare('123456789', 'coastal', {
    requestId: 'discord_abc12345',
    expectedTotalPrice: 150
  });

  assert.equal(result.ok, false);
  assert.equal(result.planReady, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.reason, 'runtime-mode-off');
  assert.equal(result.planId, null);
  assert.equal(queries, 0);
  assert.equal(reads, 0);
});

test('authorized purchase produces an immutable tamper-evident plan without execution', async () => {
  const data = fixture({ balance: '1000', price: 150 });
  const planner = createNexusEconomyPurchaseExecutionPlan(data.options);

  const input = {
    quantity: 2,
    requestId: 'discord_abc12345',
    expectedTotalPrice: 300
  };
  const first = await planner.prepare('123456789', 'coastal', input);
  const second = await planner.prepare('123456789', 'coastal', input);

  assert.equal(first.ok, true);
  assert.equal(first.planReady, true);
  assert.equal(first.executionPermitted, false);
  assert.equal(first.reason, 'purchase-execution-plan-ready');
  assert.equal(first.planVersion, PURCHASE_EXECUTION_PLAN_VERSION);
  assert.equal(first.orderId, 'shop_discord_abc12345');
  assert.equal(first.totalPrice, 300);
  assert.equal(first.projectedBalance, 700);
  assert.match(first.planId, /^purchase_[a-f0-9]{24}$/);
  assert.match(first.planDigest, /^[a-f0-9]{64}$/);
  assert.equal(first.planDigest, second.planDigest);
  assert.deepEqual(first.operations, [
    { type: 'wallet-debit', amount: 300, idempotencyKey: 'shop_discord_abc12345' },
    { type: 'dino-cache-fulfillment', itemId: 'coastal', quantity: 2, idempotencyKey: 'shop_discord_abc12345' }
  ]);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.operations), true);
  assert.equal(Object.isFrozen(first.operations[0]), true);
  assertNoMutationSql(data.calls);
});

test('plan never exposes catalog fulfillment commands or blueprints', async () => {
  const data = fixture();
  const planner = createNexusEconomyPurchaseExecutionPlan(data.options);

  const result = await planner.prepare('123456789', 'coastal', {
    requestId: 'discord_abc12345',
    expectedTotalPrice: 150
  });

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /SpawnDinoInBall/i);
  assert.doesNotMatch(serialized, /Secret\/Internal\/Blueprint/i);
  assertNoMutationSql(data.calls);
});

test('changed price fails closed before an execution plan is produced', async () => {
  const data = fixture({ balance: '1000', price: 200 });
  const planner = createNexusEconomyPurchaseExecutionPlan(data.options);

  const result = await planner.prepare('123456789', 'coastal', {
    quantity: 2,
    requestId: 'discord_abc12345',
    expectedTotalPrice: 300
  });

  assert.equal(result.ok, false);
  assert.equal(result.planReady, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.reason, 'purchase-quote-changed');
  assert.equal(result.planId, null);
  assert.equal(result.planDigest, null);
  assertNoMutationSql(data.calls);
});

test('plan digest changes when purchase-critical fields change', async () => {
  const firstData = fixture({ balance: '1000', price: 150 });
  const secondData = fixture({ balance: '1000', price: 200 });
  const firstPlanner = createNexusEconomyPurchaseExecutionPlan(firstData.options);
  const secondPlanner = createNexusEconomyPurchaseExecutionPlan(secondData.options);

  const first = await firstPlanner.prepare('123456789', 'coastal', {
    requestId: 'discord_abc12345',
    expectedTotalPrice: 150
  });
  const second = await secondPlanner.prepare('123456789', 'coastal', {
    requestId: 'discord_def67890',
    expectedTotalPrice: 200
  });

  assert.notEqual(first.planDigest, second.planDigest);
  assertNoMutationSql(firstData.calls);
  assertNoMutationSql(secondData.calls);
});
