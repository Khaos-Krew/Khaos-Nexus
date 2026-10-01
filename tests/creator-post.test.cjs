'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StateStore } = require('../src/sentinel/state-store.cjs');
const { revokeCreatorState } = require('../src/sentinel/creator-lifecycle-extension.cjs');
const {
  CREATOR_POST_WINDOW_MS,
  creatorPostEnabled,
  creatorPostRateLimit,
  handleCreatorPost
} = require('../src/sentinel/creator-post.cjs');

const USER_ID = '100000000000000111';
const ROLE_ID = '200000000000000001';

function creatorCache() {
  return new Map([[ROLE_ID, { id: ROLE_ID, name: 'Content Creator' }]]);
}

function approvedProfile(overrides = {}) {
  return {
    userId: USER_ID,
    platforms: ['tiktok', 'youtube', 'twitch'],
    platformText: 'TikTok, YouTube, and Twitch',
    channelRef: 'https://www.tiktok.com/@realcreator',
    handles: { tiktok: 'realcreator', youtube: '@NexusCreator', twitch: 'realcreator' },
    ...overrides
  };
}

function memoryStore({ profile = approvedProfile(), posts = [] } = {}) {
  const profiles = {};
  if (profile) profiles[profile.userId] = profile;
  const saved = posts.map((entry) => ({ ...entry }));
  return {
    saved,
    getCreatorProfile(id) { return profiles[id] || null; },
    getCreatorMeta() { return { creatorRoleId: ROLE_ID, creatorFeedChannelId: '900000000000000777' }; },
    listCreatorPosts() { return saved.map((entry) => ({ ...entry })); },
    recordCreatorPost(entry) { saved.push({ ...entry }); return entry; }
  };
}

function interactionFor({ url, ping = false, userId = USER_ID, roles = creatorCache() } = {}) {
  const replies = [];
  const interaction = {
    commandName: 'creator',
    user: { id: userId, username: 'creator' },
    member: { roles: { cache: roles } },
    guild: { id: '100000000000000010' },
    deferred: false,
    replied: false,
    isChatInputCommand() { return true; },
    options: {
      getSubcommand: () => 'post',
      getString: (name) => (name === 'url' ? url : null),
      getBoolean: (name) => (name === 'ping' ? ping : false)
    },
    async deferReply(payload) { replies.push({ type: 'defer', payload }); this.deferred = true; },
    async reply(payload) { replies.push({ type: 'reply', payload }); this.replied = true; },
    async editReply(payload) { replies.push({ type: 'edit', payload }); }
  };
  return { interaction, replies };
}

function visibleReply(replies) {
  return [...replies].reverse().find((entry) => entry.type === 'reply' || entry.type === 'edit')?.payload?.content || '';
}

test('creator posting defaults on and can be disabled without posting', async () => {
  assert.equal(creatorPostEnabled({}), true);
  assert.equal(creatorPostEnabled({ CREATOR_POST_ENABLED: 'false' }), false);
  const { interaction, replies } = interactionFor({ url: 'https://www.tiktok.com/@realcreator/video/123' });
  const result = await handleCreatorPost(interaction, memoryStore(), {
    env: { CREATOR_POST_ENABLED: 'off' },
    fetchImpl: async () => { throw new Error('disabled posting must not fetch'); },
    resolveFeedChannel: async () => { throw new Error('disabled posting must not resolve a channel'); }
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'disabled');
  assert.match(visibleReply(replies), /turned off/i);
});

test('TikTok oEmbed author mismatch is rejected before anything is posted', async () => {
  const fetches = [];
  const sends = [];
  const store = memoryStore();
  const { interaction, replies } = interactionFor({ url: 'https://www.tiktok.com/@realcreator/video/1234567890123456789' });
  const result = await handleCreatorPost(interaction, store, {
    env: { CREATOR_POST_ENABLED: 'true' },
    fetchImpl: async (endpoint) => {
      fetches.push(endpoint);
      return { ok: true, async json() { return { author_unique_id: 'someoneelse', author_name: 'Else', title: 'Not mine' }; } };
    },
    resolveFeedChannel: async () => ({ id: 'feed', send: async (payload) => { sends.push(payload); return { id: 'msg' }; } })
  });
  assert.equal(result.reason, 'author-mismatch');
  assert.equal(sends.length, 0);
  assert.equal(store.saved.length, 0);
  assert.match(visibleReply(replies), /does not match your saved TikTok handle/);
  const endpoint = new URL(fetches[0]);
  assert.equal(`${endpoint.origin}${endpoint.pathname}`, 'https://www.tiktok.com/oembed');
  assert.match(endpoint.searchParams.get('url'), /^https:\/\/www\.tiktok\.com\/@realcreator\/video\/1234567890123456789$/);
});

test('YouTube oEmbed author mismatch is rejected', async () => {
  const fetches = [];
  const store = memoryStore();
  const { interaction, replies } = interactionFor({ url: 'https://www.youtube.com/watch?v=abcdefghijk' });
  const result = await handleCreatorPost(interaction, store, {
    env: {},
    fetchImpl: async (endpoint) => {
      fetches.push(endpoint);
      return {
        ok: true,
        async json() {
          return { author_name: 'Someone Else', author_url: 'https://www.youtube.com/@SomeoneElse', title: 'Other channel' };
        }
      };
    },
    resolveFeedChannel: async () => { throw new Error('mismatch must not resolve the feed'); }
  });
  assert.equal(result.reason, 'author-mismatch');
  assert.equal(store.saved.length, 0);
  assert.match(visibleReply(replies), /does not match your saved YouTube channel/);
  const endpoint = new URL(fetches[0]);
  assert.equal(`${endpoint.origin}${endpoint.pathname}`, 'https://www.youtube.com/oembed');
  assert.equal(endpoint.searchParams.get('url'), 'https://www.youtube.com/watch?v=abcdefghijk');
});

test('creator posts are limited to 3 per creator per 24 hours', async () => {
  const now = Date.parse('2026-10-01T18:00:00.000Z');
  const posts = [1, 2, 3].map((index) => ({
    userId: USER_ID,
    normalizedUrl: `https://tiktok.com/@realcreator/video/${index}`,
    createdAt: new Date(now - index * 60_000).toISOString(),
    platform: 'tiktok'
  }));
  posts.push({
    userId: '100000000000000222',
    normalizedUrl: 'https://tiktok.com/@other/video/9',
    createdAt: new Date(now - 1000).toISOString(),
    platform: 'tiktok'
  });
  const boundary = creatorPostRateLimit([
    { userId: USER_ID, createdAt: new Date(now - 60_000).toISOString() },
    { userId: USER_ID, createdAt: new Date(now - 120_000).toISOString() },
    { userId: USER_ID, createdAt: new Date(now - CREATOR_POST_WINDOW_MS).toISOString() }
  ], USER_ID, now);
  assert.equal(boundary.limited, false);
  assert.equal(boundary.count, 2);

  const store = memoryStore({ posts });
  const { interaction, replies } = interactionFor({ url: 'https://www.tiktok.com/@realcreator/video/999' });
  const result = await handleCreatorPost(interaction, store, {
    env: {},
    now,
    fetchImpl: async () => { throw new Error('rate limit must not fetch'); },
    resolveFeedChannel: async () => { throw new Error('rate limit must not resolve the feed'); }
  });
  assert.equal(result.reason, 'rate-limited');
  assert.equal(store.saved.length, 4);
  assert.match(visibleReply(replies), /3 creator posts every 24 hours/);
});

test('duplicate creator URLs are rejected', async () => {
  const store = memoryStore({
    posts: [{
      userId: '100000000000000222',
      normalizedUrl: 'https://tiktok.com/@realcreator/video/123',
      createdAt: '2026-10-01T12:00:00.000Z',
      platform: 'tiktok'
    }]
  });
  const { interaction, replies } = interactionFor({ url: 'https://www.tiktok.com/@RealCreator/video/123?utm_source=copy' });
  const result = await handleCreatorPost(interaction, store, {
    env: {},
    fetchImpl: async () => { throw new Error('duplicate must not fetch'); }
  });
  assert.equal(result.reason, 'duplicate');
  assert.match(visibleReply(replies), /already in the creator feed/);
});

test('revoked creators are blocked even if the role is still present', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-creator-post-'));
  try {
    const store = new StateStore(root);
    store.setCreatorProfile(USER_ID, approvedProfile());
    store.setCreatorMeta({ creatorRoleId: ROLE_ID });
    const revoked = revokeCreatorState(store, USER_ID, '100000000000000001', 'Left the program');
    assert.equal(revoked.ok, true);
    assert.equal(store.getCreatorProfile(USER_ID), null);
    const { interaction, replies } = interactionFor({ url: 'https://www.tiktok.com/@realcreator/video/123' });
    const result = await handleCreatorPost(interaction, store, {
      env: {},
      fetchImpl: async () => { throw new Error('revoked creator must not fetch'); }
    });
    assert.equal(result.reason, 'not-approved');
    assert.match(visibleReply(replies), /Only approved creators/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an approved TikTok post pings Stream Alerts only through allowed mentions', async () => {
  const sends = [];
  const roleId = '300000000000000010';
  const store = memoryStore();
  const { interaction, replies } = interactionFor({
    url: 'https://www.tiktok.com/@realcreator/video/555',
    ping: true
  });
  const result = await handleCreatorPost(interaction, store, {
    env: { CREATOR_POST_ENABLED: 'true' },
    fetchImpl: async () => ({ ok: true, async json() { return { author_unique_id: 'RealCreator', title: 'Clip title' }; } }),
    resolveFeedChannel: async () => ({ id: 'feed', send: async (payload) => { sends.push(payload); return { id: 'message-1' }; } }),
    resolveStreamAlertsRole: async () => ({ id: roleId, name: 'Stream Alerts' })
  });
  assert.equal(result.ok, true);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].content, `<@&${roleId}>`);
  assert.deepEqual(sends[0].allowedMentions, { parse: [], roles: [roleId] });
  assert.equal(sends[0].embeds[0].fields.find((field) => field.name === 'Creator').value, `<@${USER_ID}>`);
  assert.equal(sends[0].embeds[0].fields.find((field) => field.name === 'Platform').value, 'TikTok');
  assert.match(sends[0].embeds[0].fields.find((field) => field.name === 'Link').value, /tiktok\.com\/@realcreator\/video\/555/);
  assert.equal(store.saved.length, 1);
  assert.equal(store.saved[0].normalizedUrl, 'https://tiktok.com/@realcreator/video/555');
  assert.match(visibleReply(replies), /pinged Stream Alerts/);
});

test('Twitch posts match the saved login and do not call an API', async () => {
  const sends = [];
  const store = memoryStore();
  const mismatch = interactionFor({ url: 'https://www.twitch.tv/someoneelse' });
  const denied = await handleCreatorPost(mismatch.interaction, store, {
    env: {},
    fetchImpl: async () => { throw new Error('Twitch verification must not fetch'); },
    resolveFeedChannel: async () => { throw new Error('Twitch mismatch must not resolve the feed'); }
  });
  assert.equal(denied.reason, 'author-mismatch');
  assert.match(visibleReply(mismatch.replies), /does not match your saved Twitch handle/);

  const accepted = interactionFor({ url: 'https://www.twitch.tv/RealCreator/clip/ClipSlug' });
  const posted = await handleCreatorPost(accepted.interaction, store, {
    env: {},
    fetchImpl: async () => { throw new Error('Twitch verification must not fetch'); },
    resolveFeedChannel: async () => ({ id: 'feed', send: async (payload) => { sends.push(payload); return { id: 'message-2' }; } })
  });
  assert.equal(posted.ok, true);
  assert.equal(sends[0].content, undefined);
  assert.deepEqual(sends[0].allowedMentions, { parse: [] });
  assert.equal(sends[0].embeds[0].fields.find((field) => field.name === 'Platform').value, 'Twitch');
  assert.match(sends[0].embeds[0].fields.find((field) => field.name === 'Link').value, /twitch\.tv\/RealCreator\/clip\/ClipSlug/);
});

test('creator posting is harmless when the feed channel is missing and ignores non-allowlisted URLs', async () => {
  const store = memoryStore();
  const missing = interactionFor({ url: 'https://www.tiktok.com/@realcreator/video/777' });
  const missingResult = await handleCreatorPost(missing.interaction, store, {
    env: {},
    fetchImpl: async () => ({ ok: true, async json() { return { author_unique_id: 'realcreator', title: 'Clip' }; } }),
    resolveFeedChannel: async () => null
  });
  assert.equal(missingResult.reason, 'feed-missing');
  assert.equal(store.saved.length, 0);
  assert.match(visibleReply(missing.replies), /not available/);

  const evil = interactionFor({ url: 'https://evil.example/oembed?url=https://www.tiktok.com/@realcreator/video/1' });
  const evilResult = await handleCreatorPost(evil.interaction, store, {
    env: {},
    fetchImpl: async () => { throw new Error('non-allowlisted URL must not be fetched'); }
  });
  assert.equal(evilResult.reason, 'unsupported-url');
  assert.match(visibleReply(evil.replies), /TikTok, YouTube, or Twitch/);
});
