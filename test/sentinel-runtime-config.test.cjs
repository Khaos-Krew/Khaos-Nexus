'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { STAFF_ROLE_KEYS } = require('../bot/sentinel-role-bindings.cjs');
const {
  cleanRoleMap,
  staffRoleIdsFromDiscordConfig,
} = require('../bot/sentinel-runtime-config.cjs');

const GUILD_ID = '123456789012345678';

test('runtime config preserves valid legacy role maps and discards invalid ids', () => {
  assert.deepEqual({ ...cleanRoleMap({ ADMIN: '223456789012345678', bad: 'not-an-id' }) }, {
    ADMIN: '223456789012345678',
  });
});

test('runtime config prefers the normalized Sentinel control plane over legacy maps', () => {
  const result = staffRoleIdsFromDiscordConfig({
    guildId: GUILD_ID,
    staffRoleIds: { [STAFF_ROLE_KEYS.ADMIN]: '999999999999999999' },
    sentinelControlPlane: {
      staffRoles: {
        owner: { discordRoleId: '223456789012345678' },
        admin: { discordRoleId: '323456789012345678' },
        community_manager: { managed: false },
        moderator: { managed: false },
      },
    },
  });

  assert.deepEqual({ ...result }, {
    [STAFF_ROLE_KEYS.OWNER]: '223456789012345678',
    [STAFF_ROLE_KEYS.ADMIN]: '323456789012345678',
  });
});

test('malformed control-plane state fails closed instead of falling back to privileged legacy mappings', () => {
  let error = null;
  const result = staffRoleIdsFromDiscordConfig({
    guildId: 'bad-guild',
    staffRoleIds: { [STAFF_ROLE_KEYS.ADMIN]: '999999999999999999' },
    sentinelControlPlane: {
      staffRoles: { admin: { discordRoleId: '323456789012345678' } },
    },
  }, {
    onInvalidControlPlane: (caught) => { error = caught; },
  });

  assert.deepEqual({ ...result }, {});
  assert.match(error?.message || '', /valid Discord guild ID/i);
});
