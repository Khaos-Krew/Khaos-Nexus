'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createNexusEconomyPurchaseWorkerFulfillmentIntent } = require('../src/sentinel/nexus-economy-purchase-worker-fulfillment-intent.cjs');

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

function debit(a, overrides = {}) {
  return {
    ok: true,
    debited: true,
    duplicate: false,
    persisted: true,
    executionPermitted: false,
    actionId: a.actionId,
    debit: {
      operation: 'wallet-spend',
      discordUserId: '123456789',
      amount: 300,
      currency: 'Nexus Points',
      orderId: a.idempotencyKey,
      idempotencyKey: a.idempotencyKey,
      correlationId: a.correlationId,
      requestId: a.correlationId,
      transactionId: 42,
      balance: 700,
      duplicate: false,
      persisted: true,
      fulfillment: 'rewards-ascended-item',
      executionPermitted: false,
      ...overrides
    }
  };
}

function presence(overrides = {}) {
  return {
    ok: true,
    verified: true,
    online: true,
    discordUserId: '123456789',
    eosProductUserId: '0123456789abcdef0123456789abcdef',
    serverId: 'gen1',
    observedAt: '2026-09-12T23:00:00.000Z',
    ...overrides
  };
}

const fixedNow = () => Date.parse('2026-09-12T23:00:30.000Z');

test('builds a non-executable RewardsAscended fulfillment intent only after durable debit and fresh EOS presence', () => {
  const a = action();
  const result = createNexusEconomyPurchaseWorkerFulfillmentIntent({ now: fixedNow }).prepare(a, claim(a), debit(a), presence());

  assert.equal(result.ok, true);
  assert.equal(result.fulfillmentIntentReady, true);
  assert.equal(result.fulfillmentPermitted, false);
  assert.equal(result.executionPermitted, false);
  assert.deepEqual(result.fulfillmentIntent, {
    operation: 'rewards-ascended-item-fulfillment',
    fulfillment: 'rewards-ascended-item',
    actionId: a.actionId,
    orderId: a.idempotencyKey,
    idempotencyKey: a.idempotencyKey,
    correlationId: a.correlationId,
    requestId: a.correlationId,
    discordUserId: '123456789',
    eosProductUserId: '0123456789abcdef0123456789abcdef',
    serverId: 'gen1',
    itemId: 'metal-ingot',
    quantity: 2,
    debitTransactionId: 42,
    debitBalance: 700,
    presenceObservedAt: '2026-09-12T23:00:00.000Z',
    fulfillmentPermitted: false,
    executionPermitted: false
  });
  const serialized = JSON.stringify(result).toLowerCase();
  for (const forbidden of ['dino-cache', 'blueprint', 'ra.reward', 'rcon', 'sftp']) assert.equal(serialized.includes(forbidden), false);
});

test('fails closed when wallet debit proof is missing, mismatched, or unsafe', () => {
  const a = action();
  const builder = createNexusEconomyPurchaseWorkerFulfillmentIntent({ now: fixedNow });
  const cases = [
    [null, 'invalid-wallet-debit-proof'],
    [{ ...debit(a), persisted: false }, 'wallet-debit-not-persisted'],
    [{ ...debit(a), executionPermitted: true }, 'unsafe-wallet-debit-execution-flag'],
    [{ ...debit(a), actionId: 'action_other' }, 'wallet-debit-action-id-mismatch'],
    [debit(a, { amount: 301 }), 'wallet-debit-amount-mismatch'],
    [debit(a, { idempotencyKey: 'other' }), 'wallet-debit-idempotency-mismatch'],
    [debit(a, { fulfillment: 'dino-cache-fulfillment' }), 'wallet-debit-fulfillment-mismatch']
  ];
  for (const [proof, reason] of cases) {
    const result = builder.prepare(a, claim(a), proof, presence());
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal(result.executionPermitted, false);
  }
});

test('requires a fresh verified online EOS presence bound to the purchasing Discord user', () => {
  const a = action();
  const builder = createNexusEconomyPurchaseWorkerFulfillmentIntent({ now: fixedNow, maxPresenceAgeMs: 120000 });
  const cases = [
    [presence({ online: false }), 'player-not-verified-online'],
    [presence({ verified: false }), 'player-not-verified-online'],
    [presence({ discordUserId: '987654321' }), 'player-presence-user-mismatch'],
    [presence({ eosProductUserId: 'short' }), 'invalid-eos-product-user-id'],
    [presence({ serverId: 'bad server' }), 'invalid-player-server-id'],
    [presence({ observedAt: 'not-a-date' }), 'invalid-player-presence-time'],
    [presence({ observedAt: '2026-09-12T22:57:00.000Z' }), 'stale-player-presence']
  ];
  for (const [playerPresence, reason] of cases) {
    const result = builder.prepare(a, claim(a), debit(a), playerPresence);
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal(result.fulfillmentPermitted, false);
    assert.equal(result.executionPermitted, false);
  }
});
