'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { mkdtempSync } = require('node:fs');
const test = require('node:test');
const { PollEngine } = require('../src/backend/services/poll-engine.cjs');
const { PollStore } = require('../src/backend/services/poll-store.cjs');
const {
  handlePollComponent,
  pollTick,
  reconcilePollCard,
  registerPollCommand,
  voterFromInteraction
} = require('../src/sentinel/poll-extension.cjs');

function engineAt(iso = '2026-08-25T12:00:00.000Z') {
  let current = new Date(iso);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nexus-poll-extension-'));
  const store = new PollStore({ filePath: path.join(dir, 'polls.json') });
  return {
    engine: new PollEngine({ store, now: () => current }),
    setNow(value) { current = new Date(value); }
  };
}

function fakeChannel() {
  const messages = new Map();
  let sequence = 0;
  return {
    id: 'poll-channel',
    sent: 0,
    messages: {
      async fetch(value) {
        if (typeof value === 'string') return messages.get(value) || null;
        return { find: (predicate) => [...messages.values()].find(predicate) || null };
      }
    },
    async send(payload) {
      this.sent += 1;
      const id = `message-${++sequence}`;
      const message = {
        id,
        author: { id: 'sentinel' },
        embeds: payload.embeds,
        edits: 0,
        async edit(next) { this.embeds = next.embeds; this.components = next.components; this.edits += 1; return this; }
      };
      messages.set(id, message);
      return message;
    },
    get(id) { return messages.get(id); }
  };
}

test('poll card reconciliation creates once, persists Discord identity, and edits thereafter', async () => {
  const { engine } = engineAt();
  const poll = engine.create({ question: 'Ship it?', options: ['Yes', 'No'], guildId: 'guild' });
  const channel = fakeChannel();
  const client = { user: { id: 'sentinel' } };

  const first = await reconcilePollCard(client, channel, engine, poll.id);
  assert.equal(first.created, true);
  assert.equal(channel.sent, 1);
  assert.equal(first.poll.channelId, channel.id);
  assert.equal(first.poll.messageId, first.message.id);

  const second = await reconcilePollCard(client, channel, engine, poll.id);
  assert.equal(second.created, false);
  assert.equal(channel.sent, 1);
  assert.equal(first.message.edits, 1);
});

test('button voting is private, persists member roles, and refreshes the public card', async () => {
  const { engine } = engineAt();
  const poll = engine.create({ question: 'Choose', options: ['Alpha', 'Beta'], eligibleRoleIds: ['member'] });
  const channel = fakeChannel();
  const client = { user: { id: 'sentinel' } };
  await reconcilePollCard(client, channel, engine, poll.id);
  const replies = [];
  const interaction = {
    client,
    customId: `nxpoll:v:${poll.id}:OPT-2`,
    user: { id: 'user-1', bot: false },
    member: { id: 'user-1', roles: { cache: new Map([['member', {}]]) } },
    isButton: () => true,
    isStringSelectMenu: () => false,
    async reply(payload) { replies.push(payload); }
  };

  const result = await handlePollComponent(interaction, { engine, channel });
  assert.equal(result.handled, true);
  assert.deepEqual(engine.get(poll.id, { includeVotes: true }).votes['user-1'].optionIds, ['OPT-2']);
  assert.equal(replies.length, 1);
  assert.ok(replies[0].flags, 'vote acknowledgement must be ephemeral');
  assert.equal(channel.sent, 1);
});

test('scheduler refreshes cards for polls it opens and closes', async () => {
  const clock = engineAt();
  const scheduled = clock.engine.create({
    question: 'Scheduled', options: ['A', 'B'],
    opensAt: '2026-08-25T12:05:00.000Z', closesAt: '2026-08-25T12:10:00.000Z'
  });
  const channel = fakeChannel();
  const client = { user: { id: 'sentinel' } };
  await reconcilePollCard(client, channel, clock.engine, scheduled.id);

  clock.setNow('2026-08-25T12:06:00.000Z');
  const opened = await pollTick(client, channel, clock.engine);
  assert.deepEqual(opened.opened, [scheduled.id]);
  assert.equal(clock.engine.get(scheduled.id).status, 'open');

  clock.setNow('2026-08-25T12:11:00.000Z');
  const closed = await pollTick(client, channel, clock.engine);
  assert.deepEqual(closed.closed, [scheduled.id]);
  assert.equal(clock.engine.get(scheduled.id).status, 'closed');
});

test('poll command registration edits an existing guild command instead of duplicating it', async () => {
  const calls = [];
  const existing = { id: 'command-1', name: 'poll' };
  const guild = { commands: {
    async fetch() { return { find: (predicate) => predicate(existing) ? existing : null }; },
    async edit(command, definition) { calls.push(['edit', command.id, definition.name]); },
    async create(definition) { calls.push(['create', definition.name]); }
  } };
  assert.equal(await registerPollCommand(guild), 'poll');
  assert.deepEqual(calls, [['edit', 'command-1', 'poll']]);
});

test('voter projection never includes unrelated member data', () => {
  const voter = voterFromInteraction({
    user: { id: '42', bot: false, email: 'private@example.invalid' },
    member: { roles: { cache: new Map([['r1', {}], ['r2', {}]]) }, displayName: 'Private' }
  });
  assert.deepEqual(voter, { id: '42', bot: false, roleIds: ['r1', 'r2'] });
});
