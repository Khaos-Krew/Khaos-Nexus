'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { qualifyParticipation, computeProtocolScore } = require('./nexus-protocol-core.cjs');

const PROGRESS_VERSION = 1;
const EVENT_TYPES = new Set(['presence', 'objective', 'kill', 'death', 'completion', 'manual']);

function cleanId(value, label) {
  const result = String(value ?? '').trim();
  if (!/^[A-Za-z0-9:_-]{1,96}$/.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}

function finiteNonNegative(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid ${label}`);
  return number;
}

function normalizeProgressEvent(input = {}) {
  const runId = cleanId(input.runId, 'protocol run id');
  const accountId = cleanId(input.accountId, 'account id');
  const type = String(input.type || '').trim().toLowerCase();
  if (!EVENT_TYPES.has(type)) throw new Error('Invalid Protocol progress event type');
  const sourceId = cleanId(input.sourceId || input.eventId, 'progress source id');
  const id = crypto.createHash('sha256').update(`${runId}:${accountId}:${sourceId}`).digest('hex').slice(0, 32);
  return Object.freeze({
    id,
    sourceId,
    runId,
    accountId,
    type,
    at: finiteNonNegative(input.at, 'progress event time'),
    activeMinutes: finiteNonNegative(input.activeMinutes, 'active minutes'),
    objectiveContribution: finiteNonNegative(input.objectiveContribution, 'objective contribution'),
    killContribution: finiteNonNegative(input.killContribution, 'kill contribution'),
    deathCount: finiteNonNegative(input.deathCount, 'death count'),
    completed: Boolean(input.completed || type === 'completion'),
    presentAtCompletion: Boolean(input.presentAtCompletion),
    manualContribution: Boolean(input.manualContribution || type === 'manual'),
    mvp: Boolean(input.mvp),
    disqualified: Boolean(input.disqualified),
    afk: Boolean(input.afk)
  });
}

function progressEventFingerprint(input) {
  const event = normalizeProgressEvent(input);
  const payload = [
    event.sourceId,
    event.runId,
    event.accountId,
    event.type,
    event.at,
    event.activeMinutes,
    event.objectiveContribution,
    event.killContribution,
    event.deathCount,
    Number(event.completed),
    Number(event.presentAtCompletion),
    Number(event.manualContribution),
    Number(event.mvp),
    Number(event.disqualified),
    Number(event.afk)
  ].join('|');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function dedupeProgressEvents(events) {
  const unique = new Map();
  const fingerprints = new Map();
  for (const input of events) {
    const event = normalizeProgressEvent(input);
    const fingerprint = progressEventFingerprint(event);
    if (unique.has(event.id)) {
      if (fingerprints.get(event.id) !== fingerprint) throw new Error('Conflicting Protocol progress event replay');
      continue;
    }
    unique.set(event.id, event);
    fingerprints.set(event.id, fingerprint);
  }
  return [...unique.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

function aggregateParticipant(events = [], options = {}) {
  if (!Array.isArray(events) || !events.length) throw new Error('Protocol progress aggregation requires events');
  const unique = dedupeProgressEvents(events);
  const runId = unique[0].runId;
  const accountId = unique[0].accountId;
  if (unique.some((event) => event.runId !== runId || event.accountId !== accountId)) {
    throw new Error('Protocol progress aggregation cannot mix participants or runs');
  }
  const totals = unique.reduce((acc, event) => {
    acc.activeMinutes += event.activeMinutes;
    acc.objectiveContribution += event.objectiveContribution;
    acc.killContribution += event.killContribution;
    acc.deaths += event.deathCount;
    acc.completed ||= event.completed;
    acc.presentAtCompletion ||= event.presentAtCompletion;
    acc.manualContribution ||= event.manualContribution;
    acc.mvp ||= event.mvp;
    acc.disqualified ||= event.disqualified;
    acc.afk ||= event.afk;
    acc.updatedAt = Math.max(acc.updatedAt, event.at);
    return acc;
  }, {
    activeMinutes: 0,
    objectiveContribution: 0,
    killContribution: 0,
    deaths: 0,
    completed: false,
    presentAtCompletion: false,
    manualContribution: false,
    mvp: false,
    disqualified: false,
    afk: false,
    updatedAt: 0
  });
  const eligibility = qualifyParticipation({
    ...totals,
    minActiveMinutes: options.minActiveMinutes,
    requiresCompletionPresence: options.requiresCompletionPresence
  });
  const deathPenalty = Math.min(Number(options.maxDeathPenalty ?? 100), totals.deaths * Number(options.deathPenaltyEach ?? 5));
  const score = computeProtocolScore({ ...totals, deathPenalty });
  return {
    runId,
    accountId,
    discordId: options.discordId || null,
    eosId: options.eosId || null,
    activeMinutes: totals.activeMinutes,
    objectiveContribution: totals.objectiveContribution,
    killContribution: totals.killContribution,
    deaths: totals.deaths,
    completed: totals.completed,
    presentAtCompletion: totals.presentAtCompletion,
    eligible: eligibility.eligible,
    eligibilityReasons: eligibility.reasons,
    score: eligibility.eligible ? score : 0,
    rawScore: score,
    processedEvents: unique.length,
    updatedAt: totals.updatedAt
  };
}

class ProtocolProgressLedger {
  constructor(file, options = {}) {
    this.file = path.resolve(file);
    this.maxEvents = Math.max(100, Math.min(100000, Number(options.maxEvents || 25000)));
    this.state = { version: PROGRESS_VERSION, revision: 0, updatedAt: 0, events: [] };
    this.ids = new Set();
    this.fingerprints = new Map();
  }

  load() {
    if (!fs.existsSync(this.file)) return this.snapshot();
    const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (Number(raw.version) !== PROGRESS_VERSION) throw new Error('Unsupported Protocol progress ledger version');
    const deduped = dedupeProgressEvents(Array.isArray(raw.events) ? raw.events : []);
    this.state = {
      version: PROGRESS_VERSION,
      revision: Math.max(0, Math.floor(Number(raw.revision) || 0)),
      updatedAt: Math.max(0, Number(raw.updatedAt) || 0),
      events: deduped.slice(-this.maxEvents)
    };
    this.ids = new Set(this.state.events.map((event) => event.id));
    this.fingerprints = new Map(this.state.events.map((event) => [event.id, progressEventFingerprint(event)]));
    return this.snapshot();
  }

  append(input) {
    const event = normalizeProgressEvent(input);
    const fingerprint = progressEventFingerprint(event);
    if (this.ids.has(event.id)) {
      if (this.fingerprints.get(event.id) !== fingerprint) throw new Error('Conflicting Protocol progress event replay');
      return { inserted: false, event: { ...event } };
    }
    this.state.events.push(event);
    this.ids.add(event.id);
    this.fingerprints.set(event.id, fingerprint);
    if (this.state.events.length > this.maxEvents) {
      this.state.events = this.state.events.slice(-this.maxEvents);
      this.ids = new Set(this.state.events.map((item) => item.id));
      this.fingerprints = new Map(this.state.events.map((item) => [item.id, progressEventFingerprint(item)]));
    }
    return { inserted: true, event: { ...event } };
  }

  eventsFor(runId, accountId) {
    const run = cleanId(runId, 'protocol run id');
    const account = cleanId(accountId, 'account id');
    return this.state.events.filter((event) => event.runId === run && event.accountId === account).map((event) => ({ ...event }));
  }

  participant(runId, accountId, options = {}) {
    const events = this.eventsFor(runId, accountId);
    return events.length ? aggregateParticipant(events, options) : null;
  }

  save(now = Date.now()) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.state.revision += 1;
    this.state.updatedAt = Number(now);
    const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, this.file);
    return this.snapshot();
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }
}

module.exports = {
  PROGRESS_VERSION,
  normalizeProgressEvent,
  progressEventFingerprint,
  aggregateParticipant,
  ProtocolProgressLedger
};
