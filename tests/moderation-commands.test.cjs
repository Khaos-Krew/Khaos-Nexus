'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const { MAX_CLEAR_MESSAGES, canClear, clearCommand, handleClearCommand } = require('../src/sentinel/moderation-commands.cjs');

test('clear command is administrator-only and exposes a bounded amount option', () => {
  const json = clearCommand().toJSON();
  assert.equal(json.name, 'clear');
  assert.equal(json.default_member_permissions, PermissionFlagsBits.Administrator.toString());
  const amount = json.options.find((option) => option.name === 'amount');
  assert.ok(amount);
  assert.equal(amount.required, true);
  assert.equal(amount.min_value, 1);
  assert.equal(amount.max_value, MAX_CLEAR_MESSAGES);
  assert.equal(MAX_CLEAR_MESSAGES, 100);
});

test('clear runtime authorization requires Administrator even if command permissions are overridden', () => {
  assert.equal(canClear({ memberPermissions: { has: () => true } }), true);
  assert.equal(canClear({ memberPermissions: { has: () => false } }), false);
});

test('non-admin clear requests are rejected before any channel deletion', async () => {
  let deleted = false;
  let reply = null;
  const interaction = {
    memberPermissions: { has: () => false },
    options: { getInteger: () => 20 },
    channel: { bulkDelete: async () => { deleted = true; } },
    reply: async (payload) => { reply = payload; return payload; }
  };
  await handleClearCommand(interaction);
  assert.equal(deleted, false);
  assert.match(reply.content, /restricted to Discord administrators/i);
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
