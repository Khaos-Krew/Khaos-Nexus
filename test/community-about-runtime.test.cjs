'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const { DEFAULT_LAYOUT } = require('../shared/discord-automation.cjs');
const {
  ABOUT_MARKER,
  ABOUT_TOPIC,
  aboutPermissionOverwrites,
  findCanonicalInvite,
  renderAboutMessage,
  ensureCommunityAbout
} = require('../bot/community-about-runtime.cjs');

test('default Nexus information layout includes the managed about channel', () => {
  const information = DEFAULT_LAYOUT.categories.find((category) => category.id === 'information');
  const about = information?.channels.find((channel) => channel.id === 'about');
  assert.equal(about?.name, 'about');
  assert.equal(about?.type, 'text');
  assert.equal(about?.topic, ABOUT_TOPIC);
});

test('about permissions preserve existing overwrites while keeping members read-only and Sentinel writable', () => {
  const existing = [{ id: '77777', type: 0, allow: '32', deny: '64' }];
  const overwrites = aboutPermissionOverwrites(existing, '11111', '99999');
  assert.deepEqual(overwrites[0], existing[0]);
  const everyone = overwrites.find((entry) => entry.id === '11111' && entry.type === 0);
  const sentinel = overwrites.find((entry) => entry.id === '99999' && entry.type === 1);
  assert.ok(BigInt(everyone.deny) & PermissionFlagsBits.SendMessages);
  assert.ok(BigInt(everyone.deny) & PermissionFlagsBits.AddReactions);
  assert.ok(BigInt(everyone.deny) & PermissionFlagsBits.CreatePublicThreads);
  assert.ok(BigInt(sentinel.allow) & PermissionFlagsBits.SendMessages);
  assert.ok(BigInt(sentinel.allow) & PermissionFlagsBits.EmbedLinks);
  assert.ok(BigInt(sentinel.allow) & PermissionFlagsBits.CreateInstantInvite);
});

test('canonical invite selection prefers a permanent Sentinel invite and falls back to any permanent invite', () => {
  const invites = [
    { code: 'temporary', max_age: 3600, max_uses: 0, temporary: false, inviter: { id: '99999' } },
    { code: 'community', max_age: 0, max_uses: 0, temporary: false, inviter: { id: '77777' } },
    { code: 'sentinel', max_age: 0, max_uses: 0, temporary: false, inviter: { id: '99999' } }
  ];
  assert.equal(findCanonicalInvite(invites, '99999').code, 'sentinel');
  assert.equal(findCanonicalInvite(invites.slice(0, 2), '99999').code, 'community');
});

test('about message contains the permanent share link, link button, and managed marker', () => {
  const payload = renderAboutMessage('https://discord.gg/khaos');
  const text = JSON.stringify(payload);
  assert.match(text, /Welcome to Khaos Nexus/);
  assert.match(text, /https:\/\/discord\.gg\/khaos/);
  assert.match(text, /does not expire and has unlimited uses/);
  assert.equal(payload.components[0].components[0].style, 5);
  assert.equal(payload.embeds[0].footer.text, ABOUT_MARKER);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
});

test('community About sync creates missing resources once and reuses them on the next pass', async () => {
  const calls = [];
  const channels = [];
  const invites = [];
  const messages = [];
  let nextMessageId = 44444;
  const rest = {
    async get(route) {
      calls.push({ method: 'get', route });
      if (route === '/guilds/11111/channels') return channels;
      if (route === '/channels/33333/invites') return invites;
      if (route === '/channels/33333/messages') return messages;
      throw new Error(`Unexpected GET ${route}`);
    },
    async post(route, { body }) {
      calls.push({ method: 'post', route, body });
      if (route === '/guilds/11111/channels' && body.type === 4) {
        const category = { id: '22222', name: 'NEXUS INFORMATION', type: 4, parent_id: null };
        channels.push(category);
        return category;
      }
      if (route === '/guilds/11111/channels' && body.type === 0) {
        const channel = { id: '33333', ...body };
        channels.push(channel);
        return channel;
      }
      if (route === '/channels/33333/invites') {
        const invite = { code: 'nexus', max_age: 0, max_uses: 0, temporary: false, inviter: { id: '99999' } };
        invites.push(invite);
        return invite;
      }
      if (route === '/channels/33333/messages') {
        const message = { id: String(nextMessageId++), author: { id: '99999' }, embeds: body.embeds, components: body.components };
        messages.unshift(message);
        return message;
      }
      throw new Error(`Unexpected POST ${route}`);
    },
    async patch(route, { body }) {
      calls.push({ method: 'patch', route, body });
      if (route.startsWith('/channels/33333/messages/')) return { id: route.split('/').at(-1), author: { id: '99999' }, embeds: body.embeds };
      if (route === '/channels/33333') {
        Object.assign(channels.find((channel) => channel.id === '33333'), body);
        return channels.find((channel) => channel.id === '33333');
      }
      throw new Error(`Unexpected PATCH ${route}`);
    }
  };
  const client = { rest, user: { id: '99999' } };

  const first = await ensureCommunityAbout({ client, guildId: '11111' });
  assert.equal(first.createdCategory, true);
  assert.equal(first.createdChannel, true);
  assert.equal(first.createdInvite, true);
  assert.equal(first.createdMessage, true);
  assert.equal(first.inviteUrl, 'https://discord.gg/nexus');

  const createPostsAfterFirst = calls.filter((call) => call.method === 'post').length;
  const second = await ensureCommunityAbout({ client, guildId: '11111' });
  assert.equal(second.createdCategory, false);
  assert.equal(second.createdChannel, false);
  assert.equal(second.createdInvite, false);
  assert.equal(second.createdMessage, false);
  assert.equal(calls.filter((call) => call.method === 'post').length, createPostsAfterFirst);
  assert.equal(messages.length, 1);
  assert.ok(calls.some((call) => call.method === 'patch' && call.route === '/channels/33333/messages/44444'));
});
