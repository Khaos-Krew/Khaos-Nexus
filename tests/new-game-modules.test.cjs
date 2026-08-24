'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ChannelType } = require('discord.js');
const { getModule } = require('../src/backend/modules/catalog.cjs');
const { layoutFor } = require('../src/sentinel/module-layouts.cjs');
const { categoryOrderPlan, categoryMoveSequence } = require('../src/sentinel/category-order.cjs');
const {
  DeadByDaylightProvider, Diablo4Provider, CallOfDutyProvider,
  DBD_ACTIONS, DIABLO4_ACTIONS, COD_ACTIONS
} = require('../src/backend/providers/game-companion-providers.cjs');

function category(id, name, position) {
  return { id, name, type: ChannelType.GuildCategory, position, rawPosition: position };
}

function tempFile(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-new-games-'));
  return path.join(dir, name);
}

test('registers all three new game modules and Discord layouts', () => {
  for (const moduleId of ['callofduty', 'deadbydaylight', 'diablo4']) {
    assert.ok(getModule(moduleId), `${moduleId} should be registered`);
    const layout = layoutFor(moduleId);
    assert.ok(layout.category);
    assert.ok(layout.text.length >= 5);
    assert.ok(layout.lobbyBuilder);
  }
});

test('category order plan alphabetizes game categories above the first staff boundary', () => {
  const channels = new Map([
    ['warframe', category('warframe', 'Warframe', 70)],
    ['staff', category('staff', 'STAFF', 50)],
    ['dbd', category('dbd', 'Dead by Daylight', 80)],
    ['ark', category('ark', 'ARK Survival Ascended', 10)],
    ['hidden', category('hidden', 'HIDDEN SERVER', 60)],
    ['cod', category('cod', 'Call of Duty', 90)],
    ['diablo', category('diablo', 'Diablo IV', 100)]
  ]);
  const plan = categoryOrderPlan(channels);
  assert.equal(plan.boundary.id, 'staff');
  assert.deepEqual(plan.modules.map((entry) => entry.label), [
    'ARK Survival Ascended', 'Call of Duty', 'Dead by Daylight', 'Diablo IV', 'Warframe'
  ]);
  assert.deepEqual(categoryMoveSequence(plan).map((entry) => entry.label), [
    'Warframe', 'Diablo IV', 'Dead by Daylight', 'Call of Duty', 'ARK Survival Ascended'
  ]);
});

test('Dead by Daylight provider uses public community catalog and NightLight stats surfaces', async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(String(url));
    const value = String(url);
    if (value.includes('/characters')) return { ok: true, json: async () => ({ 1: { id: 'trapper', name: 'The Trapper', role: 'killer' } }) };
    if (value.includes('/randomperks')) return { ok: true, json: async () => ({ a: { name: 'Perk A', role: 'survivor' }, b: { name: 'Perk B', role: 'survivor' } }) };
    if (value.includes('/perks')) return { ok: true, json: async () => ({ perk: { name: 'Sprint Burst', role: 'survivor', description: 'Run faster.' } }) };
    if (value.includes('/steam-stats/')) return { ok: true, json: async () => ({ status: 'success', data: { value: 123, rank: 45 } }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const provider = new DeadByDaylightProvider({ fetchImpl, stateFile: tempFile('dbd.json') });
  assert.deepEqual(provider.supportedActions, [...DBD_ACTIONS]);
  const killers = await provider.invoke('killers', { input: 'trapper' });
  assert.equal(killers.results[0].name, 'The Trapper');
  const random = await provider.invoke('random-build', { input: 'survivor' });
  assert.equal(random.role, 'survivor');
  const stats = await provider.invoke('stats', { input: '76561198169190952|total_bloodpoints' });
  assert.equal(stats.result.value, 123);
  assert.ok(requested.some((url) => url.includes('role=killer')));
  assert.ok(requested.some((url) => url.includes('total_bloodpoints')));
});

test('Diablo IV provider exposes safe local planning without claiming a live character API', async () => {
  const provider = new Diablo4Provider({ stateFile: tempFile('diablo4.json') });
  assert.deepEqual(provider.supportedActions, [...DIABLO4_ACTIONS]);
  const status = await provider.invoke('api-status');
  assert.equal(status.officialGameDataApi, false);
  assert.equal(status.liveCharacterInventory, false);
  const classes = await provider.invoke('classes');
  assert.ok(classes.classes.includes('Barbarian'));
  const saved = await provider.invoke('builds', { input: 'add Barbarian Whirlwind test build' }, { actorId: '1' });
  assert.equal(saved.items.length, 1);
});

test('Call of Duty provider keeps private stats disabled while supporting loadouts and LFG', async () => {
  const provider = new CallOfDutyProvider({ stateFile: tempFile('cod.json') });
  assert.deepEqual(provider.supportedActions, [...COD_ACTIONS]);
  const status = await provider.invoke('api-status');
  assert.equal(status.publicDeveloperStatsApi, false);
  assert.equal(status.ssoCookieScrapingEnabled, false);
  const loadouts = await provider.invoke('loadouts', { input: 'add Warzone AR primary' }, { actorId: '2' });
  assert.deepEqual(loadouts.items, ['Warzone AR primary']);
  const lfg = await provider.invoke('lfg', { input: 'join Warzone' }, { actorId: '2' });
  assert.equal(lfg.entries[0].activity, 'Warzone');
});