'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ChannelType } = require('discord.js');
const {
  COMMAND_CHANNEL_NAME,
  COMMAND_PANEL_MARKER,
  SUGGESTION_BUTTON_ID,
  findCommandChannel,
  commandPanelPayload,
  reconcileCommandPanel,
  ensureCommandChannel,
  parseCommandButtonId,
  publicHelpPayload
} = require('../src/sentinel/nexus-command-center.cjs');
const { handleCommandCenterButton } = require('../src/sentinel/nexus-command-center-extension.cjs');

const GUILD_ID = '123456789012345678';
const HQ_ID = '223456789012345678';
const USER_ID = '323456789012345678';
const BOT_ID = '423456789012345678';

function hqChannel() {
  return { id: HQ_ID, name: '🌐 NEXUS HQ', type: ChannelType.GuildCategory };
}

function rowJson(row) {
  return typeof row?.toJSON === 'function' ? row.toJSON() : row;
}

test('public command panel exposes only safe non-game member controls', () => {
  const payload = commandPanelPayload();
  assert.equal(payload.embeds[0].footer.text, COMMAND_PANEL_MARKER);
  const rows = payload.components.map(rowJson);
  const ids = rows.flatMap((row) => row.components || []).map((button) => button.custom_id);
  assert.deepEqual(ids, [
    'nxcmd:level',
    'nxcmd:achievements',
    'nxcmd:leaderboard',
    'nxcmd:roles',
    'nxcmd:help',
    SUGGESTION_BUTTON_ID,
    'nxcmd:events',
    'nxcmd:polls'
  ]);
  const serialized = JSON.stringify(payload).toLowerCase();
  for (const forbidden of ['/xp', '/shield', '/nexus run', '/divisionloot', '/market item:', 'admin commands']) {
    assert.equal(serialized.includes(forbidden), false, `public command center leaked ${forbidden}`);
  }
  assert.match(payload.embeds[0].description, /game-specific commands stay in their game hubs/i);
});

test('command button parser accepts only the bounded public action set', () => {
  assert.equal(parseCommandButtonId('nxcmd:level'), 'level');
  assert.equal(parseCommandButtonId('nxcmd:achievements'), 'achievements');
  assert.equal(parseCommandButtonId('nxcmd:xp'), null);
  assert.equal(parseCommandButtonId('nexus:module-access:division2'), null);
  assert.equal(parseCommandButtonId(SUGGESTION_BUTTON_ID), null);
});

test('command-channel adoption preserves strong legacy equivalents but never steals a generic commands channel from another category', () => {
  const externalGeneric = { id: '523456789012345678', name: 'commands', type: ChannelType.GuildText, parentId: '623456789012345678' };
  const strongLegacy = { id: '723456789012345678', name: 'command-center', type: ChannelType.GuildText, parentId: '623456789012345678' };
  const withGenericOnly = new Map([[HQ_ID, hqChannel()], [externalGeneric.id, externalGeneric]]);
  assert.equal(findCommandChannel(withGenericOnly, HQ_ID), null);
  const withStrong = new Map([...withGenericOnly, [strongLegacy.id, strongLegacy]]);
  assert.equal(findCommandChannel(withStrong, HQ_ID), strongLegacy);
});

test('managed command channel is moved into NEXUS HQ, renamed, and permission-synced without deleting history', async () => {
  const legacy = {
    id: '723456789012345678',
    name: 'command-center',
    type: ChannelType.GuildText,
    parentId: '623456789012345678',
    topic: 'old topic',
    permissionsLocked: false,
    async setParent(id) { this.parentId = String(id); },
    async setName(name) { this.name = name; },
    async setTopic(topic) { this.topic = topic; },
    async lockPermissions() { this.permissionsLocked = true; }
  };
  const channels = new Map([[HQ_ID, hqChannel()], [legacy.id, legacy]]);
  let creates = 0;
  const guild = {
    channels: {
      cache: channels,
      async fetch() { return channels; },
      async create() { creates += 1; throw new Error('should not create'); }
    }
  };
  const result = await ensureCommandChannel(guild, { channels });
  assert.equal(result.channel, legacy);
  assert.equal(result.moved, true);
  assert.equal(result.renamed, true);
  assert.equal(result.topicUpdated, true);
  assert.equal(result.permissionsLocked, true);
  assert.equal(legacy.parentId, HQ_ID);
  assert.equal(legacy.name, COMMAND_CHANNEL_NAME);
  assert.equal(legacy.permissionsLocked, true);
  assert.equal(creates, 0);
});

test('managed command panel is idempotent and removes duplicate managed copies', async () => {
  const payload = commandPanelPayload();
  let edits = 0;
  let sends = 0;
  let deletes = 0;
  const primary = {
    id: '823456789012345678',
    author: { id: BOT_ID },
    content: '',
    embeds: payload.embeds,
    components: payload.components,
    createdTimestamp: 20,
    pinned: true,
    async edit() { edits += 1; }
  };
  const duplicate = {
    id: '923456789012345678',
    author: { id: BOT_ID },
    content: '',
    embeds: payload.embeds,
    components: payload.components,
    createdTimestamp: 10,
    pinned: false,
    async delete() { deletes += 1; }
  };
  const channel = {
    client: { user: { id: BOT_ID } },
    messages: { async fetch() { return new Map([[primary.id, primary], [duplicate.id, duplicate]]); } },
    async send() { sends += 1; return primary; }
  };
  const result = await reconcileCommandPanel(channel, { botId: BOT_ID });
  assert.equal(result.created, false);
  assert.equal(result.updated, false);
  assert.equal(result.duplicatesRemoved, 1);
  assert.equal(edits, 0);
  assert.equal(sends, 0);
  assert.equal(deletes, 1);
});

test('level command-center button reuses the existing progression card backend and stays private', async () => {
  let deferred = null;
  let edited = null;
  const guild = { channels: { cache: new Map([[HQ_ID, hqChannel()]]) }, members: { cache: new Map() } };
  const interaction = {
    customId: 'nxcmd:level',
    guildId: GUILD_ID,
    guild,
    user: { id: USER_ID, username: 'Tester' },
    isButton: () => true,
    async deferReply(options) { deferred = options; },
    async editReply(payload) { edited = payload; }
  };
  const backend = {
    async communityLevel() {
      return { ok: true, profile: { userId: USER_ID, level: 4, rank: 2, xp: 1000, progressPercent: 50, progressXp: 350, progressNeeded: 700, sourceTotals: { message: 800, voice: 200, event: 0, module: 0 } } };
    },
    async communityAchievements() {
      return { ok: true, userId: USER_ID, achievementCount: 2, achievementTotal: 20, achievementPoints: 25, recentAchievements: [] };
    }
  };
  const handled = await handleCommandCenterButton(interaction, {
    client: { guilds: { fetch: async () => guild }, users: { cache: new Map() } },
    config: { discord: { guildId: GUILD_ID } },
    backend
  });
  assert.equal(handled, true);
  assert.ok(deferred);
  assert.ok(edited?.embeds?.[0]);
  assert.match(edited.embeds[0].title, /PROGRESS CARD/);
});

test('public help stays member-safe and command center is installed in the Sentinel entry', () => {
  const guild = { channels: { cache: new Map([[HQ_ID, hqChannel()]]) } };
  const help = publicHelpPayload(guild, HQ_ID);
  const text = JSON.stringify(help).toLowerCase();
  assert.match(help.embeds[0].title, /PUBLIC COMMANDS/);
  assert.equal(text.includes('/xp'), false);
  assert.equal(text.includes('/nexus run'), false);
  const entry = fs.readFileSync(path.join(__dirname, '..', 'src', 'sentinel', 'entry.cjs'), 'utf8');
  assert.match(entry, /installNexusCommandCenterExtension/);
  assert.match(entry, /require\('\.\/nexus-command-center-extension\.cjs'\)/);
});
