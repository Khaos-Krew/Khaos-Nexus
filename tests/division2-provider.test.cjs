'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Division2Provider, DIVISION2_ACTIONS, parseCsv, rowScore, farmingTarget } = require('../src/backend/providers/division2-provider.cjs');

const SAMPLE = [
  'name,brand_set,gear_set,fixed_talent,description',
  'Ceska Vyroba Mask,Ceska Vyroba s.r.o.,N/A,N/A,"Crit-focused brand piece, useful for damage builds"',
  'Grupo Sombra Mask,Grupo Sombra S.A.,N/A,N/A,"Critical hit damage brand piece"',
  'Eclipse Protocol Mask,N/A,Eclipse Protocol,N/A,"Status effects gear set"'
].join('\n');

function response(text = SAMPLE, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return text; }
  };
}

test('CSV parser handles quoted fields and produces keyed rows', () => {
  const rows = parseCsv('name,description\nTest,"value, with comma"\n');
  assert.equal(rows[0].name, 'Test');
  assert.equal(rows[0].description, 'value, with comma');
});

test('row scorer prioritizes exact and name matches', () => {
  const exact = rowScore({ name: 'Eclipse Protocol Mask', description: 'status effects' }, 'Eclipse Protocol Mask');
  const loose = rowScore({ name: 'Other Mask', description: 'eclipse protocol compatible' }, 'Eclipse Protocol Mask');
  assert.ok(exact > loose);
});

test('Division 2 gear search uses community CSV data and caches files', async () => {
  let fetches = 0;
  const provider = new Division2Provider({
    fetchImpl: async () => { fetches += 1; return response(); },
    cacheTtlMs: 60_000
  });
  const first = await provider.invoke('gear', { input: 'Eclipse Protocol' });
  const afterFirst = fetches;
  const second = await provider.invoke('gear', { input: 'Eclipse Protocol' });
  assert.ok(first.results.some((item) => item.name === 'Eclipse Protocol Mask'));
  assert.equal(second.results[0].name, first.results[0].name);
  assert.equal(fetches, afterFirst);
  assert.deepEqual(provider.supportedActions, [...DIVISION2_ACTIONS]);
  assert.deepEqual(provider.supportedActions, ['gear', 'builds', 'optimize', 'compare', 'farming', 'wishlist', 'inventory', 'weekly', 'lfg', 'news']);
  assert.equal(provider.connected, false);
});

test('Division 2 build research returns gear weapon and talent candidate groups', async () => {
  const provider = new Division2Provider({ fetchImpl: async () => response() });
  const result = await provider.invoke('builds', { input: 'crit damage' });
  assert.equal(result.query, 'crit damage');
  assert.ok(Array.isArray(result.gear));
  assert.ok(Array.isArray(result.weapons));
  assert.ok(Array.isArray(result.talents));
  assert.match(result.note, /community game-data/i);
});

test('Division 2 optimizer is a declared heuristic rather than invented DPS math', async () => {
  const provider = new Division2Provider({ fetchImpl: async () => response() });
  const result = await provider.invoke('optimize', { input: 'crit damage' });
  assert.equal(result.query, 'crit damage');
  assert.match(result.method, /heuristic/i);
  assert.match(result.note, /not fake DPS math/i);
  assert.ok(result.recommendations && typeof result.recommendations === 'object');
});

test('farming helper derives targeted-loot category without inventing current map location', async () => {
  const provider = new Division2Provider({ fetchImpl: async () => response() });
  const result = await provider.invoke('farming', { input: 'Ceska' });
  assert.equal(result.matches[0].targetedLoot.type, 'brand set');
  assert.match(result.note, /location data is intentionally not guessed/i);
  assert.deepEqual(farmingTarget({ kind: 'weapon', source: 'weapons/smgs.csv', name: 'Vector' }), { type: 'weapon category', target: 'smgs' });
});

test('parameterized Division 2 actions provide slash-command usage when input is missing', async () => {
  const provider = new Division2Provider({ fetchImpl: async () => { throw new Error('fetch should not run'); } });
  assert.match((await provider.invoke('gear', {})).usage, /action:gear/);
  assert.match((await provider.invoke('builds', {})).usage, /action:builds/);
  assert.match((await provider.invoke('optimize', {})).usage, /action:optimize/);
  assert.match((await provider.invoke('compare', {})).usage, /action:compare/);
  assert.match((await provider.invoke('farming', {})).usage, /action:farming/);
});
