'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { PollEngine } = require('../src/backend/services/poll-engine.cjs');
const { PollStore } = require('../src/backend/services/poll-store.cjs');
const { EventManager, EventStore } = require('../src/backend/services/event-manager.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-events-'));
  let now = new Date('2026-08-25T12:00:00.000Z');
  const clock = () => now;
  const polls = new PollEngine({ store: new PollStore({ filePath: path.join(root, 'polls.json') }), now: clock });
  const events = new EventManager({ store: new EventStore({ filePath: path.join(root, 'events.json') }), pollEngine: polls, now: clock });
  return { root, polls, events, setNow: (value) => { now = new Date(value); } };
}

test('events receive durable IDs and persist their bounded schedule', () => {
  const fx = fixture();
  try {
    const event = fx.events.create({ title: 'Nexus Game Night', startAt: '2026-08-26T01:00:00Z', endAt: '2026-08-26T03:00:00Z', hostId: 'owner' });
    assert.equal(event.id, 'EVENT-0001');
    assert.equal(event.status, 'scheduled');
    const restarted = new EventStore({ filePath: path.join(fx.root, 'events.json') });
    assert.equal(restarted.get(event.id).title, 'Nexus Game Night');
  } finally { fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test('event scheduling choices create one linked shared Poll Engine record', () => {
  const fx = fixture();
  try {
    const event = fx.events.create({
      title: 'Community Raid', startAt: '2026-08-27T01:00:00Z', hostId: 'staff',
      scheduleOptions: ['Friday 8 PM', 'Saturday 8 PM', 'Sunday 6 PM']
    });
    assert.equal(event.status, 'draft');
    assert.match(event.pollId, /^POLL-\d{4}$/);
    const poll = fx.polls.get(event.pollId, { includeVotes: true });
    assert.equal(poll.profile, 'event-scheduling');
    assert.equal(poll.source, 'event');
    assert.equal(poll.sourceLink, event.id);
  } finally { fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test('event lifecycle is auditable and finalized states are protected', () => {
  const fx = fixture();
  try {
    const event = fx.events.create({ title: 'Workshop', startAt: '2026-08-26T01:00:00Z' });
    const scheduled = fx.events.schedule(event.id, '2026-08-26T02:00:00Z', 'staff');
    assert.equal(scheduled.startAt, '2026-08-26T02:00:00.000Z');
    const completed = fx.events.complete(event.id, 'staff');
    assert.equal(completed.status, 'completed');
    assert.throws(() => fx.events.cancel(event.id, 'staff'), /cannot be cancelled/i);
    assert.deepEqual(completed.audit.map((row) => row.action), ['created', 'scheduled', 'completed']);
  } finally { fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test('invalid event time ranges fail before persistence', () => {
  const fx = fixture();
  try {
    assert.throws(() => fx.events.create({ title: 'Bad', startAt: '2026-08-26T03:00:00Z', endAt: '2026-08-26T02:00:00Z' }), /after its start/i);
    assert.equal(fx.events.store.list().length, 0);
  } finally { fs.rmSync(fx.root, { recursive: true, force: true }); }
});
