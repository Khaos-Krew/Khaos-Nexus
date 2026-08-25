'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  activeConfiguredEntitlements,
  configuredSkuIds,
  groupUserEntitlements,
  reconcileMemberSupporterRank
} = require('../src/sentinel/supporter-entitlement-adapter.cjs');

const config = {
  discord: {
    rankRoles: {
      'shadow-recruit': '10000',
      'cipher-runner': '20000',
      'nexus-raider': '30000',
      'khaos-warden': '40000',
      'blackout-legend': '50000',
      'origin-founder': '90000'
    },
    rankSkus: {
      'cipher-runner': ['11111'],
      'nexus-raider': ['22222'],
      'khaos-warden': ['33333'],
      'blackout-legend': ['44444']
    }
  }
};

function entitlement(id, sku, userId, extra = {}) {
  return { id, sku_id: sku, user_id: userId, deleted: false, ...extra };
}

function role(id, editable = true) {
  return { id: String(id), name: `role-${id}`, editable };
}

function fakeGuild({ memberRoles = [], editable = true } = {}) {
  const allRoles = ['10000', '20000', '30000', '40000', '50000', '90000'].map((id) => role(id, editable));
  const actions = [];
  const member = {
    roles: {
      cache: new Map(memberRoles.map((id) => [String(id), role(id, editable)])),
      async add(item) { actions.push(['add', String(item.id)]); },
      async remove(item) { actions.push(['remove', String(item.id)]); }
    }
  };
  return {
    actions,
    members: { async fetch() { return member; } },
    roles: { async fetch() { return new Map(allRoles.map((item) => [item.id, item])); } }
  };
}

test('configured SKU list contains only purchasable rank mappings', () => {
  assert.deepEqual(configuredSkuIds(config).sort(), ['11111', '22222', '33333', '44444']);
});

test('active entitlement filter excludes unknown, ended, deleted, and future entitlements', () => {
  const now = Date.parse('2026-08-25T17:00:00Z');
  const active = activeConfiguredEntitlements([
    entitlement('1', '11111', 'u1'),
    entitlement('2', '99999', 'u1'),
    entitlement('3', '22222', 'u1', { deleted: true }),
    entitlement('4', '33333', 'u1', { ends_at: '2026-08-25T16:59:59Z' }),
    entitlement('5', '44444', 'u1', { starts_at: '2026-08-25T17:01:00Z' })
  ], config, now);
  assert.deepEqual(active.map((item) => item.id), ['1']);
});

test('grouping separates user entitlements from guild-only entitlements', () => {
  const grouped = groupUserEntitlements([
    entitlement('1', '11111', 'u1'),
    entitlement('2', '22222', 'u1'),
    { id: '3', sku_id: '33333', guild_id: 'g1', deleted: false }
  ]);
  assert.equal(grouped.users.get('u1').length, 2);
  assert.equal(grouped.guildEntitlements.length, 1);
});

test('member reconciliation adds highest paid rank before removing stale paid rank', async () => {
  const guild = fakeGuild({ memberRoles: ['20000', '10000', '90000'] });
  const result = await reconcileMemberSupporterRank(guild, 'u1', [
    entitlement('1', '11111', 'u1'),
    entitlement('2', '33333', 'u1')
  ], config);
  assert.equal(result.ok, true);
  assert.equal(result.selectedRankId, 'khaos-warden');
  assert.deepEqual(guild.actions, [['add', '40000'], ['remove', '20000']]);
});

test('member reconciliation removes stale paid rank when no active entitlement remains', async () => {
  const guild = fakeGuild({ memberRoles: ['50000', '10000', '90000'] });
  const result = await reconcileMemberSupporterRank(guild, 'u1', [], config);
  assert.equal(result.ok, true);
  assert.deepEqual(guild.actions, [['remove', '50000']]);
});

test('uneditable paid roles fail closed before role mutation', async () => {
  const guild = fakeGuild({ memberRoles: ['20000'], editable: false });
  const result = await reconcileMemberSupporterRank(guild, 'u1', [entitlement('1', '33333', 'u1')], config);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'discord-role-uneditable');
  assert.deepEqual(guild.actions, []);
});
