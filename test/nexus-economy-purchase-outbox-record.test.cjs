'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createNexusEconomyPurchaseExecutionPlan } = require('../src/sentinel/nexus-economy-purchase-execution-plan.cjs');
const { createNexusEconomyPurchaseActionEnvelope } = require('../src/sentinel/nexus-economy-purchase-action-envelope.cjs');
const { createNexusEconomyPurchaseOutboxRecord } = require('../src/sentinel/nexus-economy-purchase-outbox-record.cjs');

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

async function buildEnvelope() {
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

  return createNexusEconomyPurchaseActionEnvelope().prepare(plan);
}

test('creates a deterministic immutable outbox record without enabling persistence or execution', async () => {
  const envelope = await buildEnvelope();
  const boundary = createNexusEconomyPurchaseOutboxRecord();
  const first = boundary.prepare(envelope);
  const second = boundary.prepare(envelope);

  assert.deepEqual(first, second);
  assert.equal(first.ok, true);
  assert.equal(first.recordReady, true);
  assert.equal(first.persistPermitted, false);
  assert.equal(first.queueWritePermitted, false);
  assert.equal(first.executionPermitted, false);
  assert.match(first.recordId, /^outbox_[a-f0-9]{24}$/);
  assert.match(first.recordDigest, /^[a-f0-9]{64}$/);
  assert.equal(first.actionId, envelope.actionId);
  assert.equal(first.idempotencyKey, envelope.orderId);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.payload), true);
});

test('rejects tampered action identity and correlation fields', async () => {
  const envelope = await buildEnvelope();
  const boundary = createNexusEconomyPurchaseOutboxRecord();

  const badAction = boundary.prepare({ ...envelope, actionId: 'action_deadbeefdeadbeefdeadbeef' });
  const badCorrelation = boundary.prepare({ ...envelope, correlationId: 'discord_other123' });

  assert.equal(badAction.ok, false);
  assert.equal(badAction.reason, 'action-id-mismatch');
  assert.equal(badCorrelation.ok, false);
  assert.equal(badCorrelation.reason, 'correlation-id-mismatch');
  assert.equal(badAction.persistPermitted, false);
  assert.equal(badCorrelation.queueWritePermitted, false);
});

test('rejects unsafe or execution-enabled envelopes', async () => {
  const envelope = await buildEnvelope();
  const boundary = createNexusEconomyPurchaseOutboxRecord();

  const queueEnabled = boundary.prepare({ ...envelope, queueWritePermitted: true });
  const executionEnabled = boundary.prepare({ ...envelope, executionPermitted: true });

  assert.equal(queueEnabled.ok, false);
  assert.equal(queueEnabled.reason, 'unsafe-action-envelope-flags');
  assert.equal(executionEnabled.ok, false);
  assert.equal(executionEnabled.reason, 'unsafe-action-envelope-flags');
});

test('outbox record strips execution internals and remains player-safe', async () => {
  const envelope = await buildEnvelope();
  const result = createNexusEconomyPurchaseOutboxRecord().prepare(envelope);
  const serialized = JSON.stringify(result);

  assert.equal(serialized.includes('wallet-debit'), false);
  assert.equal(serialized.includes('dino-cache-fulfillment'), false);
  assert.equal(serialized.includes('operations'), false);
  assert.equal(serialized.includes('blueprint'), false);
  assert.equal(serialized.includes('rcon'), false);
  assert.equal(serialized.includes('sftp'), false);
});

test('outbox preparation performs no database, filesystem, Discord, ARK, RCON, SFTP, persistence, or queue I/O', async () => {
  const envelope = await buildEnvelope();
  const boundary = createNexusEconomyPurchaseOutboxRecord();

  const result = boundary.prepare(envelope);
  assert.equal(result.ok, true);
  assert.equal(result.persistPermitted, false);
  assert.equal(result.queueWritePermitted, false);
  assert.equal(result.executionPermitted, false);
});
