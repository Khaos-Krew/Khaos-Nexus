'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  INITIAL_DELAY_MS,
  PERIODIC_RECONCILE_MS,
  supporterHubSummary,
  runSupporterHubReconcile
} = require('../src/sentinel/supporter-hub-extension.cjs');

const config = {
  discord: {
    guildId: '123456789012345678',
    rankRoles: {
      'cipher-runner': '20000',
      'nexus-raider': '30000',
      'khaos-warden': '40000',
      'blackout-legend': '50000',
      'origin-founder': '90000'
    }
  }
};

function fakeClient() {
  const edits = [];
  const category = {
    id: 'cat1',
    name: 'SUPPORTER HUB',
    type: 4,
    permissionOverwrites: { async edit(id, permissions) { edits.push([String(id), permissions]); } }
  };
  const guild = {
    id: '123456789012345678',
    channels: { async fetch() { return new Map([['cat1', category]]); } }
  };
  return {
    edits,
    user: { id: '999999999999999999' },
    guilds: { async fetch() { return guild; } }
  };
}

test('Supporter Hub runtime cadence is bounded and setup-friendly', () => {
  assert.ok(INITIAL_DELAY_MS >= 30_000);
  assert.ok(PERIODIC_RECONCILE_MS >= 60_000);
  assert.ok(PERIODIC_RECONCILE_MS <= 15 * 60_000);
});

test('Supporter Hub runtime uses accepted state rank-role mappings at call time', async () => {
  const client = fakeClient();
  const state = {
    getAdminSettings() {
      return {
        rankRoles: {
          'cipher-runner': '21000',
          'nexus-raider': '31000',
          'khaos-warden': '41000',
          'blackout-legend': '51000',
          'origin-founder': '91000'
        },
        rankSkus: {}
      };
    }
  };
  const result = await runSupporterHubReconcile(client, config, { state });
  assert.equal(result.ok, true);
  assert.deepEqual(result.visibleRoleIds.sort(), ['21000', '31000', '41000', '51000', '91000']);
  assert.equal(client.edits.some(([id]) => id === '20000'), false, 'static rank mapping should be replaced by accepted setup mapping');
  assert.equal(client.edits.some(([id]) => id === '21000'), true);
});

test('Supporter Hub summary does not leak role ids', () => {
  const summary = supporterHubSummary({
    ok: true,
    categoryId: '123456789012345678',
    visibleRoleIds: ['private-role-1', 'private-role-2'],
    missingPaidRanks: [],
    founderConfigured: true,
    warnings: []
  });
  assert.match(summary, /roles=2/);
  assert.doesNotMatch(summary, /private-role/);
});
