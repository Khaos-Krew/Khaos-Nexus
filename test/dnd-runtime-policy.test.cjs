'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { selectableCampaignIds, validateCampaignUse } = require('../bot/dnd-runtime-policy.cjs');

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
