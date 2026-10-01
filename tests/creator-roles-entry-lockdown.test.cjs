'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PANEL_MARKER,
  findRolesChannel,
  entryPayload,
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
    state: { getCreatorMeta: () => ({ creatorRoleId: '200000000000000001', creatorFeedChannelId: 'renamed' }) },
    config: { discord: { ownerUserIds: [] } },
    botId: '100000000000000099'
  });
  assert.equal(result.skipped, false);
  assert.equal(result.skippedPublic, 4);
  assert.equal(result.changed, 1);
  assert.deepEqual(edits.map((edit) => edit.name).filter((name, index, list) => list.indexOf(name) === index), ['creator-chat']);
  const hidden = edits.find((edit) => edit.name === 'creator-chat' && edit.target === guild.id);
  assert.equal(hidden.permissions.ViewChannel, false);
  assert.equal(edits.some((edit) => ['creator-feed', 'twitch-live', 'youtube-live', 'old-name'].includes(edit.name)), false);
});
