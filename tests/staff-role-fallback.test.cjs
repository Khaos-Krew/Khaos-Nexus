'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const { resolveStaffRoleIds: resolveSafetyStaffRoleIds } = require('../src/sentinel/safety-report-access.cjs');
const { resolveStaffRoleIds: resolveWorkspaceStaffRoleIds } = require('../src/sentinel/staff-workspace.cjs');
const { resolveAdminRoleIds } = require('../src/sentinel/category-order.cjs');
const { operatorRoleIdsFrom } = require('../src/sentinel/nexus-hq.cjs');

const GUILD = '1616602943670059108';
const CM = '1521219329360920767';
const BOTS = '1616602943670059101';
const OWNER_ROLE = '1616602943670059102';
const MOD = '1616602943670059103';
const ADMIN = '1616602943670059104';
const MISSING = '1616602943670059105';

function role(id, name, bits = [], extras = {}) {
  const allowed = new Set(bits);
  return {
    id,
    name,
    managed: extras.managed === true,
    guild: { id: GUILD },
    permissions: { has: (bit) => allowed.has(bit) }
  };
}

function guildRoles() {
  const items = [
    role(GUILD, '@everyone', [PermissionFlagsBits.Administrator]),
    role(CM, 'Community Manager', [PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild]),
    role(BOTS, 'Bots', [PermissionFlagsBits.Administrator], { managed: true }),
    role(OWNER_ROLE, 'Owner', [PermissionFlagsBits.Administrator]),
    role(MOD, 'Moderator', [PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ModerateMembers]),
    role(ADMIN, 'Administrators', [PermissionFlagsBits.Administrator])
  ];
  return new Map(items.map((item) => [item.id, item]));
}

test('empty or missing staff lists fail closed instead of adopting admin roles', async () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(' '));
  const roles = guildRoles();
  const guild = { id: GUILD, roles: { fetch: async () => roles } };
  try {
    const empty = { discord: { guildId: GUILD, operatorRoleIds: [], safetyStaffRoleIds: [] } };
    const missing = { discord: { guildId: GUILD, operatorRoleIds: [MISSING], safetyStaffRoleIds: [MISSING] } };
    const listed = { discord: { guildId: GUILD, operatorRoleIds: [ADMIN], safetyStaffRoleIds: [ADMIN] } };
    assert.deepEqual(await resolveSafetyStaffRoleIds(guild, empty), []);
    assert.deepEqual(await resolveWorkspaceStaffRoleIds(guild, empty), []);
    assert.deepEqual(await resolveAdminRoleIds(guild, empty), []);
    assert.deepEqual(operatorRoleIdsFrom(roles, empty), []);
    assert.deepEqual(await resolveSafetyStaffRoleIds(guild, missing), []);
    assert.deepEqual(await resolveWorkspaceStaffRoleIds(guild, missing), []);
    assert.deepEqual(await resolveAdminRoleIds(guild, missing), []);
    assert.deepEqual(operatorRoleIdsFrom(roles, missing), []);
    assert.deepEqual(await resolveSafetyStaffRoleIds(guild, listed), [ADMIN]);
    assert.deepEqual(await resolveWorkspaceStaffRoleIds(guild, listed), [ADMIN]);
    assert.deepEqual(await resolveAdminRoleIds(guild, listed), [ADMIN]);
    assert.deepEqual(operatorRoleIdsFrom(roles, listed), [ADMIN]);
  } finally {
    console.warn = original;
  }
  const text = warnings.join('\n');
  assert.match(text, /safety reports/);
  assert.match(text, /staff workspace/);
  assert.match(text, /category order/);
  assert.match(text, /Nexus HQ/);
  assert.match(text, /1521219329360920767/);
  for (const source of ['safety reports', 'staff workspace', 'category order', 'Nexus HQ']) {
    assert.equal(warnings.filter((line) => line.includes(source)).length, 1, source);
  }
});
