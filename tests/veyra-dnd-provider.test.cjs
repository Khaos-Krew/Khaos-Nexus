'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { VeyraDndProvider, providersFromConfig } = require('../src/backend/providers/http-provider.cjs');

function response(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, async text() { return JSON.stringify(value); } };
}

test('D&D provider configuration selects an explicit Veyra-owned gateway', () => {
  const providers = providersFromConfig({ modules: { dnd: { provider: { type: 'veyra', baseUrl: 'https://veyra.example', fetchImpl: async () => response({}) } } } });
  assert.ok(providers.dnd instanceof VeyraDndProvider);
  assert.equal(providers.dnd.providerKind, 'veyra-dnd-gateway');
  assert.equal(providers.dnd.authoritativeOwner, 'veyra');
});

test('Veyra D&D gateway requires actor identity and forwards bounded delegated requests', async () => {
  const calls = [];
  const provider = new VeyraDndProvider({ baseUrl: 'https://veyra.example', actions: ['campaigns'], fetchImpl: async (url, options) => { calls.push({ url, options }); return response({ data: { campaigns: [] } }); } });
  await assert.rejects(() => provider.invoke('campaigns', {}, { role: 'viewer' }), /linked actor identity/i);
  assert.deepEqual(await provider.invoke('campaigns', {}, { role: 'viewer', actorId: 'discord-1' }), { campaigns: [] });
  assert.equal(calls[0].url, 'https://veyra.example/actions/campaigns');
  assert.equal(calls[0].options.headers['x-nexus-actor'], 'discord-1');
});

test('Veyra D&D gateway rejects oversized responses before parsing campaign data', async () => {
  const provider = new VeyraDndProvider({ baseUrl: 'https://veyra.example', maxResponseBytes: 1024, fetchImpl: async () => ({ ok: true, status: 200, async text() { return 'x'.repeat(1025); } }) });
  await assert.rejects(() => provider.invoke('campaigns', {}, { actorId: 'discord-1' }), /safety limit/i);
});
