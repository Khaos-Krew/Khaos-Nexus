'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_HUB_REGISTRY } = require('../shared/sentinel-hub-registry.cjs');
const { planStartupReconciliation } = require('../shared/sentinel-startup-reconcile.cjs');

const GUILD_ID = '123456789012345678';

function state() {
  return {
    guildId: GUILD_ID,
    staffRoles: {
      owner: { discordRoleId: '223456789012345678' },
      community_manager: { managed: false },
      admin: { managed: false },
      moderator: { managed: false },
    },
    hubs: {
      about: {
        discordChannelId: '323456789012345678',
        discordMessageId: '423456789012345678',
      },
    },
    roleMenus: {
      community: {
        discordChannelId: '523456789012345678',
        discordMessageId: '623456789012345678',
      },
    },
  };
}

test('startup reconciliation composes role, hub, persistent message, and role-menu plans without writes', () => {
  const result = planStartupReconciliation({
    controlPlane: state(),
    roleDefinitions: [{ roleKey: 'owner', displayName: 'Nexus Prime', group: 'staff' }],
    discordRoles: [{ id: '223456789012345678', name: 'Renamed Prime' }],
    hubRegistry: DEFAULT_HUB_REGISTRY,
    discordChannels: [{ id: '323456789012345678', name: 'about' }],
    hubMessages: { about: [{ id: '423456789012345678' }] },
    roleMenus: [{ id: 'community', name: 'Community Roles' }],
    roleMenuMessages: { community: [{ id: '623456789012345678', components: [] }] },
  });

  assert.equal(result.guildId, GUILD_ID);
  assert.equal(result.rolePlan[0].action, 'keep');
  assert.equal(result.hubPlan.find((item) => item.hubId === 'about').action, 'keep');
  assert.equal(result.hubMessagePlan.about.action, 'keep');
  assert.equal(result.roleMenuPlan.community.action, 'keep');
  assert.equal(result.reviewRequired, false);
});

test('startup reconciliation requests refresh in place instead of duplicate message creation', () => {
  const result = planStartupReconciliation({
    controlPlane: state(),
    roleDefinitions: [{ roleKey: 'owner', displayName: 'Nexus Prime', group: 'staff' }],
    discordRoles: [{ id: '223456789012345678', name: 'Nexus Prime' }],
    hubRegistry: DEFAULT_HUB_REGISTRY,
    discordChannels: [{ id: '323456789012345678', name: 'about' }],
    hubMessages: { about: [{ id: '423456789012345678' }] },
    roleMenus: [{ id: 'community', name: 'Community Roles' }],
    roleMenuMessages: { community: [{ id: '623456789012345678', components: [] }] },
    refreshPersistentMessages: true,
  });

  assert.equal(result.hubMessagePlan.about.action, 'refresh');
  assert.equal(result.roleMenuPlan.community.action, 'refresh');
  assert.equal(result.hubMessagePlan.about.discordMessageId, '423456789012345678');
  assert.equal(result.roleMenuPlan.community.discordMessageId, '623456789012345678');
});

test('ambiguous managed role adoption is surfaced as review instead of creation', () => {
  const source = state();
  source.staffRoles.owner.discordRoleId = null;
  source.staffRoles.owner.aliases = ['Old Prime'];
  const result = planStartupReconciliation({
    controlPlane: source,
    roleDefinitions: [{ roleKey: 'owner', displayName: 'Nexus Prime', aliases: ['Old Prime'], group: 'staff' }],
    discordRoles: [
      { id: '723456789012345678', name: 'Old Prime' },
      { id: '823456789012345678', name: 'Old Prime' },
    ],
  });

  assert.equal(result.rolePlan[0].action, 'review');
  assert.equal(result.reviewRequired, true);
  assert.deepEqual(result.reviewItems, ['role:owner']);
});
