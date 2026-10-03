'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ButtonStyle } = require('discord.js');
const { GuildStateStore } = require('../../src/game-bots/vanguard/state-store.cjs');
const { createLfgService } = require('../../src/game-bots/vanguard/lfg/lfg-service.cjs');
const { ACTIVITIES } = require('../../src/game-bots/vanguard/lfg/activities-static.cjs');
const { renderPost, voiceOffer } = require('../../src/game-bots/vanguard/lfg/lfg-buttons.cjs');
const { postFooter } = require('../../src/game-bots/vanguard/panels.cjs');
const { lfgLimits } = require('../../src/game-bots/vanguard/config.cjs');

const GUILD = '1516640233389822001';
const OTHER = '1516640233389822002';
const HOST = '1516640233389822101';
const MEMBER = '1516640233389822102';
const LOBBY = '1516640233389822777';

function clock(start = 1_700_000_000_000) {
  let time = start;
  return {
    now: () => time,
    advance(ms) { time += ms; }
  };
}

function openService(env = {}, timer = clock()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanguard-lfg-'));
  const store = new GuildStateStore(path.join(dir, 'lfg.json'));
  const service = createLfgService({ store, env, now: timer.now });
  return { dir, store, service, timer };
}

async function post(service, overrides = {}) {
  return service.create({
    guildId: GUILD,
    hostId: HOST,
    activityKey: 'raid',
    slots: 2,
    ...overrides
  });
}

test('static activities cover the slice A list and lfg limits clamp', () => {
  assert.deepEqual(ACTIVITIES.map((item) => item.key), [
    'raid', 'dungeon', 'nightfall', 'trials', 'iron-banner', 'crucible', 'gambit', 'onslaught', 'pantheon', 'other'
  ]);
  assert.equal(lfgLimits({}).ttlMin, 120);
  assert.equal(lfgLimits({}).maxOpen, 2);
  assert.equal(lfgLimits({ VANGUARD_LFG_DEFAULT_TTL_MIN: '10', VANGUARD_LFG_MAX_OPEN_PER_USER: '0' }).ttlMin, 15);
  assert.equal(lfgLimits({ VANGUARD_LFG_DEFAULT_TTL_MIN: '10', VANGUARD_LFG_MAX_OPEN_PER_USER: '0' }).maxOpen, 1);
  assert.equal(lfgLimits({ VANGUARD_LFG_DEFAULT_TTL_MIN: '900', VANGUARD_LFG_MAX_OPEN_PER_USER: '40' }).ttlMin, 720);
  assert.equal(lfgLimits({ VANGUARD_LFG_DEFAULT_TTL_MIN: '900', VANGUARD_LFG_MAX_OPEN_PER_USER: '40' }).maxOpen, 10);
});

test('lfg create, join, leave, close, cap, expiry, and guild isolation', async () => {
  const { dir, service, timer, store } = openService({ VANGUARD_LFG_DEFAULT_TTL_MIN: '15', VANGUARD_LFG_MAX_OPEN_PER_USER: '2' });
  try {
    const bad = await service.create({ guildId: GUILD, hostId: HOST, activityKey: 'gambit-prime' });
    assert.equal(bad.reason, 'activity');
    const slots = await post(service, { slots: 1 });
    assert.equal(slots.reason, 'slots');

    const created = await post(service, {
      slots: 2,
      when: '8pm CT',
      note: `@everyone bring mods ${'x'.repeat(250)}`
    });
    assert.equal(created.ok, true);
    assert.equal(created.post.slots, 2);
    assert.equal(created.post.members[0], HOST);
    assert.equal(created.post.guildId, GUILD);
    assert.equal(Date.parse(created.post.expiresAt) - timer.now(), 15 * 60_000);
    assert.doesNotMatch(created.post.note, /@everyone/);
    assert.ok(created.post.note.length <= 200);

    timer.advance(11_000);
    const duplicate = await service.join({ guildId: GUILD, postId: created.post.id, userId: HOST, lobbyId: LOBBY });
    assert.equal(duplicate.reason, 'joined');

    timer.advance(6_000);
    const joined = await service.join({ guildId: GUILD, postId: created.post.id, userId: MEMBER, lobbyId: LOBBY });
    assert.equal(joined.ok, true);
    assert.equal(joined.justFilled, true);
    assert.equal(joined.post.voiceOffered, true);
    assert.equal(joined.post.voiceId, LOBBY);
    assert.deepEqual(joined.post.members, [HOST, MEMBER]);

    timer.advance(6_000);
    const overflow = await service.join({ guildId: GUILD, postId: created.post.id, userId: '1516640233389822199', lobbyId: LOBBY });
    assert.equal(overflow.reason, 'full');

    timer.advance(6_000);
    const hostLeave = await service.leave({ guildId: GUILD, postId: created.post.id, userId: HOST });
    assert.equal(hostLeave.reason, 'host');
    const stranger = await service.leave({ guildId: GUILD, postId: created.post.id, userId: '1516640233389822188' });
    assert.equal(stranger.reason, 'not-member');
    const left = await service.leave({ guildId: GUILD, postId: created.post.id, userId: MEMBER });
    assert.equal(left.ok, true);
    assert.equal(left.post.voiceOffered, false);
    assert.deepEqual(left.post.members, [HOST]);

    timer.advance(6_000);
    const denied = await service.close({ guildId: GUILD, postId: created.post.id, userId: MEMBER, staff: false });
    assert.equal(denied.reason, 'forbidden');
    assert.equal(service.get(GUILD, created.post.id).status, 'open');

    timer.advance(11_000);
    const second = await post(service, { activityKey: 'dungeon', slots: 3 });
    assert.equal(second.ok, true);
    assert.equal(second.post.slots, 3);
    timer.advance(11_000);
    const capped = await post(service, { activityKey: 'nightfall' });
    assert.equal(capped.reason, 'cap');

    timer.advance(6_000);
    const staffClosed = await service.close({ guildId: GUILD, postId: second.post.id, userId: MEMBER, staff: true });
    assert.equal(staffClosed.ok, true);
    assert.equal(staffClosed.post.status, 'closed');

    const other = await service.create({ guildId: OTHER, hostId: HOST, activityKey: 'trials', slots: 3 });
    assert.equal(other.reason, 'rate');
    timer.advance(11_000);
    const otherOk = await service.create({ guildId: OTHER, hostId: HOST, activityKey: 'trials', slots: 3 });
    assert.equal(otherOk.ok, true);
    assert.equal(service.listOpen(GUILD).some((item) => item.id === otherOk.post.id), false);
    assert.equal(service.listOpen(OTHER).length, 1);

    const open = service.listOpen(GUILD);
    assert.equal(open.length, 1);
    timer.advance(15 * 60_000);
    const expired = await service.expireDue(timer.now());
    assert.equal(expired.length, 2);
    assert.ok(expired.every((item) => item.status === 'expired'));
    assert.equal(service.listOpen(GUILD).length, 0);
    assert.equal(service.listOpen(OTHER).length, 0);

    const again = createLfgService({ store, env: {}, now: timer.now });
    assert.equal(again.get(GUILD, created.post.id).status, 'expired');
    assert.equal(fs.readdirSync(dir).some((name) => name.endsWith('.tmp')), false);
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'lfg.json'), 'utf8'));
    assert.ok(raw[GUILD][created.post.id]);
    assert.equal(raw[OTHER][created.post.id], undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('parallel creates for two guardians both persist', async () => {
  const { dir, service } = openService();
  try {
    const [first, second] = await Promise.all([
      service.create({ guildId: GUILD, hostId: HOST, activityKey: 'gambit', slots: 4 }),
      service.create({ guildId: GUILD, hostId: MEMBER, activityKey: 'crucible', slots: 6 })
    ]);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(service.listOpen(GUILD).length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a full fireteam render offers voice and an expired post drops its buttons', () => {
  const post = {
    id: 'abcdef123456',
    hostId: HOST,
    activityKey: 'raid',
    slots: 2,
    members: [HOST, MEMBER],
    when: 'now',
    note: '',
    status: 'open',
    voiceOffered: true,
    voiceId: LOBBY,
    expiresAt: '2026-10-01T18:00:00.000Z'
  };
  const rendered = renderPost(post, { lobbyId: LOBBY, ping: true });
  assert.match(rendered.content, /Fireteam is full/);
  assert.match(rendered.content, new RegExp(`<#${LOBBY}>`));
  assert.deepEqual(rendered.allowedMentions.users, [HOST, MEMBER]);
  assert.equal(rendered.embeds[0].footer.text, postFooter());
  assert.doesNotMatch(rendered.embeds[0].footer.text, /lfg-board/);
  const row = rendered.components[0].toJSON();
  assert.equal(row.components[0].disabled, true);
  assert.equal(row.components[0].style, ButtonStyle.Success);
  assert.equal(voiceOffer('').includes('not configured'), true);

  const expired = renderPost({ ...post, status: 'expired', voiceOffered: false }, {});
  assert.equal(expired.embeds[0].title, '⏰ Fireteam expired');
  assert.equal(expired.components.length, 0);
  const closed = renderPost({ ...post, status: 'closed' }, {});
  assert.equal(closed.embeds[0].title, '🔒 Fireteam closed');
  assert.equal(rendered.embeds[0].color, 0xAEB4BD);
  assert.equal(rendered.embeds[0].thumbnail.url, 'attachment://icon-vanguard.png');
  assert.equal(rendered.embeds[0].image, undefined);
  assert.equal(rendered.files[0].name, 'icon-vanguard.png');
  assert.deepEqual(rendered.embeds[0].fields.slice(0, 3).map((field) => field.name), ['Activity', 'Time', 'Slots']);
  assert.ok(rendered.embeds[0].fields.slice(0, 3).every((field) => field.inline === true));
  assert.equal(rendered.embeds[0].fields[3].name, 'Roster');
  assert.equal(rendered.embeds[0].fields[3].inline, false);
  assert.doesNotMatch(rendered.embeds[0].footer.text, /[-–—]/);
});
