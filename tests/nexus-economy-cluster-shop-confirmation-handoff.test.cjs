'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createNexusClusterShopConfirmationHandoff } = require('../src/sentinel/nexus-economy-cluster-shop-confirmation-handoff.cjs');

function reviewPrompt(overrides = {}) {
  return {
    ok: true,
    channel: '#cluster-shop',
    ephemeral: true,
    interactionMode: 'purchase-review-only',
    requestId: 'req_12345678',
    orderId: 'shop_req_12345678',
    discordUserId: '123456789012345678',
    itemId: 'metal-ingots',
    currency: 'Nexus Points',
    quantity: 2,
    unitPrice: 250,
    totalPrice: 500,
    balance: 900,
    projectedBalance: 400,
    purchasePermitted: false,
    walletDebitPermitted: false,
    fulfillmentPermitted: false,
    executionPermitted: false,
    sellbackPermitted: false,
    dinoCacheFlowIncluded: false,
    components: [{ type: 'button', customId: 'nexus:cluster-shop:confirm', disabled: true }],
    ...overrides
  };
}

function confirmationResult(overrides = {}) {
  return {
    ok: true,
    confirmationReady: true,
    executionPermitted: false,
    reason: 'purchase-confirmation-ready',
    requestId: 'req_12345678',
    orderId: 'shop_req_12345678',
    discordUserId: '123456789012345678',
    itemId: 'metal-ingots',
    quantity: 2,
    currency: 'Nexus Points',
    expectedTotalPrice: 500,
    currentTotalPrice: 500,
    balance: 900,
    projectedBalance: 400,
    ...overrides
  };
}

function interaction(overrides = {}) {
  return { customId: 'nexus:cluster-shop:confirm', discordUserId: '123456789012345678', ...overrides };
}

test('revalidates actor and quote while keeping all mutations disabled', async () => {
  const calls = [];
  const handoff = createNexusClusterShopConfirmationHandoff({ confirmationService: {
    async confirm(discordUserId, itemId, options) {
      calls.push({ discordUserId, itemId, options });
      return confirmationResult();
    }
  }});

  const result = await handoff.prepare(reviewPrompt(), interaction());
  assert.equal(result.ok, true);
  assert.equal(result.handoffReady, true);
  assert.equal(result.submitPermitted, false);
  assert.equal(result.walletDebitPermitted, false);
  assert.equal(result.fulfillmentPermitted, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.sellbackPermitted, false);
  assert.equal(result.dinoCacheFlowIncluded, false);
  assert.deepEqual(calls[0], {
    discordUserId: '123456789012345678',
    itemId: 'metal-ingots',
    options: { quantity: 2, requestId: 'req_12345678', expectedTotalPrice: 500 }
  });
});

test('rejects a different Discord actor before repricing', async () => {
  let called = false;
  const handoff = createNexusClusterShopConfirmationHandoff({ confirmationService: {
    async confirm() { called = true; return confirmationResult(); }
  }});
  await assert.rejects(
    handoff.prepare(reviewPrompt(), interaction({ discordUserId: '999999999999999999' })),
    /cluster-shop-confirm-actor-mismatch/
  );
  assert.equal(called, false);
});

test('requires the confirm control to remain guarded', async () => {
  const handoff = createNexusClusterShopConfirmationHandoff({ confirmationService: {
    async confirm() { return confirmationResult(); }
  }});
  await assert.rejects(
    handoff.prepare(reviewPrompt({ components: [{ type: 'button', customId: 'nexus:cluster-shop:confirm', disabled: false }] }), interaction()),
    /cluster-shop-review-confirm-control-not-guarded/
  );
});

test('fails closed on confirmation identity and quote tampering', async () => {
  const cases = [
    [{ executionPermitted: true }, /cluster-shop-confirmation-execution-must-remain-disabled/],
    [{ orderId: 'shop_other_request' }, /cluster-shop-confirmation-order-identity-mismatch/],
    [{ currentTotalPrice: 499 }, /cluster-shop-confirmation-total-price-mismatch/],
    [{ projectedBalance: 401 }, /cluster-shop-confirmation-balance-mismatch/]
  ];
  for (const [overrides, expected] of cases) {
    const handoff = createNexusClusterShopConfirmationHandoff({ confirmationService: {
      async confirm() { return confirmationResult(overrides); }
    }});
    await assert.rejects(handoff.prepare(reviewPrompt(), interaction()), expected);
  }
});

test('passes through a safe confirmation rejection without enabling mutation', async () => {
  const handoff = createNexusClusterShopConfirmationHandoff({ confirmationService: {
    async confirm() { return { ok: false, confirmationReady: false, executionPermitted: false, reason: 'purchase-quote-changed' }; }
  }});
  const result = await handoff.prepare(reviewPrompt(), interaction());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'purchase-quote-changed');
  assert.equal(result.submitPermitted, false);
  assert.equal(result.walletDebitPermitted, false);
  assert.equal(result.fulfillmentPermitted, false);
  assert.equal(result.executionPermitted, false);
});
