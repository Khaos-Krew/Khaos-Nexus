'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');
const { createSentinelDiscordGateway } = require('../bot/sentinel-discord-gateway.cjs');

function harness() {
  const calls = [];
  const messages = new Map();
  const channel = {
    send: async (payload) => { calls.push(['send', payload]); return { id: '620000000000000001' }; },
    messages: {
      fetch: async (id) => {
        calls.push(['message-fetch', id]);
        return messages.get(id) || { edit: async (payload) => { calls.push(['edit', id, payload]); return { id }; } };
      },
    },
  };
  const guild = {
    roles: {
      create: async (input) => { calls.push(['role-create', input]); return { id: '710000000000000001' }; },
    },
    channels: {
      create: async (input) => { calls.push(['channel-create', input]); return { id: '610000000000000001' }; },
    },
  };
  const client = {
    guilds: { fetch: async (id) => { calls.push(['guild-fetch', id]); return guild; } },
    channels: { fetch: async (id) => { calls.push(['channel-fetch', id]); return channel; } },
    rest: {
      put: async (route) => calls.push(['rest-put', route]),
      delete: async (route) => calls.push(['rest-delete', route]),
    },
  };
  return { calls, client, guild, channel, messages };
}

test('gateway creates managed roles through the configured guild', async () => {
  const { calls, client } = harness();
  const gateway = createSentinelDiscordGateway({ client, guildId: '500000000000000001' });
  const role = await gateway.createRole({ name: 'Nexus Command' });

  assert.equal(role.id, '710000000000000001');
  assert.equal(calls[0][0], 'guild-fetch');
  assert.equal(calls[0][1], '500000000000000001');
  assert.equal(calls[1][0], 'role-create');
  assert.equal(calls[1][1].name, 'Nexus Command');
});

test('gateway role assignment uses Discord member-role REST routes', async () => {
  const { calls, client } = harness();
  const gateway = createSentinelDiscordGateway({ client, guildId: '500000000000000001' });
  await gateway.addRoleToMember('900000000000000001', '710000000000000001');
  await gateway.removeRoleFromMember('900000000000000001', '710000000000000001');

  assert.equal(calls[0][0], 'rest-put');
  assert.match(calls[0][1], /guilds\/500000000000000001\/members\/900000000000000001\/roles\/710000000000000001/);
  assert.equal(calls[1][0], 'rest-delete');
});

test('gateway refuses to create a hub until the live category binding resolves', async () => {
  const { client } = harness();
  const gateway = createSentinelDiscordGateway({
    client,
    guildId: '500000000000000001',
    resolveCategoryId: async () => '',
  });

  await assert.rejects(
    gateway.createHubChannel({
      hubId: 'about',
      categoryBlueprintId: 'information',
      channelName: 'about',
      channelType: 'text',
    }),
    /No live Discord category binding exists for information/
  );
});

test('gateway creates a hub only under the resolved live category ID', async () => {
  const { calls, client } = harness();
  const gateway = createSentinelDiscordGateway({
    client,
    guildId: '500000000000000001',
    resolveCategoryId: async (key) => key === 'information' ? '600000000000000001' : '',
  });

  const channel = await gateway.createHubChannel({
    hubId: 'about',
    categoryBlueprintId: 'information',
    channelName: 'about',
    channelType: 'text',
  });

  assert.equal(channel.id, '610000000000000001');
  const create = calls.find((call) => call[0] === 'channel-create');
  assert.equal(create[1].parent, '600000000000000001');
  assert.equal(create[1].type, ChannelType.GuildText);
});

test('persistent message create and update resolve the live hub channel binding', async () => {
  const { calls, client } = harness();
  const gateway = createSentinelDiscordGateway({
    client,
    guildId: '500000000000000001',
    resolveChannelId: async (hubId) => hubId === 'server-status' ? '610000000000000010' : '',
  });

  const created = await gateway.createPersistentMessage({
    hubId: 'server-status',
    payload: { embeds: [{ title: 'Status' }] },
  });
  const updated = await gateway.updatePersistentMessage({
    hubId: 'server-status',
    discordMessageId: '620000000000000010',
    payload: { embeds: [{ title: 'Updated Status' }] },
  });

  assert.equal(created.id, '620000000000000001');
  assert.equal(updated.id, '620000000000000010');
  assert.equal(calls.filter((call) => call[0] === 'channel-fetch').length, 2);
  assert.equal(calls.filter((call) => call[0] === 'send').length, 1);
  assert.equal(calls.filter((call) => call[0] === 'edit').length, 1);
});

test('persistent message operations fail closed when no live channel binding exists', async () => {
  const { client } = harness();
  const gateway = createSentinelDiscordGateway({
    client,
    guildId: '500000000000000001',
    resolveChannelId: async () => null,
  });

  await assert.rejects(
    gateway.createPersistentMessage({ hubId: 'server-status', payload: {} }),
    /No live Discord channel binding exists/
  );
});
