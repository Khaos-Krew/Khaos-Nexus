'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const {
  canGrant,
  memberVerificationCommandDefinition
} = require('../src/sentinel/member-verification-commands.cjs');

test('/o9verify defaults to ManageGuild (not Administrator) with grant|reject|revoke|status|reopen', () => {
  const json = memberVerificationCommandDefinition().toJSON();
  assert.equal(json.name, 'o9verify');
  assert.equal(json.default_member_permissions, PermissionFlagsBits.ManageGuild.toString());
  assert.notEqual(json.default_member_permissions, PermissionFlagsBits.Administrator.toString());
  const subs = json.options.map((o) => o.name).sort();
  assert.deepEqual(subs, ['grant', 'reject', 'reopen', 'revoke', 'status']);
});

test('canGrant accepts Administrator and rejects everyone else by default', () => {
  assert.equal(canGrant({ memberPermissions: { has: (bit) => bit === PermissionFlagsBits.Administrator } }), true);
  assert.equal(canGrant({ memberPermissions: { has: () => false } }), false);
  assert.equal(canGrant({}), false);
});

const ADMIN_ROLE = '111111111111111111';
const MOD_ROLE = '222222222222222222';
const STAFF_ENV = { NEXUS_STAFF_ADMIN_ROLE_IDS: ADMIN_ROLE, NEXUS_STAFF_MOD_ROLE_IDS: MOD_ROLE };

function withRoles(roleIds, perms = []) {
  return {
    user: { id: '333333333333333333' },
    guild: { ownerId: '999999999999999999' },
    member: { roles: { cache: new Map(roleIds.map((id) => [id, { id }])) } },
    memberPermissions: { has: (bit) => perms.includes(bit) }
  };
}

test('/o9verify: staff mod FAILS even with ManageGuild and ManageMessages', () => {
  assert.equal(canGrant(withRoles([MOD_ROLE], [PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageMessages]), STAFF_ENV), false);
});

test('/o9verify: staff admin role passes without Administrator', () => {
  assert.equal(canGrant(withRoles([ADMIN_ROLE]), STAFF_ENV), true);
});

test('/o9verify: Administrator passes even with empty staff env', () => {
  assert.equal(canGrant(withRoles([], [PermissionFlagsBits.Administrator]), {}), true);
});

test('/o9verify: empty staff env fails closed for the admin role', () => {
  assert.equal(canGrant(withRoles([ADMIN_ROLE]), {}), false);
});

test('/o9verify: handler rejects a staff mod before touching the store', async () => {
  const { handleMemberVerificationInteraction } = require('../src/sentinel/member-verification-commands.cjs');
  const prior = { a: process.env.NEXUS_STAFF_ADMIN_ROLE_IDS, m: process.env.NEXUS_STAFF_MOD_ROLE_IDS };
  process.env.NEXUS_STAFF_ADMIN_ROLE_IDS = ADMIN_ROLE;
  process.env.NEXUS_STAFF_MOD_ROLE_IDS = MOD_ROLE;
  try {
    let reply = null;
    let storeTouched = false;
    const interaction = {
      ...withRoles([MOD_ROLE], [PermissionFlagsBits.ManageGuild]),
      commandName: 'o9verify',
      isChatInputCommand: () => true,
      reply: async (payload) => { reply = payload; }
    };
    const handled = await handleMemberVerificationInteraction(interaction, { storeFactory: () => { storeTouched = true; return {}; } });
    assert.equal(handled, true);
    assert.equal(storeTouched, false);
    assert.match(reply.content, /Only staff Admins can use this/);
  } finally {
    if (prior.a === undefined) delete process.env.NEXUS_STAFF_ADMIN_ROLE_IDS; else process.env.NEXUS_STAFF_ADMIN_ROLE_IDS = prior.a;
    if (prior.m === undefined) delete process.env.NEXUS_STAFF_MOD_ROLE_IDS; else process.env.NEXUS_STAFF_MOD_ROLE_IDS = prior.m;
  }
});
