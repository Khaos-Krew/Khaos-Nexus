'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CHANNEL_NAME,
  REVIEWABLE_STATUSES,
  ownerIds,
  isAuthorizedOwner,
  reviewPayload,
  reviewChannelOverwrites,
  applyOwnerDecision
} = require('../src/sentinel/suggestion-review-extension.cjs');

function suggestion(overrides = {}) {
  return {
    id: 'SUG-0042',
    title: 'Add useful Nexus feature',
    category: 'Discord',
    details: 'A community-passed idea that needs Owner review.',
    submitterId: '111111111111111111',
    createdAt: '2026-08-25T00:00:00.000Z',
    closesAt: '2026-08-28T00:00:00.000Z',
    status: 'github-review',
    votes: { a: 'up', b: 'up', c: 'up', d: 'down', e: 'down' },
    channelId: '222222222222222222',
    messageId: '333333333333333333',
    githubIssueUrl: 'https://github.com/Khaos-Krew/Khaos-Nexus/issues/999',
    githubIssueNumber: 999,
    reviewReason: '',
    ...overrides
  };
}

test('protected suggestion review recognizes guild Owner plus configured Nexus Owners', () => {
  const guild = { ownerId: '100000000000000001' };
  const config = { discord: { ownerUserIds: ['100000000000000002', 'bad', '100000000000000001'] } };
  assert.deepEqual(ownerIds(guild, config), ['100000000000000001', '100000000000000002']);
  assert.equal(isAuthorizedOwner({ guild, user: { id: '100000000000000001' } }, config), true);
  assert.equal(isAuthorizedOwner({ guild, user: { id: '100000000000000002' } }, config), true);
  assert.equal(isAuthorizedOwner({ guild, user: { id: '100000000000000003' } }, config), false);
});

test('review channel is owner-only and keeps Sentinal management access', () => {
  const guild = { id: '100000000000000010' };
  const overwrites = reviewChannelOverwrites(guild, '100000000000000099', ['100000000000000001']);
  assert.equal(CHANNEL_NAME, 'suggestion-review');
  assert.equal(overwrites[0].id, guild.id);
  assert.ok(overwrites[0].deny.length > 0);
  assert.ok(overwrites.some((item) => item.id === '100000000000000001'));
  assert.ok(overwrites.some((item) => item.id === '100000000000000099'));
});

test('review cards show community evidence, development issue, and explicit Owner decision controls', () => {
  const payload = reviewPayload(suggestion());
  const text = JSON.stringify(payload);
  assert.match(text, /SUG-0042/);
  assert.match(text, /3 • 👎 2 • 60% approval/);
  assert.match(text, /Review the development issue\/plan before approving implementation/);
  assert.match(text, /issues\/999/);
  assert.match(text, /Approve Implementation/);
  assert.match(text, /Deny/);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});

test('only passed/review-pending states are actionable', () => {
  assert.deepEqual([...REVIEWABLE_STATUSES].sort(), ['community-passed', 'github-pending', 'github-review'].sort());
  assert.equal(reviewPayload(suggestion({ status: 'approved', reviewReason: 'Approved.' })).components.some((row) => row.components?.some((button) => button.data?.custom_id?.includes(':approve'))), false);
  assert.equal(reviewPayload(suggestion({ status: 'denied', reviewReason: 'Not a fit.' })).components.some((row) => row.components?.some((button) => button.data?.custom_id?.includes(':deny'))), false);
});

test('Owner approval persists and updates the public suggestion card', async () => {
  const state = { current: suggestion() };
  const store = {
    getSuggestion(id) { return id === state.current.id ? state.current : null; },
    setSuggestion(id, value) { assert.equal(id, state.current.id); state.current = value; return value; }
  };
  let publicEdited = null;
  const publicMessage = { async edit(payload) { publicEdited = payload; return this; } };
  const client = {
    channels: {
      async fetch(id) {
        assert.equal(id, state.current.channelId);
        return { messages: { async fetch(messageId) { assert.equal(messageId, state.current.messageId); return publicMessage; } } };
      }
    }
  };
  const interaction = {
    customId: 'kn:suggest:review:SUG-0042:approve',
    user: { id: '100000000000000001' },
    client
  };
  const result = await applyOwnerDecision(interaction, store, { minVotes: 5, passPercent: 60 }, 'approved');
  assert.equal(result.ok, true);
  assert.equal(state.current.status, 'approved');
  assert.match(state.current.reviewReason, /Approved by Nexus Owner/);
  assert.match(JSON.stringify(publicEdited), /Approved for Implementation/);
});

test('Owner denial requires a reason and publishes that reason to the public card', async () => {
  const state = { current: suggestion() };
  const store = {
    getSuggestion() { return state.current; },
    setSuggestion(id, value) { state.current = value; return value; }
  };
  let publicEdited = null;
  const client = {
    channels: {
      async fetch() {
        return { messages: { async fetch() { return { async edit(payload) { publicEdited = payload; } }; } } };
      }
    }
  };
  const interaction = { customId: 'kn:suggest:review-deny:SUG-0042', user: { id: '100000000000000001' }, client };
  const result = await applyOwnerDecision(interaction, store, { minVotes: 5, passPercent: 60 }, 'denied', 'Useful idea, but outside the current Nexus scope.');
  assert.equal(result.ok, true);
  assert.equal(state.current.status, 'denied');
  assert.equal(state.current.reviewReason, 'Useful idea, but outside the current Nexus scope.');
  assert.match(JSON.stringify(publicEdited), /Denial Reason/);
  assert.match(JSON.stringify(publicEdited), /outside the current Nexus scope/);
});
