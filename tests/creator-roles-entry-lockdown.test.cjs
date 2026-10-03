'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { PermissionFlagsBits } = require('discord.js');
const {
  PANEL_MARKER,
  findRolesChannel,
  entryPayload,
  creatorLockdownEditsNeeded,
  enforceCreatorWorkspaceLock
} = require('../src/sentinel/creator-roles-entry-lockdown-extension.cjs');

function textChannel(id, name) {
  return { id, name, isTextBased: () => true };
}

test('creator application entry lives in the roles surface', () => {
  const channels = new Map([
    ['1', textChannel('1', 'roles')],
    ['2', textChannel('2', 'creator-program')]
  ]);
  assert.equal(findRolesChannel(channels, '').id, '1');
  assert.equal(findRolesChannel(channels, '2').id, '2');
});

test('creator application entry advertises level gate and uses shared apply button', () => {
  const payload = entryPayload(10);
  assert.equal(payload.embeds[0].footer.text, PANEL_MARKER);
  assert.match(payload.embeds[0].fields[0].value, /Level 10\+/i);
  assert.equal(payload.components[0].components[0].data.custom_id, 'kn:creator:apply');
});

test('creator workspace lockdown does not hide public creator feeds', async () => {
  const edits = [];
  const text = (id, name, parentId) => ({
    id,
    name,
    parentId,
    permissionOverwrites: {
      async edit(target, permissions) {
        edits.push({ id, name, target: String(target), permissions });
      }
    }
  });
  const guild = {
    id: '100000000000000010',
    ownerId: '100000000000000001',
    channels: {
      async fetch() {
        return [
          { id: 'creator-cat', name: 'CONTENT CREATOR PROGRAM' },
          { id: 'info', name: 'INFORMATION' },
          text('chat', 'creator-chat', 'creator-cat'),
          text('program', 'creator-program', 'creator-cat'),
          text('apply', 'apply-here', 'creator-cat'),
          text('feed-in', 'creator-feed', 'creator-cat'),
          text('feed-out', 'creator-feed', 'info'),
          text('twitch', 'twitch-live', 'creator-cat'),
          text('youtube', 'youtube-live', 'creator-cat'),
          text('renamed', 'old-name', 'creator-cat')
        ];
      }
    },
    roles: {
      async fetch() {
        return new Map([
          ['200000000000000001', { id: '200000000000000001', name: 'Content Creator', managed: false, permissions: { has: () => false } }]
        ]);
      }
    }
  };
  const result = await enforceCreatorWorkspaceLock(guild, {
    state: { getCreatorMeta: () => ({ creatorRoleId: '200000000000000001', creatorFeedChannelId: 'renamed', programChannelId: 'apply' }) },
    config: { discord: { ownerUserIds: [] } },
    botId: '100000000000000099'
  });
  assert.equal(result.skipped, false);
  assert.equal(result.skippedPublic, 6);
  assert.equal(result.changed, 1);
  assert.deepEqual(edits.map((edit) => edit.name).filter((name, index, list) => list.indexOf(name) === index), ['creator-chat']);
  const hidden = edits.find((edit) => edit.name === 'creator-chat' && edit.target === guild.id);
  assert.equal(hidden.permissions.ViewChannel, false);
  assert.equal(edits.some((edit) => ['creator-feed', 'twitch-live', 'youtube-live', 'old-name', 'creator-program', 'apply-here'].includes(edit.name)), false);
});

test('a no-op creator lockdown tick makes zero permission API calls', async () => {
  const guildId = '100000000000000010';
  const creatorRoleId = '200000000000000001';
  const ownerId = '100000000000000001';
  const botId = '100000000000000099';
  const allow = (...flags) => ({ has: (flag) => flags.includes(flag) });
  const overwrite = (id, { allowFlags = [], denyFlags = [] } = {}) => ({
    id,
    allow: allow(...allowFlags),
    deny: allow(...denyFlags)
  });
  const desired = [
    overwrite(guildId, { denyFlags: [PermissionFlagsBits.ViewChannel] }),
    overwrite(creatorRoleId, { allowFlags: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] }),
    overwrite(ownerId, { allowFlags: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] }),
    overwrite(botId, {
      allowFlags: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageMessages
      ]
    })
  ];
  const apiCalls = [];
  const channel = {
    id: 'chat',
    name: 'creator-chat',
    parentId: 'creator-cat',
    permissionOverwrites: {
      cache: new Map(desired.map((entry) => [entry.id, entry])),
      async edit() { apiCalls.push('edit'); },
      async set() { apiCalls.push('set'); },
      async delete() { apiCalls.push('delete'); }
    }
  };
  assert.equal(creatorLockdownEditsNeeded(channel, {
    guildId,
    creatorRoleId,
    staffRoleIds: [],
    ownerIds: [ownerId],
    botId
  }), false);
  const guild = {
    id: guildId,
    ownerId,
    channels: {
      async fetch() {
        return [
          { id: 'creator-cat', name: 'CONTENT CREATOR PROGRAM' },
          channel,
          { id: 'program', name: 'creator-program', parentId: 'creator-cat', permissionOverwrites: channel.permissionOverwrites }
        ];
      }
    },
    roles: {
      async fetch() {
        return new Map([
          [creatorRoleId, { id: creatorRoleId, name: 'Content Creator', managed: false, permissions: { has: () => false } }]
        ]);
      }
    }
  };
  const result = await enforceCreatorWorkspaceLock(guild, {
    state: { getCreatorMeta: () => ({ creatorRoleId, programChannelId: 'program' }) },
    config: { discord: { ownerUserIds: [] } },
    botId
  });
  assert.equal(result.changed, 0);
  assert.equal(result.apiCalls, 0);
  assert.deepEqual(apiCalls, []);
});
