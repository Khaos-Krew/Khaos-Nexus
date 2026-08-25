'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonStore } = require('../src/backend/core/json-store.cjs');
const {
  normalizePlayerName,
  normalizeMode,
  normalizeOsrsHiscores,
  parseCsvHiscores,
  RuneScapeService,
  createRuneScapeProviders
} = require('../src/backend/providers/runescape-provider.cjs');

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-rs-'));
  return { dir, store: new JsonStore(path.join(dir, 'state.json'), { users: {} }) };
}

function response(status, body, type = 'json') {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return type === 'json' ? body : JSON.parse(body); },
    async text() { return type === 'text' ? String(body) : JSON.stringify(body); }
  };
}

test('RuneScape player names and account modes are bounded', () => {
  assert.equal(normalizePlayerName('Khaos Kirito'), 'Khaos Kirito');
  assert.equal(normalizeMode('osrs', 'hardcore'), 'hardcore');
  assert.equal(normalizeMode('rs3', 'ironman'), 'ironman');
  assert.throws(() => normalizePlayerName('this-name-is-way-too-long'), /1-12/);
  assert.throws(() => normalizeMode('rs3', 'ultimate'), /Unsupported RuneScape 3/);
});

test('OSRS JSON hiscores normalize skills and named activities', () => {
  const parsed = normalizeOsrsHiscores({
    skills: [
      { name: 'Overall', rank: 25, level: 2277, xp: 400000000 },
      { name: 'Attack', rank: 100, level: 99, xp: 13034431 }
    ],
    activities: [{ name: 'Zulrah', rank: 200, score: 500 }]
  });
  assert.equal(parsed.skills[0].name, 'Overall');
  assert.equal(parsed.skills[1].level, 99);
  assert.equal(parsed.activities[0].name, 'Zulrah');
  assert.equal(parsed.activities[0].score, 500);
});

test('RS3 CSV hiscores map current skill rows and retain later activity scores', () => {
  const rows = [];
  for (let index = 0; index < 30; index += 1) rows.push(`${index + 1},${index === 0 ? 3018 : 99},${1000000 + index}`);
  rows.push('500,1234,-1');
  const parsed = parseCsvHiscores(rows.join('\n'), 'rs3');
  assert.equal(parsed.skills[0].name, 'Overall');
  assert.equal(parsed.skills.at(-1).name, 'Necromancy');
  assert.equal(parsed.activities.length, 1);
  assert.equal(parsed.activities[0].score, 1234);
});

test('shared RuneScape service stores separate OSRS and RS3 links per Discord user', () => {
  const holder = tempStore();
  try {
    const service = new RuneScapeService({ store: holder.store, fetchImpl: async () => response(500, {}) });
    const context = { actorId: '100000000000000001' };
    service.link('osrs', { input: 'Khaos OSRS|ironman' }, context);
    service.link('rs3', { input: 'Khaos RS3|normal' }, context);
    assert.equal(service.linked('osrs', context).name, 'Khaos OSRS');
    assert.equal(service.linked('osrs', context).mode, 'ironman');
    assert.equal(service.linked('rs3', context).name, 'Khaos RS3');
    service.unlink('osrs', context);
    assert.equal(service.linked('osrs', context), null);
    assert.equal(service.linked('rs3', context).name, 'Khaos RS3');
  } finally {
    fs.rmSync(holder.dir, { recursive: true, force: true });
  }
});

test('OSRS provider resolves a linked profile through official JSON hiscores', async () => {
  const holder = tempStore();
  try {
    const calls = [];
    const service = new RuneScapeService({
      store: holder.store,
      fetchImpl: async (url) => {
        calls.push(String(url));
        return response(200, {
          skills: [{ name: 'Overall', rank: 10, level: 2200, xp: 300000000 }, { name: 'Attack', rank: 20, level: 99, xp: 15000000 }],
          activities: [{ name: 'Vorkath', rank: 30, score: 777 }]
        });
      }
    });
    const providers = createRuneScapeProviders({ service });
    const context = { actorId: '100000000000000001' };
    await providers.osrs.invoke('link', { input: 'Khaos OSRS|normal' }, context);
    const profile = await providers.osrs.invoke('profile', {}, context);
    assert.equal(profile.player, 'Khaos OSRS');
    assert.equal(profile.overall.level, 2200);
    assert.equal(profile.activities[0].name, 'Vorkath');
    assert.match(calls[0], /hiscore_oldschool\/index_lite\.json\?player=Khaos(?:%20|\+)OSRS/);
  } finally {
    fs.rmSync(holder.dir, { recursive: true, force: true });
  }
});

test('OSRS real-time price lookup uses one mapping fetch and the item-specific latest endpoint', async () => {
  const holder = tempStore();
  try {
    const calls = [];
    const service = new RuneScapeService({
      store: holder.store,
      fetchImpl: async (url) => {
        calls.push(String(url));
        if (String(url).endsWith('/mapping')) return response(200, [{ id: 4151, name: 'Abyssal whip', members: true, limit: 70, highalch: 72000, lowalch: 48000 }]);
        if (String(url).includes('/latest?id=4151')) return response(200, { data: { 4151: { high: 1600000, highTime: 10, low: 1590000, lowTime: 9 } } });
        return response(404, {});
      }
    });
    const result = await service.osrsPrice({ input: 'abyssal whip' });
    assert.equal(result.itemId, 4151);
    assert.equal(result.high, 1600000);
    assert.equal(calls.filter((url) => url.endsWith('/mapping')).length, 1);
    assert.ok(calls.some((url) => url.includes('/latest?id=4151')));
  } finally {
    fs.rmSync(holder.dir, { recursive: true, force: true });
  }
});

test('RS3 price lookup stays on the documented Jagex Grand Exchange item endpoint', async () => {
  const holder = tempStore();
  try {
    let called = '';
    const service = new RuneScapeService({
      store: holder.store,
      fetchImpl: async (url) => {
        called = String(url);
        return response(200, { item: { id: 21787, name: 'Armadyl battlestaff', members: 'true', current: { trend: 'neutral', price: '12.3m' } } });
      }
    });
    const result = await service.rs3Price({ input: '21787' });
    assert.equal(result.itemId, 21787);
    assert.equal(result.item, 'Armadyl battlestaff');
    assert.match(called, /m=itemdb_rs\/api\/catalogue\/detail\.json\?item=21787/);
  } finally {
    fs.rmSync(holder.dir, { recursive: true, force: true });
  }
});
