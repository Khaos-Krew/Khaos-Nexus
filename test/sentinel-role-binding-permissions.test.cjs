'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STAFF_ROLE_KEYS,
  normalizeGuildRoleBindings,
  toPermissionRoleIds,
} = require('../bot/sentinel-role-bindings.cjs');
const {
  functionalRoleForInteraction,
  adapterRoleForInteraction,
  permissionDecision,
} = require('../bot/sentinel-permissions.cjs');

const guildId = '123456789012345678';
const ownerUserId = '700000000000000001';

function interaction(userId, roleIds = []) {
  return {
    user: { id: userId },
    member: { roles: roleIds },
    memberPermissions: { has: () => false },
  };
}

const bindings = normalizeGuildRoleBindings(guildId, {
  [STAFF_ROLE_KEYS.OWNER]: { discordRoleId: '710000000000000001' },
  [STAFF_ROLE_KEYS.COMMUNITY_MANAGER]: { discordRoleId: '710000000000000002' },
  [STAFF_ROLE_KEYS.ADMIN]: { discordRoleId: '710000000000000003' },
  [STAFF_ROLE_KEYS.MODERATOR]: { discordRoleId: '710000000000000004' },
});
const staffRoleIds = toPermissionRoleIds(bindings);

test('persisted staff bindings project directly into the existing permission engine', () => {
  assert.deepEqual(staffRoleIds, {
    OWNER: '710000000000000001',
    COMMUNITY_MANAGER: '710000000000000002',
    ADMIN: '710000000000000003',
    MODERATOR: '710000000000000004',
  });

  assert.equal(
    functionalRoleForInteraction(
      interaction('700000000000000099', ['710000000000000002']),
      ownerUserId,
      staffRoleIds,
    ),
    'COMMUNITY_MANAGER',
  );
});

test('Nexus Prime role projects to operator but not raw adapter owner', () => {
  const primeRoleOnly = interaction('700000000000000099', ['710000000000000001']);
  assert.equal(adapterRoleForInteraction(primeRoleOnly, ownerUserId, staffRoleIds), 'operator');
  assert.equal(permissionDecision({
    interaction: primeRoleOnly,
    commandName: 'rcon',
    ownerUserId,
    staffRoleIds,
  }).allowed, false);
});

test('configured owner identity remains the hard boundary for raw owner actions', () => {
  const owner = interaction(ownerUserId, []);
  assert.equal(adapterRoleForInteraction(owner, ownerUserId, staffRoleIds), 'owner');
  assert.equal(permissionDecision({
    interaction: owner,
    commandName: 'rcon',
    ownerUserId,
    staffRoleIds,
  }).allowed, true);
});

test('Nexus Warden remains viewer-level at the game adapter boundary', () => {
  const warden = interaction('700000000000000099', ['710000000000000004']);
  assert.equal(adapterRoleForInteraction(warden, ownerUserId, staffRoleIds), 'viewer');
});
