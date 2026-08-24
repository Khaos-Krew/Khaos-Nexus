'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GatewayIntentBits, IntentsBitField } = require('discord.js');
const {
  GATEWAY_GUILD_MEMBERS,
  GATEWAY_GUILD_MEMBERS_LIMITED,
  applicationAllowsGuildMembers,
  applyGuildMembersIntent,
  prepareGuildMembersIntent
} = require('../src/sentinel/guild-members-intent-extension.cjs');

function clientWithFrozenIntents() {
  const initial = new IntentsBitField([GatewayIntentBits.Guilds]).freeze();
  return { options:{ intents:initial }, ws:{ options:{ intents:initial.bitfield } } };
}

test('application flags recognize both full and limited Guild Members authorization', () => {
  assert.equal(applicationAllowsGuildMembers(0), false);
  assert.equal(applicationAllowsGuildMembers(GATEWAY_GUILD_MEMBERS), true);
  assert.equal(applicationAllowsGuildMembers(GATEWAY_GUILD_MEMBERS_LIMITED), true);
});

test('authorized intent replaces the frozen Client bitfield and websocket identify bitfield', () => {
  const client = clientWithFrozenIntents();
  assert.equal(client.options.intents.has(GatewayIntentBits.GuildMembers), false);
  assert.equal(applyGuildMembersIntent(client), true);
  assert.equal(client.options.intents.has(GatewayIntentBits.GuildMembers), true);
  assert.equal(Boolean(client.ws.options.intents & GatewayIntentBits.GuildMembers), true);
  assert.equal(client.options.intents.has(GatewayIntentBits.Guilds), true);
});

test('preflight adds GuildMembers only when Discord application flags authorize it', async () => {
  const client = clientWithFrozenIntents();
  const result = await prepareGuildMembersIntent(client, 'token', {
    rest:{ get:async () => ({ flags:GATEWAY_GUILD_MEMBERS_LIMITED }) },
    logger:{ log(){}, warn(){} }
  });
  assert.equal(result.enabled, true);
  assert.equal(client.options.intents.has(GatewayIntentBits.GuildMembers), true);
  assert.equal(Boolean(client.ws.options.intents & GatewayIntentBits.GuildMembers), true);
});

test('preflight leaves GuildMembers disabled when the portal privilege is off', async () => {
  const client = clientWithFrozenIntents();
  const originalWsIntents = client.ws.options.intents;
  const result = await prepareGuildMembersIntent(client, 'token', {
    rest:{ get:async () => ({ flags:0 }) },
    logger:{ log(){}, warn(){} }
  });
  assert.equal(result.enabled, false);
  assert.equal(client.options.intents.has(GatewayIntentBits.GuildMembers), false);
  assert.equal(client.ws.options.intents, originalWsIntents);
});

test('preflight failure keeps Sentinal on its non-privileged intent set', async () => {
  const client = clientWithFrozenIntents();
  const originalWsIntents = client.ws.options.intents;
  const result = await prepareGuildMembersIntent(client, 'token', {
    rest:{ get:async () => { throw new Error('network'); } },
    logger:{ log(){}, warn(){} }
  });
  assert.equal(result.enabled, false);
  assert.equal(result.source, 'preflight-error');
  assert.equal(client.options.intents.has(GatewayIntentBits.GuildMembers), false);
  assert.equal(client.ws.options.intents, originalWsIntents);
});
