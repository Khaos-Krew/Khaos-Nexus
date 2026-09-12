'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createNexusEconomyPurchaseWorkerIntake } = require('../src/sentinel/nexus-economy-purchase-worker-intake.cjs');
const { createNexusEconomyPurchaseWorkerClaimRequest } = require('../src/sentinel/nexus-economy-purchase-worker-claim-request.cjs');
const { createNexusEconomyPurchaseWorkerClaimCommand } = require('../src/sentinel/nexus-economy-purchase-worker-claim-command.cjs');

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

test('creates a deterministic ActionStore CAS command description while refusing persistence and execution', () => {
  const action = validAction();
  const { ticket, claim } = materialFor(action);
  const boundary = createNexusEconomyPurchaseWorkerClaimCommand({ env: enabledEnv() });
  const first = boundary.prepare(action, ticket, claim);
  const second = boundary.prepare(action, ticket, claim);

  assert.deepEqual(first, second);
  assert.equal(first.ok, true);
  assert.equal(first.commandReady, true);
  assert.equal(first.claimPermitted, false);
  assert.equal(first.executionPermitted, false);
  assert.equal(first.reason, 'purchase-worker-claim-command-ready-but-disabled');
  assert.equal(first.command.operation, 'action-store.compare-and-set-status');
  assert.equal(first.command.actionId, action.actionId);
  assert.equal(first.command.expectedStatus, 'requested');
  assert.equal(first.command.nextStatus, 'running');
  assert.equal(first.command.persistPermitted, false);
  assert.equal(first.command.claimPermitted, false);
  assert.equal(first.command.executionPermitted, false);
  assert.equal(first.command.destructive, false);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.command), true);
});

test('fails closed before command creation when authorization gates are disabled', () => {
  const action = validAction();
  const { ticket, claim } = materialFor(action);
  const result = createNexusEconomyPurchaseWorkerClaimCommand({
    env: enabledEnv({ NEXUS_ECONOMY_WORKER_CLAIMS_ENABLED: 'false' })
  }).prepare(action, ticket, claim);

  assert.equal(result.ok, false);
  assert.equal(result.commandReady, false);
  assert.equal(result.claimPermitted, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.reason, 'economy-worker-claims-disabled');
  assert.equal(result.command, null);
});

test('rejects tampered and stale claim material instead of projecting a command', () => {
  const action = validAction();
  const { ticket, claim } = materialFor(action);
  const boundary = createNexusEconomyPurchaseWorkerClaimCommand({ env: enabledEnv() });

  assert.equal(boundary.prepare(action, ticket, { ...claim, claimDigest: 'c'.repeat(64) }).ok, false);
  assert.equal(boundary.prepare(validAction({ status: 'running' }), ticket, claim).ok, false);
});

test('command contains no wallet, fulfillment, RCON, SFTP, SQL, blueprint, or queue internals', () => {
  const action = validAction();
  const { ticket, claim } = materialFor(action);
  const serialized = JSON.stringify(
    createNexusEconomyPurchaseWorkerClaimCommand({ env: enabledEnv() }).prepare(action, ticket, claim)
  );

  for (const forbidden of ['wallet-debit', 'dino-cache-fulfillment', 'blueprint', 'rcon', 'sftp', 'sql', 'queue']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
