'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_JOINS = 500;
const MAX_MEMBER_SIGNALS = 100;
const MAX_MEMBER_MESSAGES = 40;
const MAX_CASE_EVIDENCE = 80;
const MAX_AUDIT = 1200;
const SIGNAL_RETENTION_MS = 24 * 60 * 60_000;
const MESSAGE_RETENTION_MS = 10 * 60_000;
const JOIN_RETENTION_MS = 10 * 60_000;

function emptyState() {
  return {
    version: 1,
    infrastructure: null,
    mode: { level: 'normal', since: '', reason: '' },
    joins: [],
    members: {},
    cases: {},
    nextCaseNumber: 1,
    audit: []
  };
}

function boundedText(value, max = 300) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function timestamp(value = Date.now()) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now();
}

function iso(value = Date.now()) {
  return new Date(timestamp(value)).toISOString();
}

function severityRank(state) {
  return ({ normal: 0, watch: 1, suspicious: 2, quarantined: 3 })[String(state || '')] ?? 0;
}

class ShieldStore {
  constructor(root = process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..')) {
    this.dir = process.env.NEXUS_DATA_DIR ? path.resolve(root) : path.join(root, 'data');
    this.file = path.join(this.dir, 'sentinal-shield.json');
  }

  read() {
    let state = null;
    try { state = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
    state ||= emptyState();
    state.version = 1;
    state.infrastructure ??= null;
    state.mode ||= { level: 'normal', since: '', reason: '' };
    state.joins = Array.isArray(state.joins) ? state.joins : [];
    state.members ||= {};
    state.cases ||= {};
    state.nextCaseNumber = Math.max(1, Number(state.nextCaseNumber) || 1);
    state.audit = Array.isArray(state.audit) ? state.audit : [];
    return state;
  }

  write(state) {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, this.file);
  }

  getInfrastructure() {
    const value = this.read().infrastructure;
    return value ? JSON.parse(JSON.stringify(value)) : null;
  }

  setInfrastructure(value = {}) {
    const state = this.read();
    state.infrastructure = { ...value, updatedAt: new Date().toISOString() };
    this.write(state);
    return this.getInfrastructure();
  }

  getMode() {
    return { ...this.read().mode };
  }

  setMode(level, reason = '', now = Date.now()) {
    const state = this.read();
    const previous = String(state.mode?.level || 'normal');
    const next = String(level || 'normal');
    if (previous === next && boundedText(reason) === boundedText(state.mode?.reason)) return { ...state.mode, changed: false };
    state.mode = { level: next, since: iso(now), reason: boundedText(reason, 240) };
    this.write(state);
    return { ...state.mode, changed: previous !== next, previous };
  }

  recordJoin(userId, profile = {}, now = Date.now()) {
    const current = timestamp(now);
    const id = String(userId || '');
    if (!id) return null;
    const state = this.read();
    state.joins = state.joins
      .filter((item) => current - timestamp(item.at) <= JOIN_RETENTION_MS)
      .slice(-(MAX_JOINS - 1));
    state.joins.push({ userId: id, at: current });
    const member = state.members[id] || { signals: [], messages: [] };
    member.createdTimestamp = Number(profile.createdTimestamp) || member.createdTimestamp || 0;
    member.joinedTimestamp = Number(profile.joinedTimestamp) || current;
    member.lastJoinAt = current;
    member.signals = Array.isArray(member.signals) ? member.signals : [];
    member.messages = Array.isArray(member.messages) ? member.messages : [];
    state.members[id] = member;
    this.write(state);
    return { ...member };
  }

  recentJoinTimestamps(now = Date.now()) {
    const current = timestamp(now);
    return this.read().joins.map((item) => timestamp(item.at)).filter((at) => current - at <= JOIN_RETENTION_MS);
  }

  getMember(userId) {
    const member = this.read().members?.[String(userId || '')];
    return member ? JSON.parse(JSON.stringify(member)) : null;
  }

  recordSignal(userId, type, detail = {}, now = Date.now()) {
    const current = timestamp(now);
    const id = String(userId || '');
    if (!id || !type) return null;
    const state = this.read();
    const member = state.members[id] || { signals: [], messages: [] };
    member.signals = (Array.isArray(member.signals) ? member.signals : [])
      .filter((item) => current - timestamp(item.at) <= SIGNAL_RETENTION_MS)
      .slice(-(MAX_MEMBER_SIGNALS - 1));
    member.signals.push({
      type: boundedText(type, 64),
      at: current,
      detail: Object.fromEntries(Object.entries(detail || {}).slice(0, 12).map(([key, value]) => [boundedText(key, 64), boundedText(value, 300)]))
    });
    member.messages = Array.isArray(member.messages) ? member.messages : [];
    state.members[id] = member;
    this.write(state);
    return member.signals.at(-1);
  }

  recentSignalCount(userId, type, withinMs = 10 * 60_000, now = Date.now()) {
    const current = timestamp(now);
    const member = this.read().members?.[String(userId || '')];
    if (!member) return 0;
    return (Array.isArray(member.signals) ? member.signals : []).filter((item) => item.type === type && current - timestamp(item.at) <= withinMs).length;
  }

  recordMessageFingerprint(userId, fingerprint, now = Date.now()) {
    const current = timestamp(now);
    const id = String(userId || '');
    const fp = boundedText(fingerprint, 128);
    if (!id || !fp) return 0;
    const state = this.read();
    const member = state.members[id] || { signals: [], messages: [] };
    member.messages = (Array.isArray(member.messages) ? member.messages : [])
      .filter((item) => current - timestamp(item.at) <= MESSAGE_RETENTION_MS)
      .slice(-(MAX_MEMBER_MESSAGES - 1));
    member.messages.push({ fingerprint: fp, at: current });
    member.signals = Array.isArray(member.signals) ? member.signals : [];
    state.members[id] = member;
    const repeated = member.messages.filter((item) => item.fingerprint === fp && current - timestamp(item.at) <= 2 * 60_000).length;
    this.write(state);
    return repeated;
  }

  allocateCaseId(state = null) {
    const target = state || this.read();
    const number = Math.max(1, Number(target.nextCaseNumber) || 1);
    target.nextCaseNumber = number + 1;
    return `SEC-${String(number).padStart(4, '0')}`;
  }

  openCaseForUser(userId) {
    const id = String(userId || '');
    return Object.values(this.read().cases).find((item) => String(item.userId || '') === id && item.status === 'open') || null;
  }

  upsertCase(userId, risk = {}, evidence = {}, now = Date.now()) {
    const current = timestamp(now);
    const id = String(userId || '');
    if (!id) throw new Error('Shield case requires a Discord user ID.');
    const state = this.read();
    let record = Object.values(state.cases).find((item) => String(item.userId || '') === id && item.status === 'open') || null;
    const created = !record;
    const previousRisk = record?.riskState || 'normal';
    if (!record) {
      const caseId = this.allocateCaseId(state);
      record = {
        caseId,
        userId: id,
        status: 'open',
        createdAt: iso(current),
        updatedAt: iso(current),
        riskState: String(risk.state || 'watch'),
        score: Number(risk.score) || 0,
        reasons: [],
        evidence: [],
        actions: []
      };
      state.cases[caseId] = record;
    }
    record.updatedAt = iso(current);
    if (severityRank(risk.state) >= severityRank(record.riskState)) record.riskState = String(risk.state || record.riskState);
    record.score = Math.max(Number(record.score) || 0, Number(risk.score) || 0);
    record.reasons = [...new Set([...(record.reasons || []), ...((risk.reasons || []).map((item) => boundedText(item, 120)))])].slice(-30);
    const evidenceEntry = Object.fromEntries(Object.entries(evidence || {}).slice(0, 16).map(([key, value]) => [boundedText(key, 64), boundedText(value, 500)]));
    if (Object.keys(evidenceEntry).length) {
      record.evidence = [...(record.evidence || []), { at: iso(current), ...evidenceEntry }].slice(-MAX_CASE_EVIDENCE);
    }
    this.write(state);
    return {
      record: JSON.parse(JSON.stringify(record)),
      created,
      escalated: severityRank(record.riskState) > severityRank(previousRisk),
      previousRisk
    };
  }

  addCaseAction(caseId, action, actorId = 'sentinal', detail = '', now = Date.now()) {
    const state = this.read();
    const record = state.cases?.[String(caseId || '').toUpperCase()];
    if (!record) return null;
    record.actions = [...(record.actions || []), {
      at: iso(now),
      action: boundedText(action, 80),
      actorId: boundedText(actorId, 80),
      detail: boundedText(detail, 500)
    }].slice(-100);
    record.updatedAt = iso(now);
    this.write(state);
    return JSON.parse(JSON.stringify(record));
  }

  closeCase(caseId, actorId, resolution = '', now = Date.now()) {
    const state = this.read();
    const id = String(caseId || '').toUpperCase();
    const record = state.cases?.[id];
    if (!record) return null;
    record.status = 'closed';
    record.closedAt = iso(now);
    record.closedBy = boundedText(actorId, 80);
    record.resolution = boundedText(resolution, 500);
    record.updatedAt = iso(now);
    this.write(state);
    return JSON.parse(JSON.stringify(record));
  }

  listCases() {
    return JSON.parse(JSON.stringify(this.read().cases || {}));
  }

  addAudit(event, detail = {}, now = Date.now()) {
    const state = this.read();
    const entry = {
      at: iso(now),
      event: boundedText(event, 100),
      detail: Object.fromEntries(Object.entries(detail || {}).slice(0, 16).map(([key, value]) => [boundedText(key, 64), boundedText(value, 500)]))
    };
    state.audit = [...(state.audit || []), entry].slice(-MAX_AUDIT);
    this.write(state);
    return entry;
  }
}

module.exports = {
  ShieldStore,
  emptyState,
  boundedText,
  severityRank,
  MAX_JOINS,
  MAX_MEMBER_SIGNALS,
  MAX_MEMBER_MESSAGES,
  MAX_CASE_EVIDENCE,
  MAX_AUDIT
};
