'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');
const {
  findSupporterHub,
  supporterVisibilityRoles,
  supporterHubPolicy,
  reconcileSupporterHubCategory
} = require('../src/sentinel/supporter-hub-policy.cjs');

const config = {
  discord: {
    rankRoles: {
      'shadow-recruit': '10000',
      'cipher-runner': '20000',
      'nexus-raider': '30000',
      'khaos-warden': '40000',
      'blackout-legend': '50000',
      'origin-founder': '90000'
    }
  }
};

test('Supporter Hub discovery is category-name tolerant but category-type strict', () => {
  const channels = new Map([
    ['1', { id: '1', name: 'supporter-hub', type: ChannelType.GuildText }],
    ['2', { id: '2', name: 'SUPPORTER HUB', type: ChannelType.GuildCategory }]
  ]);
  assert.equal(findSupporterHub(channels).id, '2');
});

test('visibility roles contain paid ranks and Origin Founder but never Shadow Recruit', () => {
  const roles = supporterVisibilityRoles(config);
  assert.deepEqual(roles.map((item) => item.rankId), [
    'cipher-runner',
    'nexus-raider',
    'khaos-warden',
    'blackout-legend',
    'origin-founder'
  ]);
  assert.equal(roles.some((item) => item.rankId === 'shadow-recruit'), false);
});

test('policy reports missing paid mappings without inventing role ids', () => {
  const partial = JSON.parse(JSON.stringify(config));
  delete partial.discord.rankRoles['nexus-raider'];
  const policy = supporterHubPolicy(partial);
  assert.deepEqual(policy.missingPaidRanks, ['nexus-raider']);
  assert.equal(policy.shadowRecruitIncluded, false);
  assert.equal(policy.founderConfigured, true);
});

test('category reconciliation denies everyone and grants only configured supporter visibility roles', async () => {
  const edits = [];
  const category = {
    id: 'cat1',
    name: 'SUPPORTER HUB',
    type: ChannelType.GuildCategory,
    permissionOverwrites: {
      async edit(id, permissions) { edits.push([String(id), permissions]); }
    }
  };
  const guild = {
    id: '77777',
    channels: { async fetch() { return new Map([['cat1', category]]); } }
  };
  const result = await reconcileSupporterHubCategory(guild, config);
  assert.equal(result.ok, true);
  assert.deepEqual(result.visibleRoleIds.sort(), ['20000', '30000', '40000', '50000', '90000']);
  assert.deepEqual(edits[0], ['77777', { ViewChannel: false }]);
  assert.equal(edits.some(([id]) => id === '10000'), false, 'Shadow Recruit must not receive Supporter Hub visibility');
  for (const id of ['20000', '30000', '40000', '50000', '90000']) {
    assert.equal(edits.some(([edited]) => edited === id), true, `${id} should receive Supporter Hub visibility`);
  }
});

test('missing Supporter Hub is a safe skip rather than implicit category creation', async () => {
  const guild = { channels: { async fetch() { return new Map(); } } };
  const result = await reconcileSupporterHubCategory(guild, config);
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'supporter-hub-missing');
});
