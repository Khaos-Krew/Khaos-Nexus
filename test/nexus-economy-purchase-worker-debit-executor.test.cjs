'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createNexusEconomyPurchaseWorkerDebitExecutor } = require('../src/sentinel/nexus-economy-purchase-worker-debit-executor.cjs');

function action(overrides = {}) {
  return {
    actionId: 'action_aaaaaaaaaaaaaaaaaaaaaaaa',
    capability: 'economy.purchase.execute',
    source: 'sentinel-v2.economy.purchase',
    subject: 'discord-user:123456789',
    status: 'running',
    persisted: true,
    idempotencyKey: 'shop_discord_abc12345',
    correlationId: 'discord_abc12345',
    request: {
      requestId: 'discord_abc12345',
      orderId: 'shop_discord_abc12345',
      payload: {
        discordUserId: '123456789',
        itemId: 'metal-ingot',
        quantity: 2,
        currency: 'Nexus Points',
        totalPrice: 300,
        projectedBalance: 700,
        fulfillment: 'rewards-ascended-item'
      }
    },
    ...overrides
  };
}

function claim(a) {
  return {
    ok: true,
    claimed: true,
    persisted: true,
    executionPermitted: false,
    actionId: a.actionId,
    claim: {
      actionId: a.actionId,
      attempt: 1,
      status: 'running',
      idempotencyKey: a.idempotencyKey,
      orderId: a.idempotencyKey,
      correlationId: a.correlationId,
      requestId: a.correlationId,
      fulfillment: 'rewards-ascended-item',
      persisted: true,
      executionPermitted: false
    }
  };
}

function activeEnv(overrides = {}) {
  return {
    NEXUS_ECONOMY_RUNTIME_MODE: 'active',
    NEXUS_ECONOMY_RUNTIME_ENABLED: 'true',
    NEXUS_ECONOMY_AUTHORITY: 'nexus',
    NEXUS_ECONOMY_PURCHASES_ENABLED: 'true',
    NEXUS_ECONOMY_WORKER_CLAIM_ENABLED: 'true',
    NEXUS_ECONOMY_WORKER_DEBIT_ENABLED: 'true',
    ...overrides
  };
}

test('persists exactly one idempotent Cluster Shop wallet spend and remains non-fulfilling', async () => {
  const calls = [];
  const mutationService = {
    async spend(input, context) {
      calls.push({ input, context });
      return { ok: true, duplicate: false, balance: 700, transactionId: 42 };
    }
  };
  const a = action();
  const result = await createNexusEconomyPurchaseWorkerDebitExecutor({ mutationService, env: activeEnv() }).execute(a, claim(a));

  assert.equal(result.ok, true);
  assert.equal(result.debited, true);
  assert.equal(result.duplicate, false);
  assert.equal(result.persisted, true);
  assert.equal(result.executionPermitted, false);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].input, {
    discordUserId: '123456789',
    amount: 300,
    orderId: 'shop_discord_abc12345',
    source: 'cluster-shop',
    metadata: {
      actionId: a.actionId,
      requestId: 'discord_abc12345',
      correlationId: 'discord_abc12345',
      fulfillment: 'rewards-ascended-item'
    }
  });
  assert.equal(calls[0].context.actor, 'sentinel-v2:cluster-shop-purchase-worker');
  assert.equal(result.debit.balance, 700);
  assert.equal(result.debit.fulfillment, 'rewards-ascended-item');
  const serialized = JSON.stringify(result).toLowerCase();
  for (const forbidden of ['dino-cache', 'blueprint', 'ra.reward', 'rcon', 'sftp']) assert.equal(serialized.includes(forbidden), false);
});

test('fails closed before mutation unless every debit gate is enabled', async () => {
  let calls = 0;
  const mutationService = { async spend() { calls += 1; return { ok: true, duplicate: false, balance: 700, transactionId: 1 }; } };
  const a = action();
  const cases = [
    [{ NEXUS_ECONOMY_RUNTIME_MODE: 'shadow' }, 'economy-runtime-not-active'],
    [{ NEXUS_ECONOMY_RUNTIME_ENABLED: 'false' }, 'economy-runtime-disabled'],
    [{ NEXUS_ECONOMY_AUTHORITY: 'arkshop' }, 'economy-authority-not-nexus'],
    [{ NEXUS_ECONOMY_PURCHASES_ENABLED: 'false' }, 'economy-purchases-disabled'],
    [{ NEXUS_ECONOMY_WORKER_CLAIM_ENABLED: 'false' }, 'purchase-worker-claim-disabled'],
    [{ NEXUS_ECONOMY_WORKER_DEBIT_ENABLED: 'false' }, 'purchase-worker-debit-disabled']
  ];
  for (const [override, reason] of cases) {
    const result = await createNexusEconomyPurchaseWorkerDebitExecutor({ mutationService, env: activeEnv(override) }).execute(a, claim(a));
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal(result.executionPermitted, false);
  }
  assert.equal(calls, 0);
});

test('treats a duplicate ledger result as successful idempotent replay', async () => {
  const a = action();
  const mutationService = { async spend() { return { ok: true, duplicate: true, balance: 700, transactionId: 42 }; } };
  const result = await createNexusEconomyPurchaseWorkerDebitExecutor({ mutationService, env: activeEnv() }).execute(a, claim(a));
  assert.equal(result.ok, true);
  assert.equal(result.debited, true);
  assert.equal(result.duplicate, true);
  assert.equal(result.reason, 'purchase-wallet-debit-already-applied');
  assert.equal(result.executionPermitted, false);
});

test('rejects failed or inconsistent wallet results and does not authorize fulfillment', async () => {
  const a = action();
  const cases = [
    [{ ok: false, reason: 'insufficient-funds', balance: 200 }, 'insufficient-funds'],
    [{ ok: true, duplicate: false, balance: 699, transactionId: 1 }, 'wallet-spend-balance-mismatch'],
    [{ ok: true, duplicate: 'no', balance: 700, transactionId: 1 }, 'wallet-spend-duplicate-state-invalid'],
    [{ ok: true, duplicate: false, balance: -1, transactionId: 1 }, 'wallet-spend-balance-invalid']
  ];
  for (const [walletResult, reason] of cases) {
    const mutationService = { async spend() { return walletResult; } };
    const result = await createNexusEconomyPurchaseWorkerDebitExecutor({ mutationService, env: activeEnv() }).execute(a, claim(a));
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal(result.executionPermitted, false);
  }
});
