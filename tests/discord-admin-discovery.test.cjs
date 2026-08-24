'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { desiredCommandNames, discoverMappingsFromData, rankOfferingMatch } = require('../src/sentinel/discord-admin-discovery.cjs');
const { rankAuthority, rankRoleIds } = require('../src/shared/ranks.cjs');

const blackoutLegend = { id: 'blackout-legend', name: 'Blackout Legend', level: 4 };

test('Discord admin command health covers Nexus, moderation, and all friendly commands', () => {
  const names = desiredCommandNames();
  for (const expected of ['nexus', 'market', 'clear', 'ark', 'palworld', 'minecraft', 'warframe', 'division2', 'rust', 'satisfactory', 'idleon', 'pogo']) {
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
    current: { rankRoles: {}, rankSkus: {} },
    authority: 'server-shop-roles'
  });

  assert.equal(result.suggestedSettings.rankRoles['shadow-recruit'], '100000000000000001');
  assert.equal(result.suggestedSettings.rankRoles['cipher-runner'], '100000000000000002');
  assert.equal(result.suggestedSettings.rankRoles['nexus-raider'], '');
  assert.equal(result.ranks.find((rank) => rank.id === 'nexus-raider').role.status, 'ambiguous');
  assert.equal(result.suggestedSettings.rankRoles['khaos-warden'], '');
});

test('Server Shop authority treats paid rank SKUs as not required when the roles are configured', () => {
  const current = {
    rankRoles: {
      'shadow-recruit': '100000000000000001',
      'cipher-runner': '100000000000000002',
      'nexus-raider': '100000000000000003',
      'khaos-warden': '100000000000000004',
      'blackout-legend': '100000000000000005',
      'origin-founder': '100000000000000006'
    },
    rankSkus: {}
  };
  const roles = Object.entries(current.rankRoles).map(([id, roleId]) => ({
    id: roleId,
    name: id.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' '),
    managed: false
  }));
  const result = discoverMappingsFromData({ roles, current, authority: 'server-shop-roles' });
  assert.equal(result.ok, true);
  assert.equal(result.authority, 'server-shop-roles');
  assert.equal(result.counts.attention, 0);
  for (const rank of result.ranks.filter((item) => item.level > 0)) assert.equal(rank.skus.status, 'server-shop-managed');
});

test('rank authority defaults to Server Shop roles until paid Premium App SKU mappings are explicitly configured', () => {
  const serverShop = { discord: { rankSkus: { 'cipher-runner': [], 'origin-founder': [] } } };
  const premiumApp = { discord: { rankSkus: { 'cipher-runner': ['200000000000000001'] } } };
  assert.equal(rankAuthority(serverShop), 'server-shop-roles');
  assert.equal(rankAuthority(premiumApp), 'premium-app');
});

test('Server Shop authority protects paid roles from Nexus rank reconciliation ownership', () => {
  const config = { discord: { rankRoles: {
    'shadow-recruit': '100000000000000001',
    'cipher-runner': '100000000000000002',
    'nexus-raider': '100000000000000003',
    'khaos-warden': '100000000000000004',
    'blackout-legend': '100000000000000005',
    'origin-founder': '100000000000000006'
  }, rankSkus: {} } };
  assert.deepEqual(rankRoleIds(config), ['100000000000000001']);
  config.discord.rankSkus['cipher-runner'] = ['200000000000000001'];
  assert.deepEqual(rankRoleIds(config), [
    '100000000000000001', '100000000000000002', '100000000000000003',
    '100000000000000004', '100000000000000005', '100000000000000006'
  ]);
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
    current: { rankRoles: {}, rankSkus: {} },
    authority: 'premium-app'
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
    },
    authority: 'premium-app'
  });

  assert.equal(result.suggestedSettings.rankRoles['cipher-runner'], '100000000000009999');
  assert.deepEqual(result.suggestedSettings.rankSkus['cipher-runner'], ['200000000000009999']);
});
