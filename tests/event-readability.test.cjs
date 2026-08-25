'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderEventCard, eventStatus } = require('../src/sentinel/event-management-extension.cjs');

test('managed event cards separate schedule, location, and RSVP counts', () => {
  const event = {
    id: 'EVENT-0042',
    title: 'Nexus Night',
    status: 'scheduled',
    startAt: '2026-09-01T19:00:00-05:00',
    endAt: '2026-09-01T22:00:00-05:00',
    description: 'Community game night.',
    location: 'Nexus Lounge',
    pollId: 'POLL-0042',
    responses: {
      a: { response: 'going' },
      b: { response: 'maybe' },
      c: { response: 'cant' }
    },
    updatedAt: '2026-08-25T22:00:00.000Z'
  };
  const payload = renderEventCard(event);
  assert.match(payload.embeds[0].description, /\n\n/);
  const details = payload.embeds[0].fields.find((field) => field.name === '🧭 Event Details');
  assert.match(details.value, /\n\n/);
  const rsvps = payload.embeds[0].fields.find((field) => field.name === '👥 RSVPs');
  assert.match(rsvps.value, /Going.*\n.*Maybe.*\n.*Can’t Go/s);
  assert.match(eventStatus(event), /\n\n/);
  assert.equal(payload.components[0].components.length, 3);
});
