'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WarframeProvider, marketSlug } = require('../src/backend/providers/warframe-provider.cjs');

function response(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data; }
  };
}

test('market item names become stable Warframe Market slugs', () => {
  assert.equal(marketSlug('Arcane Energize'), 'arcane_energize');
  assert.equal(marketSlug("Primed Bane of Grineer"), 'primed_bane_of_grineer');
});

test('world-state actions call the backend API for the configured platform', async () => {
  const urls = [];
  const provider = new WarframeProvider({
    platform: 'pc',
    fetchImpl: async (url) => {
      urls.push(String(url));
      if (String(url).includes('/fissures')) return response([{ tier: 'Axi', node: 'Apollo (Lua)', missionType: 'Disruption', eta: '20m' }]);
      return response([]);
    }
  });
  const result = await provider.invoke('fissures');
  assert.match(urls[0], /api\.warframestat\.us\/pc\/fissures\?language=en$/);
  assert.equal(result.fissures[0].tier, 'Axi');
});

test('market lookup uses v2 top orders and does not require authentication', async () => {
  const requests = [];
  const provider = new WarframeProvider({
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return response({ data: { sell: [{ platinum: 80, quantity: 1, user: { ingameName: 'Seller' } }], buy: [] } });
    }
  });
  const result = await provider.invoke('market', { input: 'Arcane Energize' });
  assert.match(requests[0].url, /api\.warframe\.market\/v2\/orders\/item\/arcane_energize\/top$/);
  assert.equal(requests[0].options.headers.Platform, 'pc');
  assert.equal(result.sell[0].platinum, 80);
});

test('market and build helper return usage guidance when no parameter is supplied', async () => {
  const provider = new WarframeProvider({ fetchImpl: async () => { throw new Error('fetch should not run'); } });
  assert.match((await provider.invoke('market', {})).usage, /input:<item name>/);
  assert.match((await provider.invoke('builds', {})).usage, /input:<frame, weapon, or mod>/);
});

test('build helper queries frame, weapon, and mod public datasets', async () => {
  const urls = [];
  const provider = new WarframeProvider({
    fetchImpl: async (url) => {
      urls.push(String(url));
      return response([{ name: 'Gyre' }]);
    }
  });
  const result = await provider.invoke('builds', { input: 'Gyre' });
  assert.equal(urls.length, 3);
  assert.ok(urls.some((url) => /warframes\/search\/Gyre$/.test(url)));
  assert.ok(urls.some((url) => /weapons\/search\/Gyre$/.test(url)));
  assert.ok(urls.some((url) => /mods\/search\/Gyre$/.test(url)));
  assert.equal(result.query, 'Gyre');
});
