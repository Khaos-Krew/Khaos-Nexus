'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createNexusEconomyPurchaseExecutionPlan } = require('../src/sentinel/nexus-economy-purchase-execution-plan.cjs');
const { createNexusEconomyPurchaseActionEnvelope } = require('../src/sentinel/nexus-economy-purchase-action-envelope.cjs');
const { createNexusEconomyPurchaseOutboxRecord } = require('../src/sentinel/nexus-economy-purchase-outbox-record.cjs');
const { createNexusEconomyPurchaseActionSubmitter } = require('../src/sentinel/nexus-economy-purchase-action-submit.cjs');

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

async function buildRecord() {
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

  const plan = await planner.prepare('123456789', 'coastal', {
    quantity: 2,
    requestId: 'discord_abc12345',
    expectedTotalPrice: 300
  });
  const envelope = createNexusEconomyPurchaseActionEnvelope().prepare(plan);
  return createNexusEconomyPurchaseOutboxRecord().prepare(envelope);
}

function activeEnv(overrides = {}) {
  return {
    NEXUS_ECONOMY_RUNTIME_MODE: 'active',
    NEXUS_ECONOMY_RUNTIME_ENABLED: 'true',
    NEXUS_ECONOMY_AUTHORITY: 'nexus',
    NEXUS_ECONOMY_PURCHASES_ENABLED: 'true',
    NEXUS_ECONOMY_ACTION_SUBMISSION_ENABLED: 'true',
    ...overrides
  };
}

test('submission is default-off and never calls ActionStore without the dedicated kill switch', async () => {
  const record = await buildRecord();
  let calls = 0;
  const actionStore = { request: async () => { calls += 1; throw new Error('must not be called'); } };
  const submitter = createNexusEconomyPurchaseActionSubmitter({
    actionStore,
    env: activeEnv({ NEXUS_ECONOMY_ACTION_SUBMISSION_ENABLED: 'false' })
  });

  const result = await submitter.submit(record);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'purchase-action-submission-disabled');
  assert.equal(result.executionPermitted, false);
  assert.equal(calls, 0);
});

test('persists only the verified ActionStore request and still forbids execution', async () => {
  const record = await buildRecord();
  const calls = [];
  const actionStore = {
    request: async (request) => {
      calls.push(request);
      return { ...request, status: 'requested', persisted: true };
    }
  };
  const result = await createNexusEconomyPurchaseActionSubmitter({ actionStore, env: activeEnv() }).submit(record);

  assert.equal(result.ok, true);
  assert.equal(result.submitted, true);
  assert.equal(result.persisted, true);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.reason, 'purchase-action-persisted');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].actionId, record.actionId);
  assert.equal(calls[0].idempotencyKey, record.orderId);
  assert.equal(calls[0].correlationId, record.requestId);
  assert.equal(calls[0].capability, 'economy.purchase.execute');
  assert.equal(calls[0].destructive, false);
  assert.equal(result.action.status, 'requested');
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.action), true);

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('wallet-debit'), false);
  assert.equal(serialized.includes('dino-cache-fulfillment'), false);
  assert.equal(serialized.includes('blueprint'), false);
  assert.equal(serialized.includes('rcon'), false);
  assert.equal(serialized.includes('sftp'), false);
});

test('fails closed before ActionStore for tampered records and inactive runtime gates', async () => {
  const record = await buildRecord();
  let calls = 0;
  const actionStore = { request: async () => { calls += 1; return {}; } };

  const tampered = await createNexusEconomyPurchaseActionSubmitter({ actionStore, env: activeEnv() })
    .submit({ ...record, payload: { ...record.payload, quantity: 3 } });
  assert.equal(tampered.ok, false);
  assert.equal(tampered.reason, 'record-digest-mismatch');

  const inactive = await createNexusEconomyPurchaseActionSubmitter({
    actionStore,
    env: activeEnv({ NEXUS_ECONOMY_RUNTIME_MODE: 'shadow' })
  }).submit(record);
  assert.equal(inactive.ok, false);
  assert.equal(inactive.reason, 'economy-runtime-not-active');
  assert.equal(calls, 0);
});

test('fails closed on ActionStore errors or mismatched durable records', async () => {
  const record = await buildRecord();

  const failed = await createNexusEconomyPurchaseActionSubmitter({
    env: activeEnv(),
    actionStore: {
      request: async () => {
        const error = new Error('database unavailable');
        error.code = 'ECONNRESET';
        throw error;
      }
    }
  }).submit(record);
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'action-store-request-failed');
  assert.equal(failed.errorCode, 'ECONNRESET');
  assert.equal(failed.executionPermitted, false);

  const mismatched = await createNexusEconomyPurchaseActionSubmitter({
    env: activeEnv(),
    actionStore: {
      request: async (request) => ({ ...request, actionId: 'action_wrong', status: 'requested', persisted: true })
    }
  }).submit(record);
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.reason, 'action-store-id-mismatch');
  assert.equal(mismatched.executionPermitted, false);
});

test('ActionStore disabled-mode response is explicit and cannot be mistaken for durable persistence', async () => {
  const record = await buildRecord();
  const submitter = createNexusEconomyPurchaseActionSubmitter({
    env: activeEnv(),
    actionStore: {
      request: async (request) => ({ ...request, status: 'requested', persisted: false })
    }
  });

  const result = await submitter.submit(record);
  assert.equal(result.ok, true);
  assert.equal(result.submitted, true);
  assert.equal(result.persisted, false);
  assert.equal(result.reason, 'purchase-action-submitted-without-persistence');
  assert.equal(result.executionPermitted, false);
});
