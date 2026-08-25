'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
  applyDecision
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

test('creator program uses the approved category, creator role, and temporary live role names', () => {
  assert.equal(CATEGORY_NAME, 'CONTENT CREATOR PROGRAM');
  assert.equal(CREATOR_ROLE_NAME, 'Content Creator');
  assert.equal(NOW_LIVE_ROLE_NAME, 'Now Live');
});

test('platform parsing recognizes Twitch and YouTube without pretending unsupported platforms are live-ready', () => {
  assert.deepEqual(parsePlatforms('Twitch'), ['twitch']);
  assert.deepEqual(parsePlatforms('YouTube'), ['youtube']);
  assert.deepEqual(parsePlatforms('Twitch + YouTube'), ['twitch', 'youtube']);
  assert.deepEqual(parsePlatforms('TikTok'), ['other']);
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
  assert.match(text, /Twitch and YouTube/);
  assert.match(text, /TikTok may be added later/);
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
  assert.equal(created[0].color, null);
  assert.equal(created[1].name, NOW_LIVE_ROLE_NAME);
  assert.equal(created[1].color, null);
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
