'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WarframeProvider } = require('../src/backend/providers/warframe-provider.cjs');

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

test('worldstate falls back to the full platform snapshot when a leaf endpoint returns 404', async () => {
  const calls = [];
  const snapshot = {
    news: [{ message: 'Fallback news', link: 'https://example.invalid/news' }],
    nightwave: { season: 9, phase: 2, tag: 'Fallback Wave', activeChallenges: [] },
    steelPath: { currentReward: { name: 'Umbra Forma Blueprint' }, remaining: '2d', rotation: [] }
  };

  const provider = new WarframeProvider({
    worldstateBase: 'https://worldstate.invalid',
    fetchImpl: async (url) => {
      calls.push(url);
      if (url === 'https://worldstate.invalid/pc?language=en') return response(200, snapshot);
      return response(404, { error: 'missing leaf endpoint' });
    }
  });

  const news = await provider.invoke('news');
  const nightwave = await provider.invoke('nightwave');
  const steelPath = await provider.invoke('steel-path');

  assert.equal(news.news[0].title, 'Fallback news');
  assert.equal(nightwave.nightwave.tag, 'Fallback Wave');
  assert.equal(steelPath.steelPath.currentReward, 'Umbra Forma Blueprint');
  assert.ok(calls.includes('https://worldstate.invalid/pc/news?language=en'));
  assert.ok(calls.includes('https://worldstate.invalid/pc/nightwave?language=en'));
  assert.ok(calls.includes('https://worldstate.invalid/pc/steelPath?language=en'));
  assert.equal(calls.filter((url) => url === 'https://worldstate.invalid/pc?language=en').length, 3);
});

test('worldstate does not hide non-404 provider failures behind the snapshot fallback', async () => {
  const provider = new WarframeProvider({
    worldstateBase: 'https://worldstate.invalid',
    fetchImpl: async () => response(503, { error: 'unavailable' })
  });

  await assert.rejects(() => provider.worldstate('news'), /HTTP 503/);
});
