'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { mkdtempSync } = require('node:fs');
const test = require('node:test');
const { EventManager, EventStore } = require('../src/backend/services/event-manager.cjs');
const { PollEngine } = require('../src/backend/services/poll-engine.cjs');
const { PollStore } = require('../src/backend/services/poll-store.cjs');
const { eventCommand, handleEventComponent, reconcileEventCard, renderEventCard } = require('../src/sentinel/event-management-extension.cjs');

function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nexus-events-ui-'));
  const pollEngine = new PollEngine({ store: new PollStore({ filePath: path.join(dir, 'polls.json') }) });
  return new EventManager({ store: new EventStore({ filePath: path.join(dir, 'events.json') }), pollEngine, now: () => new Date('2026-08-25T12:00:00Z') });
}

function fakeChannel() {
  const messages = new Map();
  return {
    id: 'events-channel', sent: 0,
    messages: { async fetch(value) { if (typeof value === 'string') return messages.get(value) || null; return { find: (predicate) => [...messages.values()].find(predicate) }; } },
    async send(payload) {
      this.sent += 1;
      const message = { id: `event-message-${this.sent}`, author: { id: 'sentinel' }, embeds: payload.embeds, edits: 0, async edit(next) { this.embeds = next.embeds; this.edits += 1; return this; } };
      messages.set(message.id, message);
      return message;
    }
  };
}

test('event command exposes the complete staff lifecycle', () => {
  const json = eventCommand().toJSON();
  assert.equal(json.name, 'event');
  assert.deepEqual(json.options.map((option) => option.name), ['create', 'status', 'schedule', 'cancel', 'complete', 'list']);
});

test('event cards use Discord timestamps and retain their managed identity', () => {
  const manager = fixture();
  const event = manager.create({ title: 'Raid Night', startAt: '2026-09-01T19:00:00-05:00', location: '#raid-lobby' });
  const payload = renderEventCard(event);
  assert.match(payload.embeds[0].fields[1].value, /<t:\d+:F>/);
  assert.equal(payload.embeds[0].footer.text, `Nexus Sentinal • Managed Event • ${event.id}`);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});

test('event card reconciliation creates once, persists identity, and edits on lifecycle changes', async () => {
  const manager = fixture();
  const event = manager.create({ title: 'Community Night', startAt: '2026-09-02T00:00:00Z' });
  const channel = fakeChannel();
  const client = { user: { id: 'sentinel' } };
  const first = await reconcileEventCard(client, channel, manager, event.id);
  assert.equal(first.created, true);
  assert.equal(manager.store.get(event.id).messageId, first.message.id);
  manager.cancel(event.id, 'staff', 'Weather');
  const second = await reconcileEventCard(client, channel, manager, event.id);
  assert.equal(second.created, false);
  assert.equal(channel.sent, 1);
  assert.equal(first.message.edits, 1);
  assert.equal(second.event.status, 'cancelled');
});

test('RSVP buttons acknowledge privately and refresh only aggregate public counts', async () => {
  const manager = fixture();
  const event = manager.create({ title: 'Community Night', startAt: '2026-09-02T00:00:00Z' });
  const channel = fakeChannel();
  const client = { user: { id: 'sentinel' } };
  await reconcileEventCard(client, channel, manager, event.id);
  const replies = [];
  const interaction = {
    client, customId: `nxevent:r:${event.id}:going`, user: { id: 'member-1' },
    isButton: () => true, async reply(payload) { replies.push(payload); }
  };
  await handleEventComponent(interaction, { manager, channel });
  assert.equal(manager.store.get(event.id).responses['member-1'].response, 'going');
  assert.ok(replies[0].flags, 'RSVP acknowledgement must be ephemeral');
  const card = renderEventCard(manager.store.get(event.id));
  assert.match(card.embeds[0].fields.at(-1).value, /Going: \*\*1\*\*/);
  assert.doesNotMatch(JSON.stringify(card), /member-1/);
});
