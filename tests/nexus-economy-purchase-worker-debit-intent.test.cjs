'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createNexusEconomyPurchaseWorkerDebitIntent } = require('../src/sentinel/nexus-economy-purchase-worker-debit-intent.cjs');

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

function claim(a, overrides = {}) {
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
    },
    ...overrides
  };
}

test('projects a claimed Cluster Shop purchase into a non-executable idempotent wallet spend intent', () => {
  const a = action();
  const result = createNexusEconomyPurchaseWorkerDebitIntent().prepare(a, claim(a));
  assert.equal(result.ok, true);
  assert.equal(result.debitIntentReady, true);
  assert.equal(result.debitPermitted, false);
  assert.equal(result.executionPermitted, false);
  assert.deepEqual(result.debitIntent, {
    operation: 'wallet-spend',
    discordUserId: '123456789',
    amount: 300,
    currency: 'Nexus Points',
    orderId: 'shop_discord_abc12345',
    idempotencyKey: 'shop_discord_abc12345',
    correlationId: 'discord_abc12345',
    requestId: 'discord_abc12345',
    actionId: a.actionId,
    expectedProjectedBalance: 700,
    debitPermitted: false,
    executionPermitted: false
  });
  const serialized = JSON.stringify(result).toLowerCase();
  for (const forbidden of ['dino-cache', 'blueprint', 'ra.reward', 'rcon', 'sftp']) assert.equal(serialized.includes(forbidden), false);
});

test('fails closed unless the action is durably running under the exact atomic claim proof', () => {
  const a = action();
  const cases = [
    [claim(a, { claimed: false }), 'purchase-not-durably-claimed'],
    [claim(a, { persisted: false }), 'purchase-not-durably-claimed'],
    [claim(a, { executionPermitted: true }), 'unsafe-claim-execution-flag'],
    [claim(a, { claim: { ...claim(a).claim, attempt: 2 } }), 'claim-state-mismatch'],
    [claim(a, { claim: { ...claim(a).claim, idempotencyKey: 'other-order' } }), 'claim-idempotency-mismatch'],
    [claim(a, { claim: { ...claim(a).claim, fulfillment: 'dino-cache-fulfillment' } }), 'claim-fulfillment-mismatch']
  ];
  for (const [proof, reason] of cases) {
    const result = createNexusEconomyPurchaseWorkerDebitIntent().prepare(a, proof);
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal(result.debitPermitted, false);
    assert.equal(result.executionPermitted, false);
  }
});

test('binds spend identity and amount to the claimed purchase payload', () => {
  const a = action();
  const cases = [
    [{ ...a, subject: 'discord-user:987654321' }, 'purchase-subject-mismatch'],
    [{ ...a, request: { ...a.request, orderId: 'other-order' } }, 'request-order-id-mismatch'],
    [{ ...a, request: { ...a.request, requestId: 'other-request' } }, 'request-correlation-id-mismatch'],
    [{ ...a, request: { ...a.request, payload: { ...a.request.payload, currency: 'Dino Cache Tokens' } } }, 'invalid-wallet-currency'],
    [{ ...a, request: { ...a.request, payload: { ...a.request.payload, totalPrice: 0 } } }, 'invalid-total-price'],
    [{ ...a, request: { ...a.request, payload: { ...a.request.payload, projectedBalance: -1 } } }, 'invalid-projected-balance']
  ];
  for (const [mutated, reason] of cases) {
    const result = createNexusEconomyPurchaseWorkerDebitIntent().prepare(mutated, claim(mutated));
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
  }
});
