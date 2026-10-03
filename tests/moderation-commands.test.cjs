'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const { MAX_CLEAR_MESSAGES, canClear, clearCommand, handleClearCommand } = require('../src/sentinel/moderation-commands.cjs');

function permissions(...allowed) {
  const bits = new Set(allowed);
  return { has: (bit) => bits.has(bit) };
}

test('clear command requires Manage Messages and exposes a bounded amount option', () => {
  const json = clearCommand().toJSON();
  assert.equal(json.name, 'clear');
  assert.equal(json.default_member_permissions, PermissionFlagsBits.ManageMessages.toString());
  const amount = json.options.find((option) => option.name === 'amount');
  assert.ok(amount);
  assert.equal(amount.required, true);
  assert.equal(amount.min_value, 1);
  assert.equal(amount.max_value, MAX_CLEAR_MESSAGES);
  assert.equal(MAX_CLEAR_MESSAGES, 100);
});

test('clear allows Manage Messages or Administrator, and denies anyone with neither', () => {
  assert.equal(canClear({ memberPermissions: permissions(PermissionFlagsBits.ManageMessages) }), true);
  assert.equal(canClear({ memberPermissions: permissions(PermissionFlagsBits.Administrator) }), true);
  assert.equal(canClear({
    memberPermissions: permissions(),
    guild: { ownerId: '1516602943670059101' },
    user: { id: '1516602943670059101' }
  }), true);
  assert.equal(canClear({ memberPermissions: permissions() }), false);
  assert.equal(canClear({
    memberPermissions: permissions(),
    guild: { ownerId: '1516602943670059101' },
    user: { id: '1516640233389822042' }
  }), false);
});

test('clear without Manage Messages is rejected before any channel deletion', async () => {
  let deleted = false;
  let reply = null;
  const interaction = {
    memberPermissions: permissions(),
    options: { getInteger: () => 20 },
    channel: { bulkDelete: async () => { deleted = true; } },
    reply: async (payload) => { reply = payload; return payload; }
  };
  await handleClearCommand(interaction);
  assert.equal(deleted, false);
  assert.equal(reply.content, 'You need Manage Messages to use /clear.');
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
