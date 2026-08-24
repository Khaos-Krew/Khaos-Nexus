'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GatewayIntentBits, IntentsBitField } = require('discord.js');
const {
  GATEWAY_GUILD_MEMBERS,
  GATEWAY_GUILD_MEMBERS_LIMITED,
  applicationAllowsGuildMembers,
  prepareGuildMembersIntent
} = require('../src/sentinel/guild-members-intent-extension.cjs');

test('application flags recognize both full and limited Guild Members authorization', () => {
  assert.equal(applicationAllowsGuildMembers(0), false);
  assert.equal(applicationAllowsGuildMembers(GATEWAY_GUILD_MEMBERS), true);
  assert.equal(applicationAllowsGuildMembers(GATEWAY_GUILD_MEMBERS_LIMITED), true);
});

test('preflight adds GuildMembers only when Discord application flags authorize it', async () => {
  const intents = new IntentsBitField([GatewayIntentBits.Guilds]);
  const client = { options:{ intents } };
  const result = await prepareGuildMembersIntent(client, 'token', {
    rest:{ get:async () => ({ flags:GATEWAY_GUILD_MEMBERS_LIMITED }) },
    logger:{ log(){}, warn(){} }
  });
  assert.equal(result.enabled, true);
  assert.equal(intents.has(GatewayIntentBits.GuildMembers), true);
});

test('preflight leaves GuildMembers disabled when the portal privilege is off', async () => {
  const intents = new IntentsBitField([GatewayIntentBits.Guilds]);
  const client = { options:{ intents } };
  const result = await prepareGuildMembersIntent(client, 'token', {
    rest:{ get:async () => ({ flags:0 }) },
    logger:{ log(){}, warn(){} }
  });
  assert.equal(result.enabled, false);
  assert.equal(intents.has(GatewayIntentBits.GuildMembers), false);
});

test('preflight failure keeps Sentinal on its non-privileged intent set', async () => {
  const intents = new IntentsBitField([GatewayIntentBits.Guilds]);
  const client = { options:{ intents } };
  const result = await prepareGuildMembersIntent(client, 'token', {
    rest:{ get:async () => { throw new Error('network'); } },
    logger:{ log(){}, warn(){} }
  });
  assert.equal(result.enabled, false);
  assert.equal(result.source, 'preflight-error');
  assert.equal(intents.has(GatewayIntentBits.GuildMembers), false);
});
