'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createNexusEconomyRewardsTransportPreflight } = require('../src/sentinel/nexus-economy-rewards-transport-preflight.cjs');

function envelope(overrides = {}) {
  return {
    schemaVersion: 1,
    operation: 'rewards-ascended-item-delivery',
    fulfillment: 'rewards-ascended-item',
    actionId: 'action_aaaaaaaaaaaaaaaaaaaaaaaa',
    orderId: 'shop_discord_abc12345',
    idempotencyKey: 'shop_discord_abc12345',
    correlationId: 'discord_abc12345',
    requestId: 'discord_abc12345',
    discordUserId: '123456789',
    eosProductUserId: '0123456789abcdef0123456789abcdef',
    serverId: 'gen1',
    itemId: 'metal-ingot',
    itemKind: 'item',
    blueprint: '/Game/PrimalEarth/CoreBlueprints/Resources/PrimalItemResource_MetalIngot.PrimalItemResource_MetalIngot',
    bundleQuantity: 2,
    baseQuantity: 100,
    totalItemQuantity: 200,
    debitTransactionId: 42,
    debitBalance: 700,
    presenceObservedAt: '2026-09-12T23:00:00.000Z',
    transport: 'rewards-ascended',
    command: null,
    fulfillmentPermitted: false,
    executionPermitted: false,
    ...overrides
  };
}

function capability(overrides = {}) {
  return {
    transport: 'rewards-ascended',
    verified: true,
    itemDeliverySupported: true,
    identityMode: 'eos-product-user-id',
    commandSyntaxVerified: true,
    transportWriteVerified: true,
    verificationSource: 'verified RewardsAscended adapter contract',
    ...overrides
  };
}

test('produces a non-executable transport plan only from a verified RewardsAscended capability', () => {
  const result = createNexusEconomyRewardsTransportPreflight().prepare(envelope(), capability());

  assert.equal(result.ok, true);
  assert.equal(result.transportReady, true);
  assert.equal(result.commandConstructionPermitted, false);
  assert.equal(result.fulfillmentPermitted, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.transportPlan.operation, 'rewards-ascended-item-transport-preflight');
  assert.equal(result.transportPlan.orderId, 'shop_discord_abc12345');
  assert.equal(result.transportPlan.idempotencyKey, 'shop_discord_abc12345');
  assert.equal(result.transportPlan.eosProductUserId, '0123456789abcdef0123456789abcdef');
  assert.equal(result.transportPlan.totalItemQuantity, 200);
  assert.equal(result.transportPlan.command, null);
  assert.equal(result.transportPlan.commandConstructionPermitted, false);
  assert.equal(result.transportPlan.fulfillmentPermitted, false);
  assert.equal(result.transportPlan.executionPermitted, false);
});

test('fails closed if the RewardsAscended transport contract is not fully verified', () => {
  const preflight = createNexusEconomyRewardsTransportPreflight();
  const cases = [
    [null, 'missing-rewards-transport-capability'],
    [capability({ verified: false }), 'rewards-transport-not-verified'],
    [capability({ itemDeliverySupported: false }), 'rewards-item-delivery-not-supported'],
    [capability({ identityMode: 'steam-id' }), 'rewards-identity-mode-mismatch'],
    [capability({ commandSyntaxVerified: false }), 'rewards-command-syntax-not-verified'],
    [capability({ transportWriteVerified: false }), 'rewards-transport-write-not-verified'],
    [capability({ verificationSource: '' }), 'missing-rewards-verification-source']
  ];

  for (const [candidate, reason] of cases) {
    const result = preflight.prepare(envelope(), candidate);
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal(result.commandConstructionPermitted, false);
    assert.equal(result.fulfillmentPermitted, false);
    assert.equal(result.executionPermitted, false);
  }
});

test('rejects tampered delivery identity, Dino Cache substitution, and preconstructed commands', () => {
  const preflight = createNexusEconomyRewardsTransportPreflight();
  const cases = [
    [envelope({ operation: 'dino-cache-delivery' }), 'delivery-operation-mismatch'],
    [envelope({ fulfillment: 'dino-cache-fulfillment' }), 'delivery-fulfillment-mismatch'],
    [envelope({ transport: 'rcon' }), 'delivery-transport-mismatch'],
    [envelope({ command: 'unsafe command' }), 'unsafe-preconstructed-delivery-command'],
    [envelope({ fulfillmentPermitted: true }), 'unsafe-delivery-envelope-flags'],
    [envelope({ executionPermitted: true }), 'unsafe-delivery-envelope-flags'],
    [envelope({ idempotencyKey: 'different-order' }), 'delivery-idempotency-mismatch'],
    [envelope({ correlationId: 'different-request' }), 'delivery-correlation-mismatch'],
    [envelope({ itemKind: 'dino' }), 'unsupported-delivery-item-kind']
  ];

  for (const [candidate, reason] of cases) {
    const result = preflight.prepare(candidate, capability());
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal(result.transportReady, false);
    assert.equal(result.executionPermitted, false);
  }
});
