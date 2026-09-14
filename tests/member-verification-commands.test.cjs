'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const {
  canGrant,
  memberVerificationCommandDefinition
} = require('../src/sentinel/member-verification-commands.cjs');

test('/o9verify is administrator-only with grant|reject|revoke|status|reopen', () => {
  const json = memberVerificationCommandDefinition().toJSON();
  assert.equal(json.name, 'o9verify');
  assert.equal(json.default_member_permissions, PermissionFlagsBits.Administrator.toString());
  const subs = json.options.map((o) => o.name).sort();
  assert.deepEqual(subs, ['grant', 'reject', 'reopen', 'revoke', 'status']);
});

test('canGrant requires Administrator like /clear', () => {
  assert.equal(canGrant({ memberPermissions: { has: (bit) => bit === PermissionFlagsBits.Administrator } }), true);
  assert.equal(canGrant({ memberPermissions: { has: () => false } }), false);
  assert.equal(canGrant({}), false);
});
