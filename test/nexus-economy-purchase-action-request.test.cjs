'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createNexusEconomyPurchaseExecutionPlan } = require('../src/sentinel/nexus-economy-purchase-execution-plan.cjs');
const { createNexusEconomyPurchaseActionEnvelope } = require('../src/sentinel/nexus-economy-purchase-action-envelope.cjs');
const { createNexusEconomyPurchaseOutboxRecord } = require('../src/sentinel/nexus-economy-purchase-outbox-record.cjs');
const { ACTION_SOURCE, createNexusEconomyPurchaseActionRequest } = require('../src/sentinel/nexus-economy-purchase-action-request.cjs');

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

test('projects a validated outbox record into the existing ActionStore request contract without submitting it', async () => {
  const record = await buildRecord();
  const boundary = createNexusEconomyPurchaseActionRequest();
  const result = boundary.prepare(record);

  assert.equal(result.ok, true);
  assert.equal(result.requestReady, true);
  assert.equal(result.submitPermitted, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.actionId, record.actionId);
  assert.equal(result.recordId, record.recordId);
  assert.equal(result.actionRequest.actionId, record.actionId);
  assert.equal(result.actionRequest.capability, 'economy.purchase.execute');
  assert.equal(result.actionRequest.source, ACTION_SOURCE);
  assert.equal(result.actionRequest.actor, 'discord-user:123456789');
  assert.equal(result.actionRequest.subject, 'discord-user:123456789');
  assert.equal(result.actionRequest.destructive, false);
  assert.equal(result.actionRequest.idempotencyKey, record.orderId);
  assert.equal(result.actionRequest.correlationId, record.requestId);
  assert.equal(result.actionRequest.request.recordId, record.recordId);
  assert.equal(result.actionRequest.request.recordDigest, record.recordDigest);
  assert.deepEqual(result.actionRequest.request.payload, record.payload);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.actionRequest), true);
  assert.equal(Object.isFrozen(result.actionRequest.request), true);
  assert.equal(Object.isFrozen(result.actionRequest.request.payload), true);
});

test('projection is deterministic and retains the stable ActionStore idempotency key', async () => {
  const record = await buildRecord();
  const boundary = createNexusEconomyPurchaseActionRequest();
  const first = boundary.prepare(record);
  const second = boundary.prepare(record);

  assert.deepEqual(first, second);
  assert.equal(first.actionRequest.idempotencyKey, record.idempotencyKey);
  assert.equal(first.actionRequest.idempotencyKey, record.orderId);
});

test('rejects record digest, record id, and purchase payload tampering', async () => {
  const record = await buildRecord();
  const boundary = createNexusEconomyPurchaseActionRequest();

  const badDigest = boundary.prepare({ ...record, recordDigest: '0'.repeat(64) });
  const badId = boundary.prepare({ ...record, recordId: 'outbox_deadbeefdeadbeefdeadbeef' });
  const badPayload = boundary.prepare({ ...record, payload: { ...record.payload, quantity: 3 } });

  assert.equal(badDigest.ok, false);
  assert.equal(badDigest.reason, 'record-digest-mismatch');
  assert.equal(badId.ok, false);
  assert.equal(badId.reason, 'record-id-mismatch');
  assert.equal(badPayload.ok, false);
  assert.equal(badPayload.reason, 'record-digest-mismatch');
  assert.equal(badDigest.submitPermitted, false);
  assert.equal(badId.executionPermitted, false);
});

test('rejects any outbox record that enables persistence, queue writing, or execution', async () => {
  const record = await buildRecord();
  const boundary = createNexusEconomyPurchaseActionRequest();

  for (const flag of ['persistPermitted', 'queueWritePermitted', 'executionPermitted']) {
    const result = boundary.prepare({ ...record, [flag]: true });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unsafe-outbox-record-flags');
    assert.equal(result.submitPermitted, false);
    assert.equal(result.executionPermitted, false);
  }
});

test('projection does not invoke ActionStore, database, queue, Discord, ARK, RCON, SFTP, or filesystem side effects', async () => {
  const record = await buildRecord();
  let actionStoreCalls = 0;
  const actionStore = {
    request: async () => {
      actionStoreCalls += 1;
      throw new Error('ActionStore must not be called by projection');
    }
  };

  const result = createNexusEconomyPurchaseActionRequest({ actionStore }).prepare(record);

  assert.equal(result.ok, true);
  assert.equal(result.submitPermitted, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(actionStoreCalls, 0);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('wallet-debit'), false);
  assert.equal(serialized.includes('dino-cache-fulfillment'), false);
  assert.equal(serialized.includes('blueprint'), false);
  assert.equal(serialized.includes('rcon'), false);
  assert.equal(serialized.includes('sftp'), false);
});
