'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PURCHASE_EXECUTION_PLAN_VERSION,
  CLUSTER_SHOP_FULFILLMENT,
  createNexusEconomyPurchaseExecutionPlan
} = require('../src/sentinel/nexus-economy-purchase-execution-plan.cjs');

const READY_RELATIONS = [
  { relname: 'nexus_economy_accounts', relkind: 'r' },
  { relname: 'nexus_economy_ledger', relkind: 'r' },
  { relname: 'nexus_economy_audit', relkind: 'r' }
];

function clusterCatalog(price = 150) {
  return JSON.stringify([
    {
      id: 'metal-bundle',
      name: 'Metal Bundle',
      category: 'Resources',
      kind: 'item',
      blueprint: '/Game/PrimalEarth/CoreBlueprints/Resources/PrimalItemResource_Metal.PrimalItemResource_Metal',
      baseQuantity: 100,
      buyPrice: price,
      minBundles: 1,
      maxBundles: 25
    }
  ]);
}

function readOnlyPool(query, onConnect = () => {}) {
  return {
    query,
    connect: async () => {
      onConnect();
      throw new Error('execution planning must not open a write transaction');
    }
  };
}

function fixture({ balance = '1000', price = 150 } = {}) {
  const calls = [];
  let connectCalls = 0;
  const pool = readOnlyPool(async (sql, params) => {
    calls.push({ sql: String(sql), params });
    if (String(sql).includes('pg_catalog')) return { rows: READY_RELATIONS };
    if (String(sql).includes('nexus_economy_accounts')) return { rows: [{ balance }] };
    throw new Error(`unexpected query: ${sql}`);
  }, () => { connectCalls += 1; });

  return {
    calls,
    get connectCalls() { return connectCalls; },
    options: {
      pool,
      env: {
        NEXUS_ECONOMY_RUNTIME_MODE: 'active',
        NEXUS_ECONOMY_RUNTIME_ENABLED: 'true',
        NEXUS_ECONOMY_AUTHORITY: 'nexus',
        NEXUS_ECONOMY_LEGACY_ARKSHOP_MUTATIONS_ENABLED: 'false',
        NEXUS_ECONOMY_PURCHASES_ENABLED: 'true',
        NEXUS_CLUSTER_SHOP_CATALOG_JSON: clusterCatalog(price)
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
  let connectCalls = 0;
  const planner = createNexusEconomyPurchaseExecutionPlan({
    pool: readOnlyPool(
      async () => { queries += 1; throw new Error('must not query'); },
      () => { connectCalls += 1; }
    ),
    env: {
      NEXUS_ECONOMY_RUNTIME_MODE: 'off',
      NEXUS_ECONOMY_AUTHORITY: 'nexus',
      NEXUS_ECONOMY_PURCHASES_ENABLED: 'true',
      NEXUS_CLUSTER_SHOP_CATALOG_JSON: clusterCatalog()
    }
  });

  const result = await planner.prepare('123456789', 'metal-bundle', {
    requestId: 'discord_abc12345',
    expectedTotalPrice: 150
  });

  assert.equal(result.ok, false);
  assert.equal(result.planReady, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.reason, 'runtime-mode-off');
  assert.equal(result.planId, null);
  assert.equal(queries, 0);
  assert.equal(connectCalls, 0);
});

test('authorized Cluster Shop purchase produces an immutable RewardsAscended plan without execution', async () => {
  const data = fixture({ balance: '1000', price: 150 });
  const planner = createNexusEconomyPurchaseExecutionPlan(data.options);
  const input = { quantity: 2, requestId: 'discord_abc12345', expectedTotalPrice: 300 };

  const first = await planner.prepare('123456789', 'metal-bundle', input);
  const second = await planner.prepare('123456789', 'metal-bundle', input);

  assert.equal(first.ok, true);
  assert.equal(first.planReady, true);
  assert.equal(first.executionPermitted, false);
  assert.equal(first.reason, 'purchase-execution-plan-ready');
  assert.equal(first.planVersion, PURCHASE_EXECUTION_PLAN_VERSION);
  assert.equal(first.fulfillment, CLUSTER_SHOP_FULFILLMENT);
  assert.equal(first.orderId, 'shop_discord_abc12345');
  assert.equal(first.totalPrice, 300);
  assert.equal(first.projectedBalance, 700);
  assert.match(first.planId, /^purchase_[a-f0-9]{24}$/);
  assert.match(first.planDigest, /^[a-f0-9]{64}$/);
  assert.equal(first.planDigest, second.planDigest);
  assert.deepEqual(first.operations, [
    { type: 'wallet-debit', amount: 300, idempotencyKey: 'shop_discord_abc12345' },
    {
      type: 'rewards-ascended-item-fulfillment',
      fulfillment: 'rewards-ascended-item',
      itemId: 'metal-bundle',
      quantity: 2,
      idempotencyKey: 'shop_discord_abc12345'
    }
  ]);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.operations), true);
  assert.equal(Object.isFrozen(first.operations[0]), true);
  assert.equal(data.connectCalls, 0);
  assertNoMutationSql(data.calls);
});

test('Cluster Shop plan exposes neither RewardsAscended blueprint paths nor Dino Cache fulfillment', async () => {
  const data = fixture();
  const planner = createNexusEconomyPurchaseExecutionPlan(data.options);

  const result = await planner.prepare('123456789', 'metal-bundle', {
    requestId: 'discord_abc12345',
    expectedTotalPrice: 150
  });

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /PrimalItemResource_Metal/i);
  assert.doesNotMatch(serialized, /dino-cache/i);
  assert.doesNotMatch(serialized, /SpawnDinoInBall/i);
  assert.equal(data.connectCalls, 0);
  assertNoMutationSql(data.calls);
});

test('changed price fails closed before an execution plan is produced', async () => {
  const data = fixture({ balance: '1000', price: 200 });
  const planner = createNexusEconomyPurchaseExecutionPlan(data.options);

  const result = await planner.prepare('123456789', 'metal-bundle', {
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
  assert.equal(data.connectCalls, 0);
  assertNoMutationSql(data.calls);
});

test('plan digest changes when purchase-critical fields change', async () => {
  const firstData = fixture({ balance: '1000', price: 150 });
  const secondData = fixture({ balance: '1000', price: 200 });
  const firstPlanner = createNexusEconomyPurchaseExecutionPlan(firstData.options);
  const secondPlanner = createNexusEconomyPurchaseExecutionPlan(secondData.options);

  const first = await firstPlanner.prepare('123456789', 'metal-bundle', {
    requestId: 'discord_abc12345',
    expectedTotalPrice: 150
  });
  const second = await secondPlanner.prepare('123456789', 'metal-bundle', {
    requestId: 'discord_def67890',
    expectedTotalPrice: 200
  });

  assert.notEqual(first.planDigest, second.planDigest);
  assert.equal(firstData.connectCalls, 0);
  assert.equal(secondData.connectCalls, 0);
  assertNoMutationSql(firstData.calls);
  assertNoMutationSql(secondData.calls);
});
