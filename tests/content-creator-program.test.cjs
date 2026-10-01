'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ChannelType, OverwriteType, PermissionFlagsBits } = require('discord.js');
const { StateStore } = require('../src/sentinel/state-store.cjs');
const {
  CATEGORY_NAME,
  CREATOR_ROLE_NAME,
  NOW_LIVE_ROLE_NAME,
  PROGRAM_MARKER,
  ASSETS_MARKER,
  parsePlatforms,
  providerStatus,
  programPayload,
  assetsPayload,
  reviewPayload,
  isReviewer,
  ensureProgramRoles,
  ensureCreatorFeedChannel,
  ensureCreatorProgram,
  publicReadOnlyOverwrites,
  applicationModal,
  applyDecision,
  creatorCommand,
  handleCreatorCommand
} = require('../src/sentinel/creator-program-extension.cjs');

function application(overrides = {}) {
  return {
    id: 'CCR-0001',
    number: 1,
    userId: '100000000000000111',
    userName: 'Creator',
    platformText: 'Twitch and YouTube',
    platforms: ['twitch', 'youtube'],
    channelRef: 'https://example.com/channel',
    content: 'Games and community streams.',
    reason: 'I want to create with the Nexus community.',
    status: 'pending',
    createdAt: '2026-08-25T00:00:00.000Z',
    reviewedAt: '',
    reviewedBy: '',
    reviewReason: '',
    reviewMessageId: '',
    ...overrides
  };
}

test('creator command exposes private status and approved roster views', () => {
  const command = creatorCommand().toJSON();
  assert.equal(command.name, 'creator');
  assert.deepEqual(command.options.map((option) => option.name), ['status', 'roster', 'post']);
  const post = command.options.find((option) => option.name === 'post');
  assert.equal(post.options.find((option) => option.name === 'url').required, true);
  assert.equal(post.options.some((option) => option.name === 'ping'), true);
});

test('creator status is private while roster publishes approved profiles only', async () => {
  const replies = [];
  const store = {
    getCreatorProfile: () => null,
    findCreatorApplicationByUser: () => application({ status: 'pending' }),
    listCreatorProfiles: () => ({ approved: { userId: '100000000000000222', platforms: ['twitch'], channelRef: 'https://example.com/approved', approvedAt: '2026-08-25T00:00:00Z' } })
  };
  const interaction = (subcommand) => ({
    commandName: 'creator', user: { id: '100000000000000111' },
    isChatInputCommand: () => true, options: { getSubcommand: () => subcommand },
    async reply(payload) { replies.push(payload); }
  });
  await handleCreatorCommand(interaction('status'), store);
  assert.ok(replies[0].flags, 'application status must be ephemeral');
  assert.match(replies[0].content, /CCR-0001/);
  await handleCreatorCommand(interaction('roster'), store);
  assert.match(replies[1].content, /approved/);
  assert.equal(replies[1].flags, undefined);
});

test('creator program uses the approved category, creator role, and temporary live role names', () => {
  assert.equal(CATEGORY_NAME, 'CONTENT CREATOR PROGRAM');
  assert.equal(CREATOR_ROLE_NAME, 'Content Creator');
  assert.equal(NOW_LIVE_ROLE_NAME, 'Now Live');
});

test('platform parsing recognizes Twitch and YouTube without pretending unsupported platforms are live-ready', () => {
  assert.deepEqual(parsePlatforms('Twitch'), ['twitch']);
  assert.deepEqual(parsePlatforms('YouTube'), ['youtube']);
  assert.deepEqual(parsePlatforms('Twitch + YouTube'), ['twitch', 'youtube']);
  assert.deepEqual(parsePlatforms('TikTok'), ['tiktok']);
  assert.deepEqual(parsePlatforms('tik tok'), ['tiktok']);
  assert.deepEqual(parsePlatforms('Twitch + TikTok'), ['twitch', 'tiktok']);
  assert.deepEqual(parsePlatforms('Instagram'), ['other']);
});

test('provider status is credential-gated', () => {
  assert.deepEqual(providerStatus({}), { twitch: false, youtube: false });
  assert.deepEqual(providerStatus({ TWITCH_CLIENT_ID: 'id', TWITCH_CLIENT_SECRET: 'secret', YOUTUBE_API_KEY: 'key' }), { twitch: true, youtube: true });
  assert.deepEqual(providerStatus({ TWITCH_CLIENT_ID: 'id' }), { twitch: false, youtube: false });
});

test('public program panel is application-based and preserves Name Color priority', () => {
  const payload = programPayload({});
  const text = JSON.stringify(payload);
  assert.match(text, /application-based/i);
  assert.match(text, /Twitch, YouTube, and TikTok/);
  assert.doesNotMatch(text, /TikTok may be added later/);
  assert.match(text, /Now Live/);
  assert.match(text, /no name color/i);
  assert.match(text, /Name Color roles keep visual priority/);
  assert.match(text, /provider setup pending/);
  assert.equal(payload.embeds[0].footer.text, PROGRAM_MARKER);
});

test('creator asset surface promises reusable creator-name-safe templates without pretending the pack is already delivered', () => {
  const payload = assetsPayload();
  const text = JSON.stringify(payload);
  assert.match(text, /creator name can be added/i);
  assert.match(text, /approved Khaos Nexus base identity/i);
  assert.match(text, /asset library is ready/i);
  assert.match(text, /image pack itself remains a separate visual-asset delivery item/i);
  assert.equal(payload.embeds[0].footer.text, ASSETS_MARKER);
});

test('creator and live roles are created without colors so self-selected name colors remain authoritative', async () => {
  const created = [];
  const guild = {
    roles: {
      async fetch() { return new Map(); },
      async create(options) {
        created.push(options);
        return { id: String(100 + created.length), name: options.name, managed: false, ...options };
      }
    }
  };
  const result = await ensureProgramRoles(guild);
  assert.equal(result.creatorRoleCreated, true);
  assert.equal(result.nowLiveRoleCreated, true);
  assert.equal(created.length, 2);
  assert.equal(created[0].name, CREATOR_ROLE_NAME);
  assert.equal(created[0].color, 0);
  assert.equal(created[1].name, NOW_LIVE_ROLE_NAME);
  assert.equal(created[1].color, 0);
  assert.equal(created[1].hoist, true);
});

test('creator review card exposes approve/deny controls only while pending', () => {
  const pending = reviewPayload(application());
  assert.match(JSON.stringify(pending), /Approve Creator/);
  assert.match(JSON.stringify(pending), /Deny/);
  const approved = reviewPayload(application({ status: 'approved', reviewReason: 'Approved.' }));
  assert.equal(approved.components.length, 0);
  assert.match(JSON.stringify(approved), /Approved/);
});

test('creator reviewers include Owner, configured staff roles, and Manage Server authority', () => {
  const guild = { ownerId: '100000000000000001' };
  const config = { discord: { ownerUserIds: ['100000000000000002'] } };
  assert.equal(isReviewer({ guild, user: { id: '100000000000000001' }, member: {} }, config, []), true);
  assert.equal(isReviewer({ guild, user: { id: '100000000000000002' }, member: {} }, config, []), true);
  assert.equal(isReviewer({ guild, user: { id: '100000000000000003' }, member: { roles: { cache: new Map([['100000000000000010', {}]]) } } }, config, ['100000000000000010']), true);
  assert.equal(isReviewer({ guild, user: { id: '100000000000000004' }, member: { permissions: { has: () => true } } }, config, []), true);
  assert.equal(isReviewer({ guild, user: { id: '100000000000000005' }, member: { permissions: { has: () => false }, roles: { cache: new Map() } } }, config, []), false);
});

test('creator application IDs and profiles persist across store instances', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-creators-'));
  try {
    const first = new StateStore(root);
    assert.deepEqual(first.allocateCreatorApplicationId(), { id: 'CCR-0001', number: 1 });
    first.setCreatorApplication('CCR-0001', application());
    first.setCreatorProfile('100000000000000111', { userId: '100000000000000111', platforms: ['twitch'] });
    assert.deepEqual(first.allocateCreatorApplicationId(), { id: 'CCR-0002', number: 2 });

    const second = new StateStore(root);
    assert.equal(second.getCreatorApplication('CCR-0001').status, 'pending');
    assert.deepEqual(second.getCreatorProfile('100000000000000111').platforms, ['twitch']);
    assert.equal(second.getCreatorMeta().nextNumber, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('creator approval assigns only the creator role and stores provider-neutral profile state', async () => {
  const app = application();
  const stored = { application: app, profile: null };
  const store = {
    getCreatorApplication() { return stored.application; },
    setCreatorApplication(id, value) { stored.application = value; return value; },
    setCreatorProfile(id, value) { assert.equal(id, app.userId); stored.profile = value; return value; }
  };
  const roleAdds = [];
  const member = { roles: { async add(role, reason) { roleAdds.push({ role, reason }); } } };
  const interaction = {
    user: { id: '100000000000000001' },
    guild: { members: { async fetch(id) { assert.equal(id, app.userId); return member; } } }
  };
  const creatorRole = { id: '200000000000000001', name: CREATOR_ROLE_NAME };
  const result = await applyDecision(interaction, store, creatorRole, app.id, 'approved');
  assert.equal(result.ok, true);
  assert.equal(stored.application.status, 'approved');
  assert.equal(roleAdds.length, 1);
  assert.equal(roleAdds[0].role, creatorRole);
  assert.equal(stored.profile.isLive, false);
  assert.equal(stored.profile.livePlatform, '');
});

test('creator denial records a reason and never assigns the creator role', async () => {
  const app = application();
  const stored = { application: app };
  const store = {
    getCreatorApplication() { return stored.application; },
    setCreatorApplication(id, value) { stored.application = value; return value; },
    setCreatorProfile() { throw new Error('denied application must not create creator profile'); }
  };
  const interaction = { user: { id: '100000000000000001' }, guild: { members: { async fetch() { throw new Error('denial must not fetch member'); } } } };
  const result = await applyDecision(interaction, store, { id: 'role' }, app.id, 'denied', 'Application needs more established community participation.');
  assert.equal(result.ok, true);
  assert.equal(stored.application.status, 'denied');
  assert.match(stored.application.reviewReason, /community participation/);
});

test('creator application form names TikTok and approval stores the handle', async () => {
  const modal = applicationModal().toJSON();
  const labels = modal.components.map((row) => row.components[0].label);
  const placeholders = modal.components.map((row) => row.components[0].placeholder);
  assert.match(labels[0], /TikTok/);
  assert.match(placeholders[1], /tiktok\.com\/@handle/i);

  const app = application({
    platformText: 'TikTok',
    platforms: ['tiktok'],
    channelRef: 'https://www.tiktok.com/@Cool.Creator'
  });
  const stored = { application: app, profile: null };
  const store = {
    getCreatorApplication() { return stored.application; },
    setCreatorApplication(id, value) { stored.application = value; return value; },
    setCreatorProfile(id, value) { stored.profile = value; return value; }
  };
  const interaction = {
    user: { id: '100000000000000001' },
    guild: { members: { async fetch() { return { roles: { async add() {} } }; } } }
  };
  const result = await applyDecision(interaction, store, { id: '200000000000000001' }, app.id, 'approved');
  assert.equal(result.ok, true);
  assert.deepEqual(stored.profile.platforms, ['tiktok']);
  assert.equal(stored.profile.handles.tiktok, 'cool.creator');
  assert.notEqual(stored.profile.platforms[0], 'other');
});

test('creator feed overwrites let everyone view and only Sentinal send', () => {
  const guildId = '100000000000000010';
  const botId = '100000000000000099';
  const overwrites = publicReadOnlyOverwrites({ id: guildId }, botId);
  const everyone = overwrites.find((entry) => entry.id === guildId);
  const bot = overwrites.find((entry) => entry.id === botId);
  assert.equal(everyone.type, OverwriteType.Role);
  assert.ok(everyone.allow.includes(PermissionFlagsBits.ViewChannel));
  assert.ok(everyone.allow.includes(PermissionFlagsBits.ReadMessageHistory));
  assert.ok(everyone.deny.includes(PermissionFlagsBits.SendMessages));
  assert.equal(everyone.allow.includes(PermissionFlagsBits.SendMessages), false);
  assert.equal(bot.type, OverwriteType.Member);
  assert.ok(bot.allow.includes(PermissionFlagsBits.ViewChannel));
  assert.ok(bot.allow.includes(PermissionFlagsBits.SendMessages));
  assert.ok(bot.allow.includes(PermissionFlagsBits.EmbedLinks));
});

test('creator feed is found or created under INFORMATION and legacy live channels are left alone', async () => {
  const events = [];
  const botId = '100000000000000099';
  const guildId = '100000000000000010';
  const channels = [
    { id: 'info', name: 'INFORMATION', type: ChannelType.GuildCategory },
    { id: 'creator-cat', name: 'CONTENT CREATOR PROGRAM', type: ChannelType.GuildCategory },
    { id: 'staff-cat', name: '🔒 STAFF', type: ChannelType.GuildCategory }
  ];
  const textChannel = (id, name, parentId, legacy = false) => {
    const trap = async () => { throw new Error(`legacy channel ${name} must be left alone`); };
    return {
      id,
      name,
      parentId,
      topic: '',
      isTextBased: () => true,
      permissionOverwrites: { set: legacy ? trap : async (overwrites) => { events.push({ type: 'overwrites', name, overwrites }); } },
      setTopic: legacy ? trap : async (topic) => { events.push({ type: 'topic', name, topic }); },
      setParent: legacy ? trap : async () => { events.push({ type: 'parent', name }); },
      messages: { fetch: legacy ? trap : async () => new Map() },
      send: legacy ? trap : async () => ({ id: `msg-${id}`, pinned: false, async pin() {} })
    };
  };
  channels.push(
    textChannel('program', 'creator-program', 'creator-cat'),
    textChannel('assets', 'creator-assets', 'creator-cat'),
    textChannel('chat', 'creator-chat', 'creator-cat'),
    textChannel('review', 'creator-review', 'staff-cat'),
    textChannel('twitch', 'twitch-live', 'creator-cat', true),
    textChannel('youtube', 'youtube-live', 'creator-cat', true)
  );
  const roles = new Map([
    ['200000000000000001', { id: '200000000000000001', name: 'Content Creator', managed: false }],
    ['200000000000000002', { id: '200000000000000002', name: 'Now Live', managed: false }]
  ]);
  const guild = {
    id: guildId,
    ownerId: '100000000000000001',
    roles: {
      async fetch() { return roles; },
      async create() { throw new Error('creator roles already exist'); }
    },
    channels: {
      async fetch() { return channels; },
      async create(options) {
        events.push({ type: 'create', name: options.name, parent: options.parent, overwrites: options.permissionOverwrites });
        const channel = textChannel(`created-${options.name}`, options.name, options.parent);
        channel.topic = options.topic || '';
        channels.push(channel);
        return channel;
      }
    }
  };
  const store = {
    listCreatorApplications() { return {}; },
    setCreatorMeta(value) { this.meta = value; return value; }
  };
  const config = { discord: { ownerUserIds: ['100000000000000001'] } };
  const first = await ensureCreatorProgram(guild, config, store, botId);
  const second = await ensureCreatorProgram(guild, config, store, botId);
  const creates = events.filter((event) => event.type === 'create');
  assert.deepEqual(creates.map((event) => event.name), ['creator-feed']);
  assert.equal(creates[0].parent, 'info');
  assert.deepEqual(creates[0].overwrites, publicReadOnlyOverwrites(guild, botId));
  const feedSets = events.filter((event) => event.type === 'overwrites' && event.name === 'creator-feed');
  assert.ok(feedSets.length >= 2);
  assert.deepEqual(feedSets[0].overwrites, publicReadOnlyOverwrites(guild, botId));
  assert.equal(events.some((event) => event.name === 'twitch-live' || event.name === 'youtube-live'), false);
  assert.equal(first.feedChannelId, 'created-creator-feed');
  assert.equal(second.feedChannelId, 'created-creator-feed');
  assert.equal(store.meta.creatorFeedChannelId, 'created-creator-feed');
});

test('existing creator-feed is moved under INFORMATION instead of duplicated', async () => {
  const existing = {
    id: 'feed-1',
    name: 'creator-feed',
    parentId: 'elsewhere',
    topic: '',
    isTextBased: () => true,
    async setParent(parent) { existing.parentId = parent; },
    async setTopic(topic) { existing.topic = topic; },
    permissionOverwrites: { set: async (overwrites) => { existing.overwrites = overwrites; } }
  };
  const guild = {
    id: '100000000000000010',
    channels: {
      async fetch() {
        return [
          { id: 'info', name: 'INFORMATION', type: ChannelType.GuildCategory },
          existing
        ];
      },
      async create() { throw new Error('existing creator-feed must be reused'); }
    }
  };
  const result = await ensureCreatorFeedChannel(guild, '100000000000000099');
  assert.equal(result.created, false);
  assert.equal(result.moved, true);
  assert.equal(result.channel.id, 'feed-1');
  assert.equal(existing.parentId, 'info');
  assert.deepEqual(existing.overwrites, publicReadOnlyOverwrites(guild, '100000000000000099'));
});

test('creator feed setup is harmless when INFORMATION is missing', async () => {
  const guild = {
    channels: {
      async fetch() { return [{ id: 'cat', name: 'CONTENT CREATOR PROGRAM', type: ChannelType.GuildCategory }]; },
      async create() { throw new Error('must not create creator-feed without INFORMATION'); }
    }
  };
  const result = await ensureCreatorFeedChannel(guild, 'bot');
  assert.equal(result.channel, null);
  assert.equal(result.reason, 'information-category-missing');
});
