'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const {
  desiredViewPolicy,
  explicitViewState,
  inspectChannelViewPolicy,
  reconcileChannelViewPolicy,
  reconcileExistingModuleAccessPolicies,
  resolveModuleAccessPolicyRoles
} = require('../src/sentinel/module-access-policy.cjs');

function overwrite(viewState) {
  return {
    allow: { has: (bit) => bit === PermissionFlagsBits.ViewChannel && viewState === true },
    deny: { has: (bit) => bit === PermissionFlagsBits.ViewChannel && viewState === false }
  };
}

function fakeChannel({ id, name, type = ChannelType.GuildText, parentId = null, views = {} }) {
  const cache = new Map(Object.entries(views).map(([targetId, state]) => [targetId, overwrite(state)]));
  const edits = [];
  return {
    id,
    name,
    type,
    parentId,
    edits,
    permissionOverwrites: {
      cache,
      async edit(targetId, options) {
        edits.push({ targetId: String(targetId), view: options.ViewChannel });
        if (options.ViewChannel === null) cache.delete(String(targetId));
        else cache.set(String(targetId), overwrite(options.ViewChannel));
      }
    }
  };
}

function stateFor({ access = {}, rankRoles = {} } = {}) {
  return {
    getAccessRole(moduleId) { return access[moduleId] || null; },
    listAccessRoles() { return { ...access }; },
    getAdminSettings() { return { rankRoles: { ...rankRoles }, rankSkus: {}, moduleEnabled: {} }; }
  };
}

test('game policy denies everyone, allows only its module role, neutralizes supporter/cross-game roles, and preserves staff', async () => {
  const channel = fakeChannel({
    id: 'channel',
    name: 'ark-console',
    views: {
      guild: true,
      shadow: true,
      warframe: true,
      staff: true
    }
  });
  const policy = desiredViewPolicy({
    guildId: 'guild',
    accessRoleId: 'ark',
    accessRoleIds: ['ark', 'warframe'],
    rankRoleIds: ['shadow']
  });

  const result = await reconcileChannelViewPolicy(channel, policy);
  assert.equal(result.ok, true);
  assert.equal(result.changed, 4);
  assert.equal(explicitViewState(channel, 'guild'), false);
  assert.equal(explicitViewState(channel, 'ark'), true);
  assert.equal(explicitViewState(channel, 'shadow'), null);
  assert.equal(explicitViewState(channel, 'warframe'), null);
  assert.equal(explicitViewState(channel, 'staff'), true);
  assert.equal(channel.edits.some((edit) => edit.targetId === 'staff'), false);
  assert.equal(inspectChannelViewPolicy(channel, policy).ok, true);
});

test('existing module category and children are locked without touching unrelated channels', async () => {
  const category = fakeChannel({
    id: 'ark-category',
    name: 'ARK Survival Ascended',
    type: ChannelType.GuildCategory,
    views: { guild: true, shadow: true, warframe: true, staff: true }
  });
  const child = fakeChannel({
    id: 'ark-console',
    name: 'ark-console',
    parentId: 'ark-category',
    views: { guild: true, shadow: true, warframe: true, staff: true }
  });
  const unrelated = fakeChannel({ id: 'general', name: 'general', views: { guild: true, shadow: true } });
  const channels = new Map([[category.id, category], [child.id, child], [unrelated.id, unrelated]]);
  const roles = new Map([
    ['ark-access', { id: 'ark-access', name: 'ARK: Survival Ascended Access' }],
    ['warframe-access', { id: 'warframe-access', name: 'Warframe Access' }],
    ['shadow', { id: 'shadow', name: 'Shadow Recruit' }],
    ['staff', { id: 'staff', name: 'Moderator' }]
  ]);
  const state = stateFor({
    access: {
      ark: { roleId: 'ark-access', roleName: 'ARK: Survival Ascended Access' },
      warframe: { roleId: 'warframe-access', roleName: 'Warframe Access' }
    },
    rankRoles: { 'shadow-recruit': 'shadow' }
  });
  const guild = {
    id: 'guild',
    roles: { fetch: async () => roles },
    channels: { fetch: async () => channels }
  };

  const result = await reconcileExistingModuleAccessPolicies(guild, { state, moduleIds: ['ark'] });
  assert.equal(result.ok, true);
  assert.equal(result.changed, 8);
  for (const locked of [category, child]) {
    assert.equal(explicitViewState(locked, 'guild'), false);
    assert.equal(explicitViewState(locked, 'ark-access'), true);
    assert.equal(explicitViewState(locked, 'shadow'), null);
    assert.equal(explicitViewState(locked, 'warframe-access'), null);
    assert.equal(explicitViewState(locked, 'staff'), true);
  }
  assert.equal(unrelated.edits.length, 0);
  assert.equal(explicitViewState(unrelated, 'shadow'), true);
});

test('canonical supporter role names are neutralized even before rank IDs are configured', async () => {
  const roles = new Map([
    ['ark-access', { id: 'ark-access', name: 'ARK: Survival Ascended Access' }],
    ['shadow', { id: 'shadow', name: 'Shadow Recruit' }],
    ['cipher', { id: 'cipher', name: 'Cipher Runner' }]
  ]);
  const state = stateFor({ access: { ark: { roleId: 'ark-access' } } });
  const guild = { id: 'guild', roles: { fetch: async () => roles } };
  const resolved = await resolveModuleAccessPolicyRoles(guild, 'ark', { state });
  assert.equal(resolved.accessRoleId, 'ark-access');
  assert.equal(resolved.rankRoleIds.has('shadow'), true);
  assert.equal(resolved.rankRoleIds.has('cipher'), true);
});

test('missing module access role never locks a category and cannot strand members', async () => {
  const category = fakeChannel({ id: 'ark-category', name: 'ARK Survival Ascended', type: ChannelType.GuildCategory, views: { guild: true } });
  const channels = new Map([[category.id, category]]);
  const roles = new Map([['shadow', { id: 'shadow', name: 'Shadow Recruit' }]]);
  const state = stateFor({ access: { ark: { roleId: 'missing-role' } }, rankRoles: { 'shadow-recruit': 'shadow' } });
  const guild = {
    id: 'guild',
    roles: { fetch: async () => roles },
    channels: { fetch: async () => channels }
  };
  const result = await reconcileExistingModuleAccessPolicies(guild, { state, moduleIds: ['ark'] });
  assert.equal(result.ok, false);
  assert.equal(result.modules[0].reason, 'module-access-role-missing');
  assert.equal(category.edits.length, 0);
  assert.equal(explicitViewState(category, 'guild'), true);
});
