'use strict';

const path = require('node:path');
const { JsonStore, clone } = require('../core/json-store.cjs');

const EVENT_ID_RE = /^EVENT-\d{4,}$/;
const EVENT_STATUSES = Object.freeze(['draft', 'scheduled', 'cancelled', 'completed']);

function clean(value, max = 1000) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function eventId(value) {
  const id = String(value || '').toUpperCase();
  if (!EVENT_ID_RE.test(id)) throw new Error('Event ID must use the EVENT-#### format.');
  return id;
}

function iso(value, label, optional = false) {
  if (!value && optional) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid date and time.`);
  return date.toISOString();
}

function defaultEventFile(dataDir = '') {
  const root = String(dataDir || process.env.NEXUS_DATA_DIR || path.join(process.cwd(), 'data'));
  return path.join(root, 'events.json');
}

class EventStore {
  constructor(options = {}) {
    this.store = options.store || new JsonStore(options.filePath || defaultEventFile(options.dataDir), {
      schemaVersion: 1,
      nextSequence: 1,
      events: {}
    });
  }

  allocateId() {
    return this.store.update((state) => {
      const sequence = Math.max(1, Math.trunc(Number(state.nextSequence || 1)));
      state.nextSequence = sequence + 1;
      return `EVENT-${String(sequence).padStart(4, '0')}`;
    });
  }

  get(id) {
    const value = this.store.read().events?.[eventId(id)] || null;
    return value ? clone(value) : null;
  }

  list(options = {}) {
    const statuses = options.statuses ? new Set(options.statuses.map(String)) : null;
    const values = Object.values(this.store.read().events || {})
      .filter((event) => !statuses || statuses.has(event.status))
      .sort((a, b) => Date.parse(a.startAt || a.createdAt) - Date.parse(b.startAt || b.createdAt));
    return values.slice(0, Math.max(0, Number(options.limit || values.length))).map(clone);
  }

  create(record) {
    return this.store.update((state) => {
      state.events ||= {};
      if (state.events[record.id]) throw new Error(`${record.id} already exists.`);
      state.events[record.id] = clone(record);
      return clone(record);
    });
  }

  update(id, mutate) {
    const key = eventId(id);
    return this.store.update((state) => {
      const current = state.events?.[key];
      if (!current) throw new Error(`${key} does not exist.`);
      const next = mutate(current) || current;
      state.events[key] = clone(next);
      return clone(next);
    });
  }
}

class EventManager {
  constructor(options = {}) {
    this.store = options.store || new EventStore(options);
    this.pollEngine = options.pollEngine || null;
    this.now = typeof options.now === 'function' ? options.now : () => new Date();
  }

  create(input = {}) {
    const now = new Date(this.now()).toISOString();
    const title = clean(input.title, 180);
    if (!title) throw new Error('Event title is required.');
    const startAt = iso(input.startAt, 'Event start');
    const endAt = iso(input.endAt, 'Event end', true);
    if (endAt && Date.parse(endAt) <= Date.parse(startAt)) throw new Error('Event end must be after its start.');
    const id = this.store.allocateId();
    const record = {
      id,
      title,
      description: clean(input.description, 1800),
      location: clean(input.location || 'Discord', 200),
      hostId: String(input.hostId || ''),
      guildId: String(input.guildId || ''),
      channelId: String(input.channelId || ''),
      messageId: '',
      startAt,
      endAt,
      status: input.status === 'draft' ? 'draft' : 'scheduled',
      pollId: '',
      responses: {},
      createdAt: now,
      updatedAt: now,
      cancelledAt: '',
      cancelReason: '',
      completedAt: '',
      audit: [{ action: 'created', actorId: String(input.hostId || ''), at: now }]
    };
    if (Array.isArray(input.scheduleOptions) && input.scheduleOptions.length) {
      if (!this.pollEngine) throw new Error('Event scheduling polls require the shared Poll Engine.');
      const poll = this.pollEngine.create({
        profile: 'event-scheduling',
        question: `Choose a time for ${title}`,
        description: record.description,
        options: input.scheduleOptions,
        creatorId: record.hostId,
        source: 'event',
        sourceLink: id,
        guildId: record.guildId,
        channelId: record.channelId
      });
      record.pollId = poll.id;
      record.status = 'draft';
    }
    return this.store.create(record);
  }

  linkMessage(id, channelId, messageId) {
    return this.store.update(id, (event) => {
      event.channelId = String(channelId || event.channelId || '');
      event.messageId = String(messageId || '');
      event.updatedAt = new Date(this.now()).toISOString();
      return event;
    });
  }

  schedule(id, startAt, actorId = '') {
    const at = new Date(this.now()).toISOString();
    const start = iso(startAt, 'Event start');
    return this.store.update(id, (event) => {
      if (['cancelled', 'completed'].includes(event.status)) throw new Error('Finalized events cannot be rescheduled.');
      event.startAt = start;
      event.status = 'scheduled';
      event.updatedAt = at;
      event.audit.push({ action: 'scheduled', actorId: String(actorId), at });
      return event;
    });
  }

  cancel(id, actorId = '', reason = '') {
    const at = new Date(this.now()).toISOString();
    return this.store.update(id, (event) => {
      if (event.status === 'completed') throw new Error('Completed events cannot be cancelled.');
      event.status = 'cancelled';
      event.cancelledAt = at;
      event.cancelReason = clean(reason, 500);
      event.updatedAt = at;
      event.audit.push({ action: 'cancelled', actorId: String(actorId), at });
      return event;
    });
  }

  complete(id, actorId = '') {
    const at = new Date(this.now()).toISOString();
    return this.store.update(id, (event) => {
      if (event.status === 'cancelled') throw new Error('Cancelled events cannot be completed.');
      event.status = 'completed';
      event.completedAt = at;
      event.updatedAt = at;
      event.audit.push({ action: 'completed', actorId: String(actorId), at });
      return event;
    });
  }

  rsvp(id, userId, response) {
    const actor = String(userId || '').trim();
    if (!actor) throw new Error('RSVP requires a member identity.');
    const choice = String(response || '').toLowerCase();
    if (!['going', 'maybe', 'cant'].includes(choice)) throw new Error('RSVP must be going, maybe, or cant.');
    const at = new Date(this.now()).toISOString();
    return this.store.update(id, (event) => {
      if (['cancelled', 'completed'].includes(event.status)) throw new Error('This event is no longer accepting RSVPs.');
      event.responses ||= {};
      if (event.responses[actor]?.response === choice) delete event.responses[actor];
      else event.responses[actor] = { userId: actor, response: choice, updatedAt: at };
      event.updatedAt = at;
      return event;
    });
  }

  syncSchedulingPoll(id) {
    const event = this.store.get(id);
    if (!event) throw new Error(`${eventId(id)} does not exist.`);
    if (!event.pollId || event.status !== 'draft' || !this.pollEngine) return { event, changed: false, reason: 'not-awaiting-poll' };
    const poll = this.pollEngine.get(event.pollId, { includeVotes: false });
    if (!poll?.finalResult || poll.status !== 'closed') return { event, changed: false, reason: 'poll-not-final' };
    const winners = poll.finalResult.winnerOptionIds || [];
    if (winners.length !== 1) return { event, changed: false, reason: 'no-single-winner' };
    const winner = (poll.options || []).find((option) => String(option.id) === String(winners[0]));
    if (!winner || Number.isNaN(Date.parse(winner.label))) return { event, changed: false, reason: 'winner-not-a-date' };
    return { event: this.schedule(event.id, winner.label, 'poll-engine'), changed: true, reason: 'scheduled-from-poll' };
  }

  syncSchedulingPolls() {
    const results = [];
    for (const event of this.store.list({ statuses: ['draft'] })) {
      if (event.pollId) results.push({ id: event.id, ...this.syncSchedulingPoll(event.id) });
    }
    return results;
  }

  tick() {
    const scheduling = this.syncSchedulingPolls();
    const completed = [];
    const now = Date.parse(new Date(this.now()).toISOString());
    for (const event of this.store.list({ statuses: ['scheduled'] })) {
      if (!event.endAt || Date.parse(event.endAt) > now) continue;
      this.complete(event.id, 'scheduler');
      completed.push(event.id);
    }
    return { scheduling, completed };
  }
}

module.exports = { EVENT_ID_RE, EVENT_STATUSES, EventManager, EventStore, clean, defaultEventFile, eventId, iso };
