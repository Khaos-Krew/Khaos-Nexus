'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const {
  selectableCampaignIds,
  validateCampaignUse,
  hasSafeDmPermissions,
  preflightBlindRoll
} = require('../bot/dnd-runtime-policy.cjs');

const bindings = [
  { campaignId: 'exact-a', appId: 'app', guildId: 'guild', resourceType: 'thread', resourceId: 'thread', active: true },
  { campaignId: 'exact-b', appId: 'app', guildId: 'guild', resourceType: 'thread', resourceId: 'thread', active: true },
  { campaignId: 'parent-only', appId: 'app', guildId: 'guild', resourceType: 'channel', resourceId: 'parent', active: true }
];

test('shared-channel selection is limited to exact bindings when exact bindings exist', () => {
  const ids = selectableCampaignIds({ bindings, appId: 'app', guildId: 'guild', channelId: 'thread', parentChannelId: 'parent' });
  assert.deepEqual([...ids].sort(), ['exact-a', 'exact-b']);
  assert.equal(ids.has('parent-only'), false);
});

test('parent bindings are selectable only when the child has no exact binding', () => {
  const ids = selectableCampaignIds({ bindings, appId: 'app', guildId: 'guild', channelId: 'unbound-child', parentChannelId: 'parent' });
  assert.deepEqual([...ids], ['parent-only']);
});

test('/campaign use rejects a campaign that is not bound to the current resource', () => {
  const interaction = {
    commandName: 'campaign',
    guildId: 'guild',
    channelId: 'thread',
    channel: { parentId: 'parent' },
    isChatInputCommand: () => true,
    options: {
      getSubcommand: () => 'use',
      getString: () => 'parent-only'
    }
  };
  const runtime = {
    getBootstrap: () => ({ config: { discordApp: { id: 'app' }, dnd: { bindings } } })
  };
  assert.throws(() => validateCampaignUse(interaction, runtime), (error) => error.code === 'CAMPAIGN_NOT_BOUND_TO_RESOURCE');
});

test('/campaign use accepts a campaign explicitly bound to the current resource', () => {
  const interaction = {
    commandName: 'campaign',
    guildId: 'guild',
    channelId: 'thread',
    channel: { parentId: 'parent' },
    isChatInputCommand: () => true,
    options: {
      getSubcommand: () => 'use',
      getString: () => 'exact-b'
    }
  };
  const runtime = {
    getBootstrap: () => ({ config: { discordApp: { id: 'app' }, dnd: { bindings } } })
  };
  assert.doesNotThrow(() => validateCampaignUse(interaction, runtime));
});

test('safe DM permission preflight requires view and the correct send permission', () => {
  const clientUser = { id: 'bot' };
  const channel = {
    isTextBased: () => true,
    isThread: () => false,
    permissionsFor: () => ({
      has: (permission) => permission === PermissionFlagsBits.ViewChannel || permission === PermissionFlagsBits.SendMessages
    })
  };
  assert.equal(hasSafeDmPermissions(channel, clientUser), true);
  const unsafe = { ...channel, permissionsFor: () => ({ has: (permission) => permission === PermissionFlagsBits.ViewChannel }) };
  assert.equal(hasSafeDmPermissions(unsafe, clientUser), false);
});

test('blind roll permission preflight rejects before the roll runtime when DM delivery is unsafe', async () => {
  const guildId = '100000000000000001';
  const channelId = '100000000000000002';
  const dmChannelId = '100000000000000003';
  const state = {
    campaigns: [{ id: 'campaign' }],
    contexts: [],
    bindings: [
      { campaignId: 'campaign', appId: 'app', guildId, resourceType: 'channel', resourceId: channelId, purpose: 'main', active: true },
      { campaignId: 'campaign', appId: 'app', guildId, resourceType: 'channel', resourceId: dmChannelId, purpose: 'dm_private', active: true }
    ]
  };
  const interaction = {
    commandName: 'roll',
    guildId,
    channelId,
    channel: {},
    isChatInputCommand: () => true,
    options: { getString: (name) => name === 'privacy' ? 'blind' : 'd20' }
  };
  const runtime = {
    getBootstrap: () => ({ config: { discordApp: { id: 'app' }, dnd: state } }),
    client: {
      user: { id: 'bot' },
      channels: {
        fetch: async () => ({
          isTextBased: () => true,
          isThread: () => false,
          permissionsFor: () => ({ has: (permission) => permission === PermissionFlagsBits.ViewChannel })
        })
      }
    }
  };
  await assert.rejects(() => preflightBlindRoll(interaction, runtime), (error) => error.code === 'UNSAFE_DM_ROLL_DESTINATION');
});
