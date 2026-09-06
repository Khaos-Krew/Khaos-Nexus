'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { commands, handle, linked } = require('../src/sentinel/protocol/discord.cjs');
test('Protocol command schemas serialize and staff mutation cannot be invoked by ordinary members', async () => {
  assert.deepEqual(commands().map((c) => c.toJSON().name), ['protocol', 'darkzone']);
  const interaction = { isChatInputCommand: () => true, commandName: 'protocol', guildId: 'g', user: { id: '12345' }, options: { getSubcommand: () => 'record' }, deferReply: () => assert.fail('must authorize first') };
  await assert.rejects(handle(interaction, { guildId: 'g', config: { discord: {} } }), /staff authorization/);
});
test('other guilds and unrelated interactions are ignored', async () => {
  assert.equal(await handle({ isChatInputCommand: () => true, commandName: 'protocol', guildId: 'elsewhere' }, { guildId: 'g' }), false);
  assert.equal(await handle({ isChatInputCommand: () => true, commandName: 'unrelated' }, {}), false);
});
test('linked identity required for participation; multiple ARK accounts use one score identity', () => {
  assert.throws(() => linked({ profileByDiscord: () => null }, '12345'), /Link/);
  assert.equal(linked({ profileByDiscord: () => ({ arkAccounts: [{ eosId: 'a' }, { eosId: 'b' }] }) }, '12345'), '12345');
});
test('live Dark Zone enrollment never mutates policy without verified game protection', async () => {
  let output;
  const interaction = { isChatInputCommand: () => true, commandName: 'darkzone', guildId: 'g', user: { id: '12345' }, options: { getSubcommand: () => 'enlist' }, deferReply: async () => {}, editReply: async (v) => { output = v; } };
  await handle(interaction, { guildId: 'g', darkzone: { enlist: () => assert.fail('must remain contained') } });
  assert.match(output.content, /CONTAINED/);
});
