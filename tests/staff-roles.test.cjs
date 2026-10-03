'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const {
  staffAdminRoleIds,
  staffModRoleIds,
  hasStaffAdminRole,
  isStaffAdmin,
  isStaffModOrAbove
} = require('../src/sentinel/staff-roles.cjs');

const ADMIN_ROLE = '111111111111111111';
const MOD_ROLE = '222222222222222222';
const OTHER_ROLE = '444444444444444444';
const OWNER_ID = '999999999999999999';
const ENV = { NEXUS_STAFF_ADMIN_ROLE_IDS: ` ${ADMIN_ROLE} , not-a-role`, NEXUS_STAFF_MOD_ROLE_IDS: MOD_ROLE };

function member(roleIds, perms = [], id = '333333333333333333') {
  return {
    id,
    guild: { ownerId: OWNER_ID },
    roles: { cache: new Map(roleIds.map((roleId) => [roleId, { id: roleId }])) },
    permissions: { has: (bit) => perms.includes(bit) }
  };
}

function interaction(roleIds, perms = [], id = '333333333333333333') {
  return {
    user: { id },
    guild: { ownerId: OWNER_ID },
    member: { roles: { cache: new Map(roleIds.map((roleId) => [roleId, { id: roleId }])) } },
    memberPermissions: { has: (bit) => perms.includes(bit) }
  };
}

test('env parsing keeps only snowflakes and trims whitespace', () => {
  assert.deepEqual(staffAdminRoleIds(ENV), [ADMIN_ROLE]);
  assert.deepEqual(staffModRoleIds(ENV), [MOD_ROLE]);
  assert.deepEqual(staffAdminRoleIds({}), []);
});

test('staff admin role passes admin and mod checks (admin implies mod)', () => {
  for (const subject of [member([ADMIN_ROLE]), interaction([ADMIN_ROLE])]) {
    assert.equal(isStaffAdmin(subject, ENV), true);
    assert.equal(isStaffModOrAbove(subject, ENV), true);
    assert.equal(hasStaffAdminRole(subject, ENV), true);
  }
});

test('staff mod role passes the mod check but never the admin check', () => {
  for (const subject of [member([MOD_ROLE]), interaction([MOD_ROLE])]) {
    assert.equal(isStaffModOrAbove(subject, ENV), true);
    assert.equal(isStaffAdmin(subject, ENV), false);
    assert.equal(hasStaffAdminRole(subject, ENV), false);
  }
});

test('Discord Administrator passes both checks with or without env', () => {
  for (const env of [ENV, {}]) {
    assert.equal(isStaffAdmin(member([], [PermissionFlagsBits.Administrator]), env), true);
    assert.equal(isStaffModOrAbove(interaction([], [PermissionFlagsBits.Administrator]), env), true);
  }
});

test('guild owner passes both checks', () => {
  assert.equal(isStaffAdmin(interaction([], [], OWNER_ID), {}), true);
  assert.equal(isStaffModOrAbove(member([], [], OWNER_ID), {}), true);
});

test('empty or unset env fails closed for role holders', () => {
  for (const env of [{}, { NEXUS_STAFF_ADMIN_ROLE_IDS: '', NEXUS_STAFF_MOD_ROLE_IDS: '  ' }]) {
    assert.equal(isStaffAdmin(member([ADMIN_ROLE]), env), false);
    assert.equal(isStaffModOrAbove(member([ADMIN_ROLE, MOD_ROLE]), env), false);
    assert.equal(hasStaffAdminRole(interaction([ADMIN_ROLE]), env), false);
  }
});

test('a random member with unrelated roles and permissions fails', () => {
  const random = interaction([OTHER_ROLE], [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageGuild]);
  assert.equal(isStaffAdmin(random, ENV), false);
  assert.equal(isStaffModOrAbove(random, ENV), false);
  assert.equal(isStaffAdmin(null, ENV), false);
  assert.equal(isStaffModOrAbove({}, ENV), false);
});

test('API-shaped members with a role id array are supported', () => {
  const apiInteraction = { user: { id: '1' }, member: { roles: [MOD_ROLE] }, memberPermissions: { has: () => false } };
  assert.equal(isStaffModOrAbove(apiInteraction, ENV), true);
  assert.equal(isStaffAdmin(apiInteraction, ENV), false);
});

// Allow-list sites: staff admin role is an extra accepted path; mods are not.
test('allow-list sites accept the staff admin role and keep fail-closed behavior', () => {
  const { isCardAdmin } = require('../src/sentinel/card/card-config.cjs');
  const { isStaff: arkRconIsStaff } = require('../src/sentinel/ark-rcon-config-extension.cjs');
  const { isStaff: opsIsStaff } = require('../src/game-bots/ops-spine.cjs');
  const { isStaff: arkServerIsStaff } = require('../src/sentinel/ark-server-controls-extension.cjs');
  const { isStaff: arkOpsIsStaff } = require('../src/sentinel/ark-ops-extension.cjs');
  const { memberIsAdmin } = require('../src/sentinel/mention-response-extension.cjs');

  const adminRole = interaction([ADMIN_ROLE]);
  const modRole = interaction([MOD_ROLE]);
  const administrator = interaction([], [PermissionFlagsBits.Administrator]);

  assert.equal(isCardAdmin(adminRole, {}, ENV), true);
  assert.equal(isCardAdmin(modRole, {}, ENV), false);
  assert.equal(isCardAdmin(adminRole, {}, {}), false);
  assert.equal(isCardAdmin(administrator, {}, {}), true);

  assert.equal(arkRconIsStaff(adminRole, {}, ENV), true);
  assert.equal(arkRconIsStaff(modRole, {}, ENV), false);
  assert.equal(arkRconIsStaff(adminRole, {}, {}), false);

  assert.equal(opsIsStaff(adminRole, {}, ENV), true);
  assert.equal(opsIsStaff(modRole, {}, ENV), false);
  assert.equal(opsIsStaff(administrator, {}, {}), true);

  assert.equal(arkServerIsStaff(adminRole, {}, ENV), true);
  assert.equal(arkServerIsStaff(modRole, {}, ENV), false);
  assert.equal(arkServerIsStaff(adminRole, {}, {}), false);

  assert.equal(arkOpsIsStaff(adminRole, { discord: {} }, ENV), true);
  assert.equal(arkOpsIsStaff(modRole, { discord: {} }, ENV), false);
  assert.equal(arkOpsIsStaff(adminRole, { discord: {} }, {}), false);

  const msg = (m) => ({ author: { id: m.id }, member: m });
  assert.equal(memberIsAdmin(msg(member([ADMIN_ROLE])), { discord: {} }, ENV), true);
  assert.equal(memberIsAdmin(msg(member([MOD_ROLE])), { discord: {} }, ENV), false);
  assert.equal(memberIsAdmin(msg(member([ADMIN_ROLE])), { discord: {} }, {}), false);
  assert.equal(memberIsAdmin(msg(member([], [PermissionFlagsBits.Administrator])), { discord: {} }, {}), true);
});

const GUILD_ID = '1016059608789434408';
const MANAGED_ROLE = '555555555555555555';
const LOG_GUILD = '121212121212121212';
const LOG_MANAGED = '131313131313131313';

function everyoneCache(extra = [], guildId = GUILD_ID) {
  const entries = [[guildId, { id: guildId, name: '@everyone', managed: false }]];
  for (const role of extra) entries.push([role.id, role]);
  return new Map(entries);
}

function gatedMember(extra = [], { userId = '333333333333333333', guildId = GUILD_ID, perms = [] } = {}) {
  const cache = everyoneCache(extra, guildId);
  const member = {
    id: userId,
    guild: { id: guildId, ownerId: OWNER_ID },
    roles: { cache },
    permissions: { has: (bit) => perms.includes(bit) }
  };
  return {
    id: userId,
    user: { id: userId },
    author: { id: userId },
    guild: { id: guildId, ownerId: OWNER_ID },
    member,
    memberPermissions: { has: (bit) => perms.includes(bit) }
  };
}

function adminSites() {
  const { isCardAdmin } = require('../src/sentinel/card/card-config.cjs');
  const { isStaff: arkRconIsStaff } = require('../src/sentinel/ark-rcon-config-extension.cjs');
  const { isStaff: opsIsStaff } = require('../src/game-bots/ops-spine.cjs');
  const { isStaff: arkServerIsStaff } = require('../src/sentinel/ark-server-controls-extension.cjs');
  const { isStaff: arkOpsIsStaff } = require('../src/sentinel/ark-ops-extension.cjs');
  const { memberIsOperator } = require('../src/sentinel/forge-staff.cjs');
  const { memberIsAdmin } = require('../src/sentinel/mention-response-extension.cjs');
  return [
    ['staff admin', (subject, env, config) => isStaffAdmin(subject, env)],
    ['card admin', (subject, env, config) => isCardAdmin(subject, config, env)],
    ['ark rcon', (subject, env, config) => arkRconIsStaff(subject, config, env)],
    ['ark server', (subject, env, config) => arkServerIsStaff(subject, config, env)],
    ['ark ops', (subject, env, config) => arkOpsIsStaff(subject, config, env)],
    ['ops spine', (subject, env, config) => opsIsStaff(subject, config, env)],
    ['forge', (subject, env, config) => memberIsOperator(subject, config, env)],
    ['mention', (subject, env, config) => memberIsAdmin(subject, config, env)]
  ];
}

test('guild id listed as a staff admin role grants nothing at any admin gate', () => {
  const env = { NEXUS_STAFF_ADMIN_ROLE_IDS: GUILD_ID, NEXUS_STAFF_MOD_ROLE_IDS: '' };
  const subject = gatedMember();
  const config = { discord: { operatorRoleIds: [], ownerUserIds: [] } };
  for (const [name, allow] of adminSites()) {
    assert.equal(allow(subject, env, config), false, name);
  }
});

test('guild id listed as a staff mod role does not grant /clear', () => {
  const { canClear } = require('../src/sentinel/moderation-commands.cjs');
  const env = { NEXUS_STAFF_ADMIN_ROLE_IDS: '', NEXUS_STAFF_MOD_ROLE_IDS: GUILD_ID };
  const subject = gatedMember([], { perms: [PermissionFlagsBits.ManageMessages] });
  assert.equal(canClear(subject, env), false);
});

test('a real admin role still passes when the guild id is also listed', () => {
  const env = { NEXUS_STAFF_ADMIN_ROLE_IDS: `${GUILD_ID}, ${ADMIN_ROLE}`, NEXUS_STAFF_MOD_ROLE_IDS: GUILD_ID };
  const subject = gatedMember([{ id: ADMIN_ROLE, name: 'Admin', managed: false }], { perms: [PermissionFlagsBits.ManageMessages] });
  const config = { discord: { operatorRoleIds: [], ownerUserIds: [] } };
  for (const [name, allow] of adminSites()) {
    assert.equal(allow(subject, env, config), true, name);
  }
  const { canClear } = require('../src/sentinel/moderation-commands.cjs');
  assert.equal(canClear(subject, env), true);
});

test('a managed bot role listed as staff admin grants nothing', () => {
  const env = { NEXUS_STAFF_ADMIN_ROLE_IDS: MANAGED_ROLE, NEXUS_STAFF_MOD_ROLE_IDS: '' };
  const subject = gatedMember([{ id: MANAGED_ROLE, name: 'Bots', managed: true }]);
  const config = { discord: { operatorRoleIds: [], ownerUserIds: [] } };
  for (const [name, allow] of adminSites()) {
    assert.equal(allow(subject, env, config), false, name);
  }
});

test('guild id in operator roles and Vanguard staff roles grants nothing', () => {
  const { hasStaffRole } = require('../src/game-bots/vanguard/config.cjs');
  const env = { VANGUARD_STAFF_ROLE_IDS: GUILD_ID, NEXUS_STAFF_ADMIN_ROLE_IDS: '', NEXUS_STAFF_MOD_ROLE_IDS: '' };
  const subject = gatedMember();
  const config = { discord: { operatorRoleIds: [GUILD_ID], ownerUserIds: [] } };
  assert.equal(hasStaffRole(subject, env), false);
  for (const [name, allow] of adminSites()) {
    assert.equal(allow(subject, env, config), false, name);
  }
});

test('ignored @everyone and managed role ids are logged once each', () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const env = { NEXUS_STAFF_ADMIN_ROLE_IDS: `${LOG_GUILD},${LOG_MANAGED}` };
    const subject = gatedMember(
      [{ id: LOG_MANAGED, name: 'Bots', managed: true }],
      { guildId: LOG_GUILD }
    );
    assert.equal(isStaffAdmin(subject, env), false);
    assert.equal(isStaffAdmin(subject, env), false);
    assert.equal(warnings.filter((line) => line.includes(LOG_GUILD)).length, 1);
    assert.equal(warnings.filter((line) => line.includes(LOG_MANAGED)).length, 1);
  } finally {
    console.warn = original;
  }
});

test('an id listed as both admin and mod stays mod-level and cannot clear', () => {
  const { canClear } = require('../src/sentinel/moderation-commands.cjs');
  const same = '333333333333333333';
  const env = {
    NEXUS_STAFF_ADMIN_ROLE_IDS: same,
    NEXUS_STAFF_MOD_ROLE_IDS: same,
    NEXUS_OPERATOR_ROLE_IDS: same
  };
  const subject = interaction([same], [PermissionFlagsBits.ManageMessages]);
  assert.equal(hasStaffAdminRole(subject, env), false);
  assert.equal(isStaffAdmin(subject, env), false);
  assert.equal(isStaffModOrAbove(subject, env), true);
  assert.equal(canClear(subject, env), false);
  const distinct = interaction([ADMIN_ROLE, MOD_ROLE], [PermissionFlagsBits.ManageMessages]);
  assert.equal(isStaffAdmin(distinct, ENV), true);
  assert.equal(canClear(distinct, { ...ENV, NEXUS_OPERATOR_ROLE_IDS: MOD_ROLE }), true);
});
