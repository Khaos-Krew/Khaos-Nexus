'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const discord = require('discord.js');
const { GatewayIntentBits } = discord;
const {
  ORIGINAL_CLIENT,
  withGuildMembersIntent,
  clientHasGuildMembersIntent,
  installGuildMembersIntentExtension
} = require('../src/sentinel/guild-members-intent-extension.cjs');

test('constructor options preserve existing intents and add GuildMembers', () => {
  const options = withGuildMembersIntent({
    intents:[GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
  });
  assert.equal(options.intents.has(GatewayIntentBits.Guilds), true);
  assert.equal(options.intents.has(GatewayIntentBits.GuildVoiceStates), true);
  assert.equal(options.intents.has(GatewayIntentBits.GuildMembers), true);
});

test('a real discord.js Client constructed with Nexus options sends GuildMembers to websocket identify', () => {
  const client = new ORIGINAL_CLIENT(withGuildMembersIntent({
    intents:[GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
  }));
  assert.equal(clientHasGuildMembersIntent(client), true);
  assert.equal(client.options.intents.has(GatewayIntentBits.GuildMembers), true);
  assert.equal(Boolean(Number(client.ws.options.intents) & GatewayIntentBits.GuildMembers), true);
});

test('installed Nexus Client subclass injects GuildMembers before the discord.js constructor freezes intents', () => {
  const NexusClient = installGuildMembersIntentExtension({ logger:{ log(){} } });
  const client = new NexusClient({ intents:[GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
  assert.equal(clientHasGuildMembersIntent(client), true);
  assert.equal(discord.Client, NexusClient);
});
