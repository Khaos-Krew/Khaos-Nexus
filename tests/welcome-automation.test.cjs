'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ChannelType } = require('discord.js');
const {
  ensureWelcomeChannel,
  welcomePayload,
  welcomeMember
} = require('../src/sentinel/welcome-extension.cjs');

function category(id, name = 'INFORMATION') {
  return { id, name, type: ChannelType.GuildCategory };
}

function textChannel(id, name, parentId = '') {
  return { id, name, parentId, type: ChannelType.GuildText, isTextBased: () => true };
}

test('Welcome channel is created under INFORMATION when missing', async () => {
  const info = category('info');
  const created = textChannel('welcome', 'welcome', info.id);
  let options = null;
  const guild = {
    channels: {
      fetch: async (id) => id ? null : new Map([[info.id, info]]),
      create: async (value) => { options = value; return created; }
    }
  };
  const result = await ensureWelcomeChannel(guild, {});
  assert.equal(result.created, true);
  assert.equal(result.channel.id, 'welcome');
  assert.equal(options.parent, info.id);
  assert.equal(options.name, 'welcome');
});

test('Welcome payload mentions only the joining member and links resolved onboarding channels', () => {
  const payload = welcomePayload(
    { id: '123' },
    {
      rules: textChannel('rules-id', 'rules'),
      roles: textChannel('roles-id', 'roles'),
      gameServers: textChannel('servers-id', 'game-servers')
    }
  );
  assert.equal(payload.content, '<@123>');
  assert.deepEqual(payload.allowedMentions, { parse: [], users: ['123'] });
  assert.match(payload.embeds[0].description, /Welcome <@123>/);
  assert.match(payload.embeds[0].fields[0].value, /<#rules-id>/);
  assert.match(payload.embeds[0].fields[0].value, /<#roles-id>/);
  assert.match(payload.embeds[0].fields[0].value, /<#servers-id>/);
});

test('Welcome automation ignores bot members', async () => {
  const result = await welcomeMember({ id: 'bot', user: { bot: true }, guild: {} });
  assert.deepEqual(result, { skipped: 'bot-member' });
});

test('Welcome automation sends a member-scoped message in the managed channel', async () => {
  const info = category('info');
  let sent = null;
  const welcome = {
    ...textChannel('welcome', 'welcome', info.id),
    send: async (payload) => { sent = payload; return { id: 'message' }; }
  };
  const rules = textChannel('rules', 'rules', info.id);
  const roles = textChannel('roles', 'roles', info.id);
  const servers = textChannel('servers', 'game-servers', info.id);
  const all = new Map([[info.id, info], [welcome.id, welcome], [rules.id, rules], [roles.id, roles], [servers.id, servers]]);
  const guild = {
    id: 'guild',
    channels: {
      fetch: async (id) => id ? all.get(String(id)) || null : all,
      create: async () => { throw new Error('should not create'); }
    }
  };
  const result = await welcomeMember(
    { id: 'member', user: { bot: false }, guild },
    {},
    { logger: { log() {} } }
  );
  assert.equal(result.channelId, 'welcome');
  assert.equal(sent.content, '<@member>');
  assert.deepEqual(sent.allowedMentions.users, ['member']);
});

test('Sentinal entry installs Welcome automation after Guild Members intent support', () => {
  const entry = fs.readFileSync(path.resolve(__dirname, '../src/sentinel/entry.cjs'), 'utf8');
  assert.match(entry, /installGuildMembersIntentExtension\(\)/);
  assert.match(entry, /installWelcomeExtension\(\)/);
  assert.ok(entry.indexOf('installGuildMembersIntentExtension();') < entry.indexOf('installWelcomeExtension();'));
});
