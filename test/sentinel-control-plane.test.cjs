'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { STAFF_ROLE_KEYS } = require('../bot/sentinel-role-bindings.cjs');
const {
  CONTROL_PLANE_SCHEMA_VERSION,
  normalizeControlPlane,
  serializeControlPlane,
  permissionContextFromControlPlane,
  controlPlaneReadiness,
} = require('../shared/sentinel-control-plane.cjs');

const GUILD_ID = '123456789012345678';

function fixture() {
  return {
    guildId: GUILD_ID,
    // Legacy lowercase keys are intentionally used here to verify migration.
    staffRoles: {
      owner: { discordRoleId: '223456789012345678' },
      community_manager: { discordRoleId: '323456789012345678' },
      admin: { discordRoleId: '423456789012345678' },
      moderator: { discordRoleId: '523456789012345678' },
    },
    hubs: {
      about: {
        discordCategoryId: '623456789012345678',
        discordChannelId: '723456789012345678',
        discordMessageId: '823456789012345678',
        aliases: ['about-us'],
      },
    },
    roleMenus: {
      community: {
        discordChannelId: '923456789012345678',
        discordMessageId: '103456789012345678',
      },
    },
  };
}

test('control plane migrates legacy staff keys into the canonical functional-role contract', () => {
  const state = normalizeControlPlane(fixture());
  assert.equal(state.schemaVersion, CONTROL_PLANE_SCHEMA_VERSION);
  assert.equal(state.guildId, GUILD_ID);
  assert.equal(state.staffRoles.guildId, GUILD_ID);
  assert.equal(state.staffRoles.roles[STAFF_ROLE_KEYS.OWNER].discordRoleId, '223456789012345678');
  assert.equal(state.staffRoles.roles[STAFF_ROLE_KEYS.ADMIN].discordRoleId, '423456789012345678');
  assert.equal(state.hubs.about.discordChannelId, '723456789012345678');
  assert.equal(state.roleMenus.community.discordMessageId, '103456789012345678');
});

test('control plane serializes canonical role keys to plain persistence-safe data', () => {
  const serialized = serializeControlPlane(fixture());
  assert.equal(serialized.schemaVersion, 1);
  assert.equal(serialized.staffRoles.roles[STAFF_ROLE_KEYS.ADMIN].discordRoleId, '423456789012345678');
  assert.equal(serialized.staffRoles.roles.admin, undefined);
  assert.deepEqual(serialized.hubs.about.aliases, ['about-us']);
  assert.equal(serialized.roleMenus.community.managed, true);
  assert.doesNotThrow(() => JSON.stringify(serialized));
});

test('permission context projects canonical persisted staff role ids', () => {
  const context = permissionContextFromControlPlane(fixture());
  assert.equal(context.guildId, GUILD_ID);
  assert.deepEqual({ ...context.staffRoleIds }, {
    [STAFF_ROLE_KEYS.OWNER]: '223456789012345678',
    [STAFF_ROLE_KEYS.COMMUNITY_MANAGER]: '323456789012345678',
    [STAFF_ROLE_KEYS.ADMIN]: '423456789012345678',
    [STAFF_ROLE_KEYS.MODERATOR]: '523456789012345678',
  });
});

test('readiness reports canonical missing managed bindings without mutating state', () => {
  const source = fixture();
  source.hubs.about.discordMessageId = null;
  source.roleMenus.community.discordChannelId = null;
  source.staffRoles.moderator.discordRoleId = null;
  const readiness = controlPlaneReadiness(source);
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.unresolved, [
    `role:${STAFF_ROLE_KEYS.MODERATOR}`,
    'hub:about:message',
    'menu:community:channel',
  ]);
});

test('control plane rejects duplicate canonical and legacy aliases for the same staff role', () => {
  const source = fixture();
  source.staffRoles[STAFF_ROLE_KEYS.OWNER] = { discordRoleId: '999999999999999999' };
  assert.throws(() => normalizeControlPlane(source), /Duplicate Sentinel staff role binding/i);
});

test('control plane rejects invalid guild identity and fails closed', () => {
  assert.throws(() => normalizeControlPlane({ guildId: 'not-a-guild' }), /valid Discord guild ID/i);
});
