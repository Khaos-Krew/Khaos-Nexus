'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { desiredCommandNames, discoverMappingsFromData, rankOfferingMatch } = require('../src/sentinel/discord-admin-discovery.cjs');

const blackoutLegend = { id: 'blackout-legend', name: 'Blackout Legend', level: 4 };

test('Discord admin command health covers Nexus and all friendly commands', () => {
  const names = desiredCommandNames();
  for (const expected of ['nexus', 'market', 'ark', 'palworld', 'minecraft', 'warframe', 'division2', 'rust', 'satisfactory', 'idleon', 'pogo']) {
    assert.ok(names.includes(expected), `missing /${expected}`);
  }
  assert.equal(new Set(names).size, names.length);
});

test('rank discovery exact-matches normalized Discord roles without guessing ambiguous roles', () => {
  const result = discoverMappingsFromData({
    guildId: '100000000000000000',
    roles: [
      { id: '100000000000000000', name: '@everyone' },
      { id: '100000000000000001', name: 'Shadow Recruit', managed: false },
      { id: '100000000000000002', name: '🔻 Cipher Runner', managed: false },
      { id: '100000000000000003', name: 'Nexus Raider', managed: false },
      { id: '100000000000000004', name: 'Nexus Raider', managed: false },
      { id: '100000000000000005', name: 'Khaos Warden', managed: true }
    ],
    skus: [],
    current: { rankRoles: {}, rankSkus: {} }
  });

  assert.equal(result.suggestedSettings.rankRoles['shadow-recruit'], '100000000000000001');
  assert.equal(result.suggestedSettings.rankRoles['cipher-runner'], '100000000000000002');
  assert.equal(result.suggestedSettings.rankRoles['nexus-raider'], '');
  assert.equal(result.ranks.find((rank) => rank.id === 'nexus-raider').role.status, 'ambiguous');
  assert.equal(result.suggestedSettings.rankRoles['khaos-warden'], '');
});

test('SKU discovery includes recurring subscriptions and durable one-time purchases while ignoring generated groups and consumables', () => {
  const result = discoverMappingsFromData({
    roles: [],
    skus: [
      { id: '200000000000000001', name: 'Cipher Runner', slug: 'cipher-runner', type: 6 },
      { id: '200000000000000002', name: 'Cipher Runner', slug: 'cipher-runner-subscription', type: 5 },
      { id: '200000000000000003', name: 'Nexus Raider', slug: 'nexus-raider', type: 2 },
      { id: '200000000000000004', name: 'Unrelated Product', slug: 'other', type: 5 },
      { id: '200000000000000005', name: 'Blackout Legend Monthly', slug: 'blackout-legend-monthly', type: 5 },
      { id: '200000000000000006', name: 'Blackout Legend Lifetime', slug: 'blackout-legend-one-time-purchase', type: 2 },
      { id: '200000000000000007', name: 'Blackout Legend Boost', slug: 'blackout-legend-boost', type: 3 }
    ],
    current: { rankRoles: {}, rankSkus: {} }
  });

  assert.deepEqual(result.suggestedSettings.rankSkus['shadow-recruit'], []);
  assert.deepEqual(result.suggestedSettings.rankSkus['cipher-runner'], ['200000000000000002']);
  assert.deepEqual(result.suggestedSettings.rankSkus['nexus-raider'], ['200000000000000003']);
  assert.deepEqual(result.suggestedSettings.rankSkus['blackout-legend'], ['200000000000000005', '200000000000000006']);
  assert.deepEqual(result.ranks.find((rank) => rank.id === 'blackout-legend').skus.candidates.map((sku) => sku.type), [5, 2]);
});

test('rank offering matching accepts only safe monetization suffixes', () => {
  assert.equal(rankOfferingMatch('Blackout Legend', blackoutLegend), true);
  assert.equal(rankOfferingMatch('Blackout Legend Monthly', blackoutLegend), true);
  assert.equal(rankOfferingMatch('blackout-legend-one-time-purchase', blackoutLegend), true);
  assert.equal(rankOfferingMatch('Blackout Legend Lifetime Access', blackoutLegend), true);
  assert.equal(rankOfferingMatch('Blackout Legend Booster Pack', blackoutLegend), false);
  assert.equal(rankOfferingMatch('Blackout Legendary', blackoutLegend), false);
});

test('discovery preserves every existing mapping instead of overwriting it', () => {
  const result = discoverMappingsFromData({
    roles: [{ id: '100000000000000010', name: 'Cipher Runner', managed: false }],
    skus: [{ id: '200000000000000010', name: 'Cipher Runner', slug: 'cipher-runner', type: 5 }],
    current: {
      rankRoles: { 'cipher-runner': '100000000000009999' },
      rankSkus: { 'cipher-runner': ['200000000000009999'] }
    }
  });

  assert.equal(result.suggestedSettings.rankRoles['cipher-runner'], '100000000000009999');
  assert.deepEqual(result.suggestedSettings.rankSkus['cipher-runner'], ['200000000000009999']);
});
