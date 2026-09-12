'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createNexusEconomyPurchaseWorkerIntake } = require('../src/sentinel/nexus-economy-purchase-worker-intake.cjs');
const { createNexusEconomyPurchaseWorkerClaimRequest } = require('../src/sentinel/nexus-economy-purchase-worker-claim-request.cjs');

function validAction(overrides = {}) {
  const planDigest = 'a'.repeat(64);
  const payload = {
    planId: 'plan_abc123',
    planDigest,
    discordUserId: '123456789',
    itemId: 'coastal',
    quantity: 2,
    currency: 'NEXUS_POINTS',
    totalPrice: 300,
    projectedBalance: 700
  };

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
      payload
    },
    ...overrides
  };
}

function ticketFor(action) {
  return createNexusEconomyPurchaseWorkerIntake().prepare(action).ticket;
}

test('creates deterministic compare-and-set claim request while keeping claim disabled', () => {
  const action = validAction();
  const ticket = ticketFor(action);
  const boundary = createNexusEconomyPurchaseWorkerClaimRequest();
  const first = boundary.prepare(action, ticket);
  const second = boundary.prepare(action, ticket);

  assert.equal(first.ok, true);
  assert.equal(first.claimReady, true);
  assert.equal(first.claimPermitted, false);
  assert.equal(first.executionPermitted, false);
  assert.equal(first.reason, 'purchase-worker-claim-request-ready');
  assert.equal(first.claimRequest.claimId, second.claimRequest.claimId);
  assert.equal(first.claimRequest.claimDigest, second.claimRequest.claimDigest);
  assert.deepEqual(first.claimRequest.compareAndSet, { expectedStatus: 'requested', nextStatus: 'running' });
  assert.equal(first.claimRequest.claimPermitted, false);
  assert.equal(first.claimRequest.executionPermitted, false);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.claimRequest), true);
  assert.equal(Object.isFrozen(first.claimRequest.compareAndSet), true);
});

test('revalidates the persisted action before producing a claim request', () => {
  const boundary = createNexusEconomyPurchaseWorkerClaimRequest();
  const base = validAction();
  const ticket = ticketFor(base);

  assert.equal(boundary.prepare(validAction({ persisted: false }), ticket).reason, 'action-not-persisted');
  assert.equal(boundary.prepare(validAction({ status: 'running' }), ticket).reason, 'action-not-requested');
  assert.equal(boundary.prepare(validAction({ destructive: true }), ticket).reason, 'unsafe-action-destructive-flag');
});

test('rejects stale or tampered worker tickets', () => {
  const action = validAction();
  const ticket = ticketFor(action);
  const boundary = createNexusEconomyPurchaseWorkerClaimRequest();

  assert.equal(boundary.prepare(action, { ...ticket, ticketId: 'worker_tampered' }).reason, 'worker-ticket-ticketId-mismatch');
  assert.equal(boundary.prepare(action, { ...ticket, intakeDigest: 'c'.repeat(64) }).reason, 'worker-ticket-intakeDigest-mismatch');
  assert.equal(boundary.prepare(action, { ...ticket, claimPermitted: true }).reason, 'unsafe-worker-ticket-flags');
});

test('claim request carries no execution transport or fulfillment internals', () => {
  const action = validAction();
  const result = createNexusEconomyPurchaseWorkerClaimRequest().prepare(action, ticketFor(action));
  const serialized = JSON.stringify(result);

  assert.equal(serialized.includes('wallet-debit'), false);
  assert.equal(serialized.includes('dino-cache-fulfillment'), false);
  assert.equal(serialized.includes('blueprint'), false);
  assert.equal(serialized.includes('rcon'), false);
  assert.equal(serialized.includes('sftp'), false);
  assert.equal(serialized.includes('command'), false);
});