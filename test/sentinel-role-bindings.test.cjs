'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STAFF_ROLE_KEYS,
  DEFAULT_DISPLAY_NAMES,
  normalizeGuildRoleBindings,
  serializeGuildRoleBindings,
  resolveFunctionalRoleFromMember,
  planStaffRoleAdoption,
} = require('../bot/sentinel-role-bindings.cjs');

const guildId = '123456789012345678';

function configuredBindings() {
  return normalizeGuildRoleBindings(guildId, {
    [STAFF_ROLE_KEYS.OWNER]: { discordRoleId: '200000000000000001' },
    [STAFF_ROLE_KEYS.COMMUNITY_MANAGER]: { discordRoleId: '200000000000000002' },
    [STAFF_ROLE_KEYS.ADMIN]: { discordRoleId: '200000000000000003' },
    [STAFF_ROLE_KEYS.MODERATOR]: { discordRoleId: '200000000000000004' },
  });
}

test('staff role bindings use stable functional keys instead of display names', () => {
  const bindings = normalizeGuildRoleBindings(guildId, {
    [STAFF_ROLE_KEYS.ADMIN]: {
      discordRoleId: '200000000000000003',
      displayName: 'A Completely Different Visible Name',
    },
  });

  assert.equal(bindings.roles.ADMIN.roleKey, STAFF_ROLE_KEYS.ADMIN);
  assert.equal(bindings.roles.ADMIN.discordRoleId, '200000000000000003');
  assert.equal(resolveFunctionalRoleFromMember(['200000000000000003'], bindings), STAFF_ROLE_KEYS.ADMIN);
});

test('default staff display names preserve the approved Nexus naming', () => {
  assert.equal(DEFAULT_DISPLAY_NAMES.OWNER, 'Nexus Prime');
  assert.equal(DEFAULT_DISPLAY_NAMES.COMMUNITY_MANAGER, 'Nexus Architect');
  assert.equal(DEFAULT_DISPLAY_NAMES.ADMIN, 'Nexus Command');
  assert.equal(DEFAULT_DISPLAY_NAMES.MODERATOR, 'Nexus Warden');
});

test('highest configured functional role wins when a member has multiple staff roles', () => {
  const bindings = configuredBindings();
  assert.equal(
    resolveFunctionalRoleFromMember([
      '200000000000000004',
      '200000000000000002',
    ], bindings),
    STAFF_ROLE_KEYS.COMMUNITY_MANAGER,
  );
});

test('serialization preserves role IDs and aliases without using display names as authority', () => {
  const bindings = normalizeGuildRoleBindings(guildId, {
    [STAFF_ROLE_KEYS.MODERATOR]: {
      discordRoleId: '200000000000000004',
      displayName: 'Renamed Warden',
      aliases: ['Nexus Warden', 'Old Mod Name', 'Nexus Warden'],
    },
  });

  const serialized = serializeGuildRoleBindings(bindings);
  assert.equal(serialized.schemaVersion, 1);
  assert.equal(serialized.guildId, guildId);
  assert.equal(serialized.roles.MODERATOR.discordRoleId, '200000000000000004');
  assert.deepEqual(serialized.roles.MODERATOR.aliases, ['Nexus Warden', 'Old Mod Name']);
});

test('role adoption prefers an existing configured Discord role ID', () => {
  const bindings = configuredBindings();
  const roles = [
    { id: '200000000000000003', name: 'Renamed Admin Role' },
    { id: '900000000000000001', name: 'Nexus Command' },
  ];

  const admin = planStaffRoleAdoption(roles, bindings)
    .find((entry) => entry.roleKey === STAFF_ROLE_KEYS.ADMIN);

  assert.deepEqual(admin, {
    roleKey: STAFF_ROLE_KEYS.ADMIN,
    action: 'keep',
    discordRoleId: '200000000000000003',
    reason: 'id',
  });
});

test('role adoption can bind a single existing alias instead of creating a duplicate', () => {
  const bindings = normalizeGuildRoleBindings(guildId, {
    [STAFF_ROLE_KEYS.ADMIN]: {
      displayName: 'Nexus Command',
      aliases: ['Administrator'],
    },
  });

  const admin = planStaffRoleAdoption([
    { id: '300000000000000003', name: 'Administrator' },
  ], bindings).find((entry) => entry.roleKey === STAFF_ROLE_KEYS.ADMIN);

  assert.equal(admin.action, 'adopt');
  assert.equal(admin.discordRoleId, '300000000000000003');
  assert.equal(admin.reason, 'alias');
});

test('ambiguous alias matches require review and never create or auto-bind a role', () => {
  const bindings = normalizeGuildRoleBindings(guildId, {
    [STAFF_ROLE_KEYS.MODERATOR]: {
      aliases: ['Legacy Mod'],
    },
  });

  const moderator = planStaffRoleAdoption([
    { id: '400000000000000001', name: 'Legacy Mod' },
    { id: '400000000000000002', name: 'Legacy Mod' },
  ], bindings).find((entry) => entry.roleKey === STAFF_ROLE_KEYS.MODERATOR);

  assert.equal(moderator.action, 'review');
  assert.equal(moderator.reason, 'ambiguous-alias');
  assert.deepEqual(moderator.candidates, ['400000000000000001', '400000000000000002']);
});

test('missing managed roles are planned for creation while unmanaged bindings remain unbound', () => {
  const bindings = normalizeGuildRoleBindings(guildId, {
    [STAFF_ROLE_KEYS.OWNER]: { managed: false },
  });

  const plan = planStaffRoleAdoption([], bindings);
  const owner = plan.find((entry) => entry.roleKey === STAFF_ROLE_KEYS.OWNER);
  const admin = plan.find((entry) => entry.roleKey === STAFF_ROLE_KEYS.ADMIN);

  assert.equal(owner.action, 'unbound');
  assert.equal(admin.action, 'create');
});
