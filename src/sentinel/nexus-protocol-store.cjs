'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STORE_VERSION = 1;
const SEASON_TRANSITIONS = Object.freeze({
  planned: new Set(['planned', 'active', 'closed']),
  active: new Set(['active', 'closed']),
  closed: new Set(['closed'])
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanString(value, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function cleanId(value, label = 'id') {
  const result = cleanString(value, 96);
  if (!/^[A-Za-z0-9:_-]{1,96}$/.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}

function finiteNonNegative(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid ${label}`);
  return number;
}

function emptyState() {
  return {
    version: STORE_VERSION,
    revision: 0,
    updatedAt: 0,
    seasons: {},
    protocolRuns: {},
    participants: {},
    darkZone: {},
    audit: []
  };
}

function normalizeSeason(input = {}) {
  const id = cleanId(input.id, 'season id');
  const startsAt = finiteNonNegative(input.startsAt, 'season start');
  const endsAt = finiteNonNegative(input.endsAt, 'season end');
  if (endsAt && endsAt <= startsAt) throw new Error('Season end must be after season start');
  return {
    id,
    name: cleanString(input.name || id, 80),
    startsAt,
    endsAt,
    status: ['planned', 'active', 'closed'].includes(input.status) ? input.status : 'planned'
  };
}

function assertSeasonTransition(previous, next) {
  if (!previous) return;
  const allowed = SEASON_TRANSITIONS[previous.status];
  if (!allowed || !allowed.has(next.status)) {
    throw new Error(`Invalid season transition ${previous.status} -> ${next.status}`);
  }
  if (previous.status !== 'planned') {
    if (previous.startsAt !== next.startsAt || previous.endsAt !== next.endsAt) {
      throw new Error('Started or closed season boundaries are immutable');
    }
  }
}

function validateSeasonTopology(seasons = {}) {
  const records = Object.values(seasons);
  const active = records.filter((season) => season.status === 'active');
  if (active.length > 1) throw new Error('Multiple active Nexus Protocol seasons are not allowed');
  return true;
}

function normalizeRun(input = {}) {
  const id = cleanId(input.id, 'protocol run id');
  const protocolId = cleanId(input.protocolId, 'protocol id');
  return {
    id,
    protocolId,
    seasonId: input.seasonId ? cleanId(input.seasonId, 'season id') : null,
    map: cleanString(input.map || 'cluster', 80),
    state: cleanString(input.state, 48),
    startedAt: finiteNonNegative(input.startedAt, 'run start'),
    endedAt: finiteNonNegative(input.endedAt, 'run end'),
    objectiveKey: cleanString(input.objectiveKey, 96) || null,
    metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? clone(input.metadata) : {}
  };
}

function participantKey(runId, accountId) {
  return `${cleanId(runId, 'protocol run id')}::${cleanId(accountId, 'account id')}`;
}

function normalizeParticipant(input = {}) {
  const runId = cleanId(input.runId, 'protocol run id');
  const accountId = cleanId(input.accountId, 'account id');
  return {
    key: participantKey(runId, accountId),
    runId,
    accountId,
    discordId: input.discordId ? cleanId(input.discordId, 'discord id') : null,
    eosId: input.eosId ? cleanId(input.eosId, 'EOS id') : null,
    activeMinutes: finiteNonNegative(input.activeMinutes, 'active minutes'),
    objectiveContribution: finiteNonNegative(input.objectiveContribution, 'objective contribution'),
    killContribution: finiteNonNegative(input.killContribution, 'kill contribution'),
    deaths: finiteNonNegative(input.deaths, 'deaths'),
    completed: Boolean(input.completed),
    presentAtCompletion: Boolean(input.presentAtCompletion),
    eligible: Boolean(input.eligible),
    score: Math.floor(finiteNonNegative(input.score, 'protocol score')),
    updatedAt: finiteNonNegative(input.updatedAt, 'participant updated time')
  };
}

function normalizeDarkZone(input = {}) {
  const accountId = cleanId(input.accountId, 'account id');
  return {
    accountId,
    state: cleanString(input.state || 'safe', 32),
    enrollmentMode: input.enrollmentMode === 'tribe' ? 'tribe' : 'solo',
    effectiveAt: finiteNonNegative(input.effectiveAt, 'Dark Zone effective time'),
    safeAt: finiteNonNegative(input.safeAt, 'Dark Zone safe time'),
    changedAt: finiteNonNegative(input.changedAt, 'Dark Zone changed time'),
    lastPvpDamageAt: finiteNonNegative(input.lastPvpDamageAt, 'Dark Zone damage time'),
    lastPvpKillAt: finiteNonNegative(input.lastPvpKillAt, 'Dark Zone kill time'),
    lastStructureDamageAt: finiteNonNegative(input.lastStructureDamageAt, 'Dark Zone structure damage time'),
    registeredTameIds: Array.isArray(input.registeredTameIds)
      ? [...new Set(input.registeredTameIds.map((value) => cleanId(value, 'tame id')))].slice(0, 200)
      : []
  };
}

function normalizeState(input) {
  const raw = input && typeof input === 'object' ? input : {};
  if (raw.version !== undefined && Number(raw.version) !== STORE_VERSION) throw new Error('Unsupported Nexus Protocol store version');
  const state = emptyState();
  state.revision = Math.floor(finiteNonNegative(raw.revision, 'store revision'));
  state.updatedAt = finiteNonNegative(raw.updatedAt, 'store updated time');

  for (const item of Object.values(raw.seasons || {})) {
    const record = normalizeSeason(item);
    state.seasons[record.id] = record;
  }
  validateSeasonTopology(state.seasons);
  for (const item of Object.values(raw.protocolRuns || {})) {
    const record = normalizeRun(item);
    state.protocolRuns[record.id] = record;
  }
  for (const item of Object.values(raw.participants || {})) {
    const record = normalizeParticipant(item);
    state.participants[record.key] = record;
  }
  for (const item of Object.values(raw.darkZone || {})) {
    const record = normalizeDarkZone(item);
    state.darkZone[record.accountId] = record;
  }
  state.audit = Array.isArray(raw.audit) ? raw.audit.slice(-1000).map((entry) => ({
    at: finiteNonNegative(entry.at, 'audit time'),
    type: cleanString(entry.type, 64),
    actor: cleanString(entry.actor || 'system', 96),
    subject: cleanString(entry.subject, 128),
    detail: cleanString(entry.detail, 320)
  })) : [];
  return state;
}

class NexusProtocolStore {
  constructor(file, options = {}) {
    this.file = path.resolve(file);
    this.maxAuditEntries = Math.max(100, Math.min(5000, Number(options.maxAuditEntries || 1000)));
    this.state = emptyState();
  }

  load() {
    if (!fs.existsSync(this.file)) {
      this.state = emptyState();
      return this.snapshot();
    }
    this.state = normalizeState(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    return this.snapshot();
  }

  snapshot() {
    return clone(this.state);
  }

  save(now = Date.now()) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.state.version = STORE_VERSION;
    this.state.revision += 1;
    this.state.updatedAt = Number(now);
    const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, this.file);
    return this.snapshot();
  }

  audit(type, subject, detail = '', actor = 'system', at = Date.now()) {
    this.state.audit.push({
      at: finiteNonNegative(at, 'audit time'),
      type: cleanString(type, 64),
      actor: cleanString(actor, 96),
      subject: cleanString(subject, 128),
      detail: cleanString(detail, 320)
    });
    this.state.audit = this.state.audit.slice(-this.maxAuditEntries);
  }

  upsertSeason(input) {
    const record = normalizeSeason(input);
    const previous = this.state.seasons[record.id] || null;
    assertSeasonTransition(previous, record);
    const nextSeasons = { ...this.state.seasons, [record.id]: record };
    validateSeasonTopology(nextSeasons);
    this.state.seasons[record.id] = record;
    return clone(record);
  }

  upsertRun(input) {
    const record = normalizeRun(input);
    if (record.seasonId && !this.state.seasons[record.seasonId]) throw new Error('Unknown season for protocol run');
    this.state.protocolRuns[record.id] = record;
    return clone(record);
  }

  upsertParticipant(input) {
    const record = normalizeParticipant(input);
    if (!this.state.protocolRuns[record.runId]) throw new Error('Unknown protocol run for participant');
    this.state.participants[record.key] = record;
    return clone(record);
  }

  upsertDarkZone(input) {
    const record = normalizeDarkZone(input);
    this.state.darkZone[record.accountId] = record;
    return clone(record);
  }

  leaderboard(seasonId, limit = 25) {
    const id = cleanId(seasonId, 'season id');
    const runIds = new Set(Object.values(this.state.protocolRuns)
      .filter((run) => run.seasonId === id)
      .map((run) => run.id));
    const totals = new Map();
    for (const record of Object.values(this.state.participants)) {
      if (!record.eligible || !runIds.has(record.runId)) continue;
      const current = totals.get(record.accountId) || { accountId: record.accountId, score: 0, runs: 0 };
      current.score += record.score;
      current.runs += 1;
      totals.set(record.accountId, current);
    }
    return [...totals.values()]
      .sort((a, b) => b.score - a.score || b.runs - a.runs || a.accountId.localeCompare(b.accountId))
      .slice(0, Math.max(1, Math.min(100, Number(limit || 25))))
      .map((entry, index) => ({ rank: index + 1, ...entry }));
  }
}

module.exports = {
  STORE_VERSION,
  SEASON_TRANSITIONS,
  emptyState,
  normalizeSeason,
  assertSeasonTransition,
  validateSeasonTopology,
  normalizeRun,
  normalizeParticipant,
  normalizeDarkZone,
  normalizeState,
  participantKey,
  NexusProtocolStore
};
