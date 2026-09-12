'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createNexusEconomyPurchaseWorkerIntake } = require('../src/sentinel/nexus-economy-purchase-worker-intake.cjs');
const { createNexusEconomyPurchaseWorkerClaimRequest } = require('../src/sentinel/nexus-economy-purchase-worker-claim-request.cjs');
const { createNexusEconomyPurchaseWorkerClaimAuthorization } = require('../src/sentinel/nexus-economy-purchase-worker-claim-authorization.cjs');

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
    NEXUS_ECONOMY_AUTHORITY: 'nexus',
    NEXUS_ECONOMY_MUTATIONS_ENABLED: 'true',
    NEXUS_ECONOMY_PURCHASES_ENABLED: 'true',
    NEXUS_ECONOMY_ACTION_SUBMISSION_ENABLED: 'true',
    NEXUS_ECONOMY_WORKER_CLAIMS_ENABLED: 'true',
    ...overrides
  };
}

test('authorizes a fresh claim description but still refuses claim execution', () => {
  const action = validAction();
  const { ticket, claim } = materialFor(action);
  const result = createNexusEconomyPurchaseWorkerClaimAuthorization({ env: enabledEnv() })
    .authorize(action, ticket, claim);

  assert.equal(result.ok, true);
  assert.equal(result.claimReady, true);
  assert.equal(result.claimAuthorized, true);
  assert.equal(result.claimPermitted, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.reason, 'purchase-worker-claim-authorized-but-disabled');
  assert.equal(result.authorization.actionId, action.actionId);
  assert.equal(result.authorization.claimId, claim.claimId);
  assert.equal(result.authorization.claimPermitted, false);
  assert.equal(result.authorization.executionPermitted, false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.authorization), true);
});

test('fails closed unless every economy and worker-claim gate is explicitly enabled', () => {
  const action = validAction();
  const { ticket, claim } = materialFor(action);
  const cases = [
    [{ ...enabledEnv(), NEXUS_ECONOMY_RUNTIME_MODE: 'shadow' }, 'economy-runtime-not-active'],
    [{ ...enabledEnv(), NEXUS_ECONOMY_AUTHORITY: 'legacy' }, 'economy-authority-not-nexus'],
    [{ ...enabledEnv(), NEXUS_ECONOMY_MUTATIONS_ENABLED: 'false' }, 'economy-mutations-disabled'],
    [{ ...enabledEnv(), NEXUS_ECONOMY_PURCHASES_ENABLED: 'false' }, 'economy-purchases-disabled'],
    [{ ...enabledEnv(), NEXUS_ECONOMY_ACTION_SUBMISSION_ENABLED: 'false' }, 'economy-action-submission-disabled'],
    [{ ...enabledEnv(), NEXUS_ECONOMY_WORKER_CLAIMS_ENABLED: 'false' }, 'economy-worker-claims-disabled']
  ];

  for (const [env, reason] of cases) {
    const result = createNexusEconomyPurchaseWorkerClaimAuthorization({ env }).authorize(action, ticket, claim);
    assert.equal(result.ok, false);
    assert.equal(result.claimPermitted, false);
    assert.equal(result.executionPermitted, false);
    assert.equal(result.reason, reason);
  }
});

test('rejects tampered or stale claim material before authorization', () => {
  const action = validAction();
  const { ticket, claim } = materialFor(action);
  const boundary = createNexusEconomyPurchaseWorkerClaimAuthorization({ env: enabledEnv() });

  assert.equal(boundary.authorize(action, ticket, { ...claim, claimId: 'claim_tampered' }).reason, 'worker-claim-claimId-mismatch');
  assert.equal(boundary.authorize(action, ticket, { ...claim, claimDigest: 'c'.repeat(64) }).reason, 'worker-claim-claimDigest-mismatch');
  assert.equal(boundary.authorize(action, ticket, { ...claim, compareAndSet: { expectedStatus: 'running', nextStatus: 'running' } }).reason, 'worker-claim-compare-and-set-mismatch');
  assert.equal(boundary.authorize(validAction({ status: 'running' }), ticket, claim).reason, 'action-not-requested');
});

test('authorization contains no wallet, fulfillment, RCON, SFTP, command, or transport internals', () => {
  const action = validAction();
  const { ticket, claim } = materialFor(action);
  const serialized = JSON.stringify(
    createNexusEconomyPurchaseWorkerClaimAuthorization({ env: enabledEnv() }).authorize(action, ticket, claim)
  );

  for (const forbidden of ['wallet-debit', 'dino-cache-fulfillment', 'blueprint', 'rcon', 'sftp', 'command', 'sql']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
