'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
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

test('control plane normalizes existing Sentinel binding registries into one guild-scoped snapshot', () => {
  const state = normalizeControlPlane(fixture());
  assert.equal(state.schemaVersion, CONTROL_PLANE_SCHEMA_VERSION);
  assert.equal(state.guildId, GUILD_ID);
  assert.equal(state.staffRoles.guildId, GUILD_ID);
  assert.equal(state.hubs.about.discordChannelId, '723456789012345678');
  assert.equal(state.roleMenus.community.discordMessageId, '103456789012345678');
});

test('control plane serializes to plain persistence-safe data', () => {
  const serialized = serializeControlPlane(fixture());
  assert.equal(serialized.schemaVersion, 1);
  assert.equal(serialized.staffRoles.roles.admin.discordRoleId, '423456789012345678');
  assert.deepEqual(serialized.hubs.about.aliases, ['about-us']);
  assert.equal(serialized.roleMenus.community.managed, true);
  assert.doesNotThrow(() => JSON.stringify(serialized));
});

test('permission context projects only persisted staff role ids', () => {
  const context = permissionContextFromControlPlane(fixture());
  assert.equal(context.guildId, GUILD_ID);
  assert.deepEqual({ ...context.staffRoleIds }, {
    owner: '223456789012345678',
    community_manager: '323456789012345678',
    admin: '423456789012345678',
    moderator: '523456789012345678',
  });
});

test('readiness reports missing managed bindings without mutating state', () => {
  const source = fixture();
  source.hubs.about.discordMessageId = null;
  source.roleMenus.community.discordChannelId = null;
  source.staffRoles.moderator.discordRoleId = null;
  const readiness = controlPlaneReadiness(source);
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.unresolved, [
    'role:moderator',
    'hub:about:message',
    'menu:community:channel',
  ]);
});

test('control plane rejects invalid guild identity and fails closed', () => {
  assert.throws(() => normalizeControlPlane({ guildId: 'not-a-guild' }), /valid Discord guild ID/i);
});
