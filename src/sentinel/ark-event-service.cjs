'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { EVENT_TYPES, rollAnomaly, buildAnomalyPlan } = require('./ark-event-engine.cjs');

function clean(value, max = 240) {
  return String(value || '').replace(/[\r\n\t\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function eventDefinition(eventId) {
  const id = clean(eventId, 64).toLowerCase();
  return Object.values(EVENT_TYPES).find((event) => event.id === id) || null;
}

class ArkEventRuntimeStore {
  constructor(options = {}) {
    const root = options.root || process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..', 'data');
    this.dir = path.resolve(root);
    this.file = path.join(this.dir, 'ark-event-runtime.json');
    this.now = typeof options.now === 'function' ? options.now : Date.now;
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return { version: 1, events: Array.isArray(parsed?.events) ? parsed.events.slice(-5000) : [], anomalyProposals: Array.isArray(parsed?.anomalyProposals) ? parsed.anomalyProposals.slice(-2000) : [] };
    } catch { return { version: 1, events: [], anomalyProposals: [] }; }
  }

  write(state) {
    fs.mkdirSync(this.dir, { recursive: true });
    const safe = { version: 1, updatedAt: new Date(this.now()).toISOString(), events: (state.events || []).slice(-5000), anomalyProposals: (state.anomalyProposals || []).slice(-2000) };
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(safe, null, 2));
    fs.renameSync(tmp, this.file);
    return safe;
  }

  active(mapId) { return this.read().events.find((event) => event.mapId === clean(mapId, 64) && ['active', 'announcement-review'].includes(event.state)) || null; }

  start({ event, mapId, mapName, objective = '', target = 0, actorId = '' } = {}) {
    if (!event?.id) throw new Error('A known ARK event is required.');
    const state = this.read();
    const map = clean(mapId, 64);
    if (state.events.some((item) => item.mapId === map && ['active', 'announcement-review'].includes(item.state))) throw new Error('An ARK event is already active on this map.');
    const now = this.now();
    const item = {
      id: crypto.randomUUID(), eventId: event.id, label: event.label, mapId: map, mapName: clean(mapName, 80),
      state: 'active', objective: clean(objective || event.description, 300), target: Math.max(0, Number(target) || 0), progress: 0,
      actorId: clean(actorId, 32), startedAt: new Date(now).toISOString(), endsAt: new Date(now + event.durationMinutes * 60_000).toISOString(),
      finishedAt: '', outcome: '', notes: [], rewardHook: { cacheType: event.rewardCache || 'event', state: 'pending-event-completion' }, announcements: []
    };
    state.events.push(item);
    this.write(state);
    return JSON.parse(JSON.stringify(item));
  }

  update(id, mutate) {
    const state = this.read();
    const item = state.events.find((event) => event.id === id);
    if (!item) throw new Error('Unknown ARK event runtime id.');
    mutate(item);
    item.updatedAt = new Date(this.now()).toISOString();
    this.write(state);
    return JSON.parse(JSON.stringify(item));
  }

  lastFinished(mapId, eventId) {
    return this.read().events.filter((item) => item.mapId === clean(mapId, 64) && item.eventId === eventId && item.state === 'finished').sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt))[0] || null;
  }

  addAnomalyProposal({ mapId, mapName, anomaly, plan, actorId = '' } = {}) {
    const state = this.read();
    const item = {
      id: anomaly.id, mapId: clean(mapId, 64), mapName: clean(mapName, 80), actorId: clean(actorId, 32), state: 'proposed',
      anomaly, plan: { ...plan, autoSpawn: false }, proposedAt: new Date(this.now()).toISOString(), approvedAt: '', executedAt: ''
    };
    state.anomalyProposals.push(item);
    this.write(state);
    return JSON.parse(JSON.stringify(item));
  }
}

class ArkEventService {
  constructor({ rcon, store, mapId = 'gen1', mapName = 'ARK', rng, now = Date.now } = {}) {
    if (!rcon?.execute) throw new Error('ARK event service requires RCON.');
    this.rcon = rcon;
    this.now = now;
    this.store = store || new ArkEventRuntimeStore({ now });
    this.mapId = clean(mapId, 64);
    this.mapName = clean(mapName, 80);
    this.rng = rng;
  }

  status() {
    const event = this.store.active(this.mapId);
    return event ? { ok: true, active: true, event } : { ok: true, active: false, event: null };
  }

  cooldown(event) {
    const previous = this.store.lastFinished(this.mapId, event.id);
    if (!previous) return { active: false, remainingSeconds: 0 };
    const expiresAt = Date.parse(previous.finishedAt) + event.cooldownMinutes * 60_000;
    const remainingSeconds = Math.max(0, Math.ceil((expiresAt - this.now()) / 1000));
    return { active: remainingSeconds > 0, remainingSeconds, expiresAt: new Date(expiresAt).toISOString() };
  }

  async announce(commands) {
    const delivered = [];
    for (const command of commands) {
      await this.rcon.execute(command);
      delivered.push(command);
    }
    return delivered;
  }

  async start({ eventId, objective = '', target = 0, actorId = '' } = {}) {
    const definition = eventDefinition(eventId);
    if (!definition) return { ok: false, reason: 'unknown-event' };
    if (this.store.active(this.mapId)) return { ok: false, reason: 'event-already-active', event: this.store.active(this.mapId) };
    const cooldown = this.cooldown(definition);
    if (cooldown.active) return { ok: false, reason: 'cooldown', cooldown };
    const event = this.store.start({ event: definition, mapId: this.mapId, mapName: this.mapName, objective, target, actorId });
    const commands = [
      `Broadcast [${this.mapName}] ${definition.label} begins now.`,
      `Broadcast Objective: ${event.objective}`,
      `Broadcast Event window: ${definition.durationMinutes} minutes.`
    ];
    try {
      const announcements = await this.announce(commands);
      return { ok: true, event: this.store.update(event.id, (item) => { item.announcements = announcements; }) };
    } catch (error) {
      const reviewed = this.store.update(event.id, (item) => { item.state = 'announcement-review'; item.announcementError = clean(error?.message || error, 240); });
      return { ok: false, reason: 'announcement-review', event: reviewed };
    }
  }

  progress({ amount = 0, note = '', actorId = '' } = {}) {
    const active = this.store.active(this.mapId);
    if (!active) return { ok: false, reason: 'no-active-event' };
    const delta = Number(amount);
    if (!Number.isSafeInteger(delta) || delta < 0 || delta > 1_000_000) return { ok: false, reason: 'invalid-progress' };
    const event = this.store.update(active.id, (item) => {
      item.progress = Math.min(1_000_000_000, Math.max(0, Number(item.progress) || 0) + delta);
      if (note) item.notes = [...(item.notes || []), { note: clean(note, 240), actorId: clean(actorId, 32), at: new Date(this.now()).toISOString() }].slice(-200);
    });
    return { ok: true, event };
  }

  async finish({ outcome = '', actorId = '', automatic = false } = {}) {
    const active = this.store.active(this.mapId);
    if (!active) return { ok: false, reason: 'no-active-event' };
    const event = this.store.update(active.id, (item) => {
      item.state = 'finished'; item.finishedAt = new Date(this.now()).toISOString(); item.outcome = clean(outcome || (automatic ? 'Event window completed.' : 'Completed by staff.'), 300);
      item.finishedBy = clean(actorId, 32); item.rewardHook.state = 'ready-for-staff-award';
    });
    try {
      await this.announce([`Broadcast [${this.mapName}] ${event.label} has ended.`, `Broadcast ${event.outcome}`]);
      return { ok: true, event };
    } catch (error) {
      return { ok: false, reason: 'finish-announcement-review', event, error: clean(error?.message || error, 240) };
    }
  }

  async tick() {
    const active = this.store.active(this.mapId);
    if (!active || Date.parse(active.endsAt) > this.now()) return { changed: false, event: active || null };
    const result = await this.finish({ automatic: true, actorId: 'sentinel-timer' });
    return { changed: true, ...result };
  }

  proposeAnomaly({ actorId = '', baseMaxLevel = 150 } = {}) {
    const anomaly = rollAnomaly({ rng: this.rng, baseMaxLevel });
    const plan = buildAnomalyPlan(anomaly, this.mapName);
    return { ok: true, proposal: this.store.addAnomalyProposal({ mapId: this.mapId, mapName: this.mapName, anomaly, plan, actorId }) };
  }
}

module.exports = { clean, eventDefinition, ArkEventRuntimeStore, ArkEventService };
