'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createNexusEconomyPurchaseWorkerIntake } = require('../src/sentinel/nexus-economy-purchase-worker-intake.cjs');

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

test('creates deterministic inert worker intake from a persisted requested purchase action', () => {
  const intake = createNexusEconomyPurchaseWorkerIntake();
  const first = intake.prepare(validAction());
  const second = intake.prepare(validAction());

  assert.equal(first.ok, true);
  assert.equal(first.intakeReady, true);
  assert.equal(first.claimPermitted, false);
  assert.equal(first.executionPermitted, false);
  assert.equal(first.reason, 'purchase-worker-intake-ready');
  assert.equal(first.ticket.ticketId, second.ticket.ticketId);
  assert.equal(first.ticket.intakeDigest, second.ticket.intakeDigest);
  assert.equal(first.ticket.claimPermitted, false);
  assert.equal(first.ticket.executionPermitted, false);
  assert.equal(first.ticket.idempotencyKey, 'shop_discord_abc12345');
  assert.equal(first.ticket.correlationId, 'discord_abc12345');
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.ticket), true);
  assert.equal(Object.isFrozen(first.ticket.payload), true);
});

test('rejects non-persisted, already-transitioned, destructive, or wrong-capability actions', () => {
  const intake = createNexusEconomyPurchaseWorkerIntake();

  assert.equal(intake.prepare(validAction({ persisted: false })).reason, 'action-not-persisted');
  assert.equal(intake.prepare(validAction({ status: 'running' })).reason, 'action-not-requested');
  assert.equal(intake.prepare(validAction({ destructive: true })).reason, 'unsafe-action-destructive-flag');
  assert.equal(intake.prepare(validAction({ capability: 'ark.rcon.execute' })).reason, 'unexpected-action-capability');
});

test('rejects identity and payload tampering before worker claim', () => {
  const intake = createNexusEconomyPurchaseWorkerIntake();

  const wrongCorrelation = validAction({ correlationId: 'discord_other' });
  assert.equal(intake.prepare(wrongCorrelation).reason, 'correlation-id-mismatch');

  const wrongSubject = validAction({ subject: 'discord-user:999999999', actor: 'discord-user:999999999' });
  assert.equal(intake.prepare(wrongSubject).reason, 'subject-mismatch');

  const wrongPayload = validAction();
  wrongPayload.request = { ...wrongPayload.request, payload: { ...wrongPayload.request.payload, quantity: 26 } };
  assert.equal(intake.prepare(wrongPayload).reason, 'invalid-quantity');

  const wrongPlanDigest = validAction();
  wrongPlanDigest.request = { ...wrongPlanDigest.request, payload: { ...wrongPlanDigest.request.payload, planDigest: 'c'.repeat(64) } };
  assert.equal(intake.prepare(wrongPlanDigest).reason, 'action-id-mismatch');
});

test('worker ticket contains no execution transport or fulfillment internals', () => {
  const result = createNexusEconomyPurchaseWorkerIntake().prepare(validAction());
  const serialized = JSON.stringify(result);

  assert.equal(serialized.includes('wallet-debit'), false);
  assert.equal(serialized.includes('dino-cache-fulfillment'), false);
  assert.equal(serialized.includes('blueprint'), false);
  assert.equal(serialized.includes('rcon'), false);
  assert.equal(serialized.includes('sftp'), false);
  assert.equal(serialized.includes('command'), false);
});
