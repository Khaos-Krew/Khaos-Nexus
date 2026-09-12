'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createNexusEconomyPurchaseWorkerIntake } = require('../src/sentinel/nexus-economy-purchase-worker-intake.cjs');
const { createNexusEconomyPurchaseWorkerClaimRequest } = require('../src/sentinel/nexus-economy-purchase-worker-claim-request.cjs');
const { createNexusEconomyPurchaseWorkerClaimSubmitter } = require('../src/sentinel/nexus-economy-purchase-worker-claim-submit.cjs');

function validAction(overrides = {}) {
  const planDigest = 'a'.repeat(64);
  return {
    actionId: `action_${planDigest.slice(0, 24)}`,
    capability: 'economy.purchase.execute',
    source: 'sentinel-v2.economy.purchase',
    actor: 'discord-user:123456789',
    subject: 'discord-user:123456789',
    destructive: false,
    idempotencyKey: 'shop_discord_abc12345',
    correlationId: 'discord_abc12345',
    status: 'requested',
    persisted: true,
    request: {
      schemaVersion: 1,
      type: 'nexus.economy.purchase',
      recordId: 'outbox_abc123',
      recordDigest: 'b'.repeat(64),
      requestId: 'discord_abc12345',
      orderId: 'shop_discord_abc12345',
      planId: 'plan_abc123',
      payload: {
        planId: 'plan_abc123',
        planDigest,
        discordUserId: '123456789',
        itemId: 'coastal',
        quantity: 2,
        currency: 'NEXUS_POINTS',
        totalPrice: 300,
        projectedBalance: 700
      }
    },
    ...overrides
  };
}

function materialFor(action) {
  const ticket = createNexusEconomyPurchaseWorkerIntake().prepare(action).ticket;
  const claim = createNexusEconomyPurchaseWorkerClaimRequest().prepare(action, ticket).claimRequest;
  return { ticket, claim };
}

function enabledEnv(overrides = {}) {
  return {
    NEXUS_ECONOMY_RUNTIME_MODE: 'active',
    NEXUS_ECONOMY_RUNTIME_ENABLED: 'true',
    NEXUS_ECONOMY_AUTHORITY: 'nexus',
    NEXUS_ECONOMY_MUTATIONS_ENABLED: 'true',
    NEXUS_ECONOMY_PURCHASES_ENABLED: 'true',
    NEXUS_ECONOMY_ACTION_SUBMISSION_ENABLED: 'true',
    NEXUS_ECONOMY_WORKER_CLAIMS_ENABLED: 'true',
    NEXUS_ECONOMY_WORKER_CAS_SUBMISSION_ENABLED: 'true',
    ...overrides
  };
}

function claimedFrom(request, overrides = {}) {
  return {
    actionId: request.actionId,
    status: request.nextStatus,
    idempotencyKey: request.idempotencyKey,
    correlationId: request.correlationId,
    subject: request.subject,
    persisted: true,
    ...overrides
  };
}

test('claim persistence is default-off and makes zero ActionStore calls without its dedicated gate', async () => {
  const action = validAction();
  const { ticket, claim } = materialFor(action);
  let calls = 0;
  const actionStore = {
    compareAndSetStatus: async () => {
      calls += 1;
      throw new Error('must not be called');
    }
  };

  const result = await createNexusEconomyPurchaseWorkerClaimSubmitter({
    actionStore,
    env: enabledEnv({ NEXUS_ECONOMY_WORKER_CAS_SUBMISSION_ENABLED: 'false' })
  }).claim(action, ticket, claim);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'economy-worker-cas-submission-disabled');
  assert.equal(result.executionPermitted, false);
  assert.equal(calls, 0);
});

test('persists only the verified requested-to-running CAS and still forbids execution', async () => {
  const action = validAction();
  const { ticket, claim } = materialFor(action);
  const calls = [];
  const actionStore = {
    compareAndSetStatus: async (request) => {
      calls.push(request);
      return claimedFrom(request);
    }
  };

  const result = await createNexusEconomyPurchaseWorkerClaimSubmitter({
    actionStore,
    env: enabledEnv()
  }).claim(action, ticket, claim);

  assert.equal(result.ok, true);
  assert.equal(result.claimed, true);
  assert.equal(result.persisted, true);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.reason, 'purchase-worker-action-claimed');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].actionId, action.actionId);
  assert.equal(calls[0].expectedStatus, 'requested');
  assert.equal(calls[0].nextStatus, 'running');
  assert.equal(calls[0].idempotencyKey, action.idempotencyKey);
  assert.equal(calls[0].correlationId, action.correlationId);
  assert.equal(calls[0].subject, action.subject);
  assert.equal(typeof calls[0].claimId, 'string');
  assert.equal(typeof calls[0].claimDigest, 'string');
  assert.equal(Object.isFrozen(calls[0]), true);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.action), true);
});

test('fails closed before ActionStore when upstream authorization rejects stale or tampered claim material', async () => {
  const action = validAction();
  const { ticket, claim } = materialFor(action);
  let calls = 0;
  const actionStore = {
    compareAndSetStatus: async () => {
      calls += 1;
      return {};
    }
  };
  const submitter = createNexusEconomyPurchaseWorkerClaimSubmitter({ actionStore, env: enabledEnv() });

  const tampered = await submitter.claim(action, ticket, { ...claim, claimDigest: 'c'.repeat(64) });
  assert.equal(tampered.ok, false);

  const stale = await submitter.claim(validAction({ status: 'running' }), ticket, claim);
  assert.equal(stale.ok, false);
  assert.equal(calls, 0);
});

test('fails closed when ActionStore has no CAS primitive or the CAS call throws', async () => {
  const action = validAction();
  const { ticket, claim } = materialFor(action);

  const unavailable = await createNexusEconomyPurchaseWorkerClaimSubmitter({
    actionStore: {},
    env: enabledEnv()
  }).claim(action, ticket, claim);
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.reason, 'action-store-cas-unavailable');

  const failed = await createNexusEconomyPurchaseWorkerClaimSubmitter({
    actionStore: {
      compareAndSetStatus: async () => {
        const error = new Error('database unavailable');
        error.code = 'ECONNRESET';
        throw error;
      }
    },
    env: enabledEnv()
  }).claim(action, ticket, claim);
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'action-store-cas-failed');
  assert.equal(failed.errorCode, 'ECONNRESET');
  assert.equal(failed.executionPermitted, false);
});

test('rejects stale or mismatched durable claim results instead of allowing execution', async () => {
  const action = validAction();
  const { ticket, claim } = materialFor(action);

  for (const mutate of [
    (request) => claimedFrom(request, { actionId: 'action_wrong' }),
    (request) => claimedFrom(request, { status: 'requested' }),
    (request) => claimedFrom(request, { idempotencyKey: 'wrong' }),
    (request) => claimedFrom(request, { correlationId: 'wrong' }),
    (request) => claimedFrom(request, { subject: 'discord-user:wrong' }),
    (request) => claimedFrom(request, { persisted: false })
  ]) {
    const result = await createNexusEconomyPurchaseWorkerClaimSubmitter({
      actionStore: { compareAndSetStatus: async (request) => mutate(request) },
      env: enabledEnv()
    }).claim(action, ticket, claim);
    assert.equal(result.ok, false);
    assert.equal(result.executionPermitted, false);
  }
});

test('CAS request and result contain no wallet, fulfillment, RCON, SFTP, SQL, blueprint, or queue internals', async () => {
  const action = validAction();
  const { ticket, claim } = materialFor(action);
  let captured = null;

  const result = await createNexusEconomyPurchaseWorkerClaimSubmitter({
    actionStore: {
      compareAndSetStatus: async (request) => {
        captured = request;
        return claimedFrom(request);
      }
    },
    env: enabledEnv()
  }).claim(action, ticket, claim);

  const serialized = JSON.stringify({ request: captured, result });
  for (const forbidden of ['wallet-debit', 'dino-cache-fulfillment', 'blueprint', 'rcon', 'sftp', 'sql', 'queue']) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.equal(result.executionPermitted, false);
});
