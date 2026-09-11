'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { handleInteraction } = require('../src/sentinel/cluster-shop-ui-extension.cjs');

test('Discord shop completes category, item, quantity and duplicate confirmation with one checkout key', async () => {
  const item = { id: 'metal', name: 'Metal', category: 'Resources', buyable: true, baseQuantity: 100, buyPrice: 50, minBundles: 1, maxBundles: 10 };
  const quote = { itemId: 'metal', name: 'Metal', bundles: 1, totalQuantity: 100, totalPrice: 50, unitPrice: 50 };
  const calls = [];
  const economyClient = {
    configured: () => true, shopCatalog: async () => ({ items: [item] }), shopQuote: async () => ({ quote }),
    shopBuy: async input => { calls.push(input); await new Promise(resolve => setImmediate(resolve)); return { ok: true, order: { orderId: 'test', quote, status: 'PAID_QUEUED' }, balance: 50 }; }
  };
  const identityStore = { read: () => ({ profiles: { '1234567890': { arkAccounts: [{ eosId: 'EOS_example', verifiedAt: new Date().toISOString() }] } } }) };
  let output;
  const interaction = (customId, type = 'button', extra = {}) => ({
    customId, id: 'interaction', user: { id: '1234567890' },
    isButton: () => type === 'button', isStringSelectMenu: () => type === 'select', isModalSubmit: () => type === 'modal',
    reply: async p => { output = p; }, update: async p => { output = p; }, editReply: async p => { output = p; },
    deferUpdate: async () => {}, showModal: async p => { output = p.toJSON(); }, ...extra
  });
  const deps = { economyClient, identityStore };
  await handleInteraction(interaction('nexus-shop:buy'), deps);
  const category = output.components[0].toJSON().components[0].custom_id;
  await handleInteraction(interaction(category, 'select', { values: ['Resources'] }), deps);
  assert.match(output.content, /Resources/);
  const select = output.components[0].toJSON().components[0].custom_id;
  await handleInteraction(interaction(select, 'select', { values: ['metal'] }), deps);
  assert.match(output.custom_id, /^nexus-shop:quantity:/);
  await handleInteraction(interaction(output.custom_id, 'modal', { fields: { getTextInputValue: () => '1' } }), deps);
  const confirm = output.components[0].toJSON().components[0].custom_id;
  await Promise.all([handleInteraction(interaction(confirm, 'button', { id: 'click-one' }), deps), handleInteraction(interaction(confirm, 'button', { id: 'click-two' }), deps)]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].idempotencyKey, calls[1].idempotencyKey);
  assert.deepEqual(calls[0].expectedQuote, quote);
  assert.match(output.content, /Order created/);
});
