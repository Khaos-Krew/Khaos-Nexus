'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const { MAX_CLEAR_MESSAGES, canClear, clearCommand, handleClearCommand } = require('../src/sentinel/moderation-commands.cjs');

const GUILD = '1516602943670059108';
const OWNER = '1516602943670059101';
const ADMIN_ROLE = '1516640233389822042';
const MOD_ROLE = '1540867019979890829';
const BOT_ROLE = '1541540961937526916';

function permissions(...allowed) {
  const bits = new Set(allowed);
  return { has: (bit) => bits.has(bit) };
}

function actor({ bits = [], roles = [], userId = '222222222222222222', ownerId = OWNER, guildId = GUILD } = {}) {
  return {
    memberPermissions: permissions(...bits),
    user: { id: userId },
    guild: { id: guildId, ownerId },
    member: {
      roles: {
        cache: new Map(roles.map((role) => [role.id, role]))
      }
    }
  };
}

test('clear command requires Manage Guild and exposes a bounded amount option', () => {
  const json = clearCommand().toJSON();
  assert.equal(json.name, 'clear');
  assert.equal(json.default_member_permissions, PermissionFlagsBits.ManageGuild.toString());
  const amount = json.options.find((option) => option.name === 'amount');
  assert.ok(amount);
  assert.equal(amount.required, true);
  assert.equal(amount.min_value, 1);
  assert.equal(amount.max_value, MAX_CLEAR_MESSAGES);
  assert.equal(MAX_CLEAR_MESSAGES, 100);
});

test('clear is limited to Admins who can manage messages', () => {
  const env = { NEXUS_OPERATOR_ROLE_IDS: ADMIN_ROLE };
  const admin = actor({
    bits: [PermissionFlagsBits.ManageMessages],
    roles: [
      { id: GUILD, name: '@everyone' },
      { id: ADMIN_ROLE, name: 'Admin' }
    ]
  });
  const mod = actor({
    bits: [PermissionFlagsBits.ManageMessages],
    roles: [
      { id: GUILD, name: '@everyone' },
      { id: MOD_ROLE, name: 'Mod' }
    ]
  });
  assert.equal(canClear(admin, env), true);
  assert.equal(canClear(mod, env), false);
  assert.equal(canClear(actor({
    bits: [PermissionFlagsBits.Administrator]
  }), { NEXUS_OPERATOR_ROLE_IDS: '' }), true);
  assert.equal(canClear(actor({
    bits: [PermissionFlagsBits.ManageMessages],
    roles: [{ id: ADMIN_ROLE, name: 'Admin' }]
  }), { NEXUS_OPERATOR_ROLE_IDS: '' }), false);
  assert.equal(canClear(actor({
    roles: [{ id: ADMIN_ROLE, name: 'Admin' }]
  }), env), false);
});

test('guild id in NEXUS_OPERATOR_ROLE_IDS grants a Mod nothing', () => {
  const mod = actor({
    bits: [PermissionFlagsBits.ManageMessages],
    roles: [
      { id: GUILD, name: '@everyone' },
      { id: MOD_ROLE, name: 'Mod' },
      { id: BOT_ROLE, name: 'Nexus Sentinal', managed: true }
    ]
  });
  assert.equal(canClear(mod, { NEXUS_OPERATOR_ROLE_IDS: GUILD }), false);
  assert.equal(canClear(mod, { NEXUS_OPERATOR_ROLE_IDS: `${GUILD}, ${BOT_ROLE}` }), false);
});

test('clear without admin access is rejected before any channel deletion', async () => {
  let deleted = false;
  let reply = null;
  const interaction = {
    ...actor({
      bits: [PermissionFlagsBits.ManageMessages],
      roles: [
        { id: GUILD, name: '@everyone' },
        { id: MOD_ROLE, name: 'Mod' }
      ]
    }),
    options: { getInteger: () => 20 },
    channel: { bulkDelete: async () => { deleted = true; } },
    reply: async (payload) => { reply = payload; return payload; }
  };
  const previous = process.env.NEXUS_OPERATOR_ROLE_IDS;
  process.env.NEXUS_OPERATOR_ROLE_IDS = ADMIN_ROLE;
  try {
    await handleClearCommand(interaction);
  } finally {
    if (previous === undefined) delete process.env.NEXUS_OPERATOR_ROLE_IDS;
    else process.env.NEXUS_OPERATOR_ROLE_IDS = previous;
  }
  assert.equal(deleted, false);
  assert.equal(reply.content, 'Only Admins can use /clear.');
});

test('admin clear deletes the requested recent messages and responds privately', async () => {
  const calls = [];
  let edited = null;
  const interaction = {
    memberPermissions: { has: () => true },
    options: { getInteger: () => 25 },
    channel: {
      id: '123456789012345678',
      bulkDelete: async (amount, filterOld) => {
        calls.push({ amount, filterOld });
        return new Map(Array.from({ length: 25 }, (_, index) => [String(index), {}]));
      }
    },
    deferReply: async () => {},
    editReply: async (payload) => { edited = payload; return payload; }
  };
  await handleClearCommand(interaction);
  assert.deepEqual(calls, [{ amount: 25, filterOld: true }]);
  assert.match(edited.content, /Cleared \*\*25\*\* messages/);
});

test('clear reports when Discord leaves older messages untouched', async () => {
  let edited = null;
  const interaction = {
    memberPermissions: { has: () => true },
    options: { getInteger: () => 10 },
    channel: {
      id: '123456789012345678',
      bulkDelete: async () => new Map(Array.from({ length: 7 }, (_, index) => [String(index), {}]))
    },
    deferReply: async () => {},
    editReply: async (payload) => { edited = payload; return payload; }
  };
  await handleClearCommand(interaction);
  assert.match(edited.content, /Cleared \*\*7\*\* messages/);
  assert.match(edited.content, /older than 14 days/i);
  assert.match(edited.content, /3 requested messages were left untouched/i);
});
