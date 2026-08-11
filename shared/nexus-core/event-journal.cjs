'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { makeEvent } = require('./contracts.cjs');

const JOURNAL_VERSION = 1;
const SECRET_KEYS = new Set([
  'password',
  'token',
  'secret',
  'apikey',
  'authorization',
  'rconpassword',
  'discordtoken',
  'githubtoken',
  'openaiapikey'
]);

function journalError(message, code = 'NEXUS_EVENT_JOURNAL_INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function assertNoSecrets(value, trail = 'payload') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecrets(entry, `${trail}[${index}]`));
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEYS.has(normalizeKey(key))) {
      throw journalError(`Journal payload cannot contain secret field ${trail}.${key}.`, 'NEXUS_EVENT_JOURNAL_SECRET');
    }
    assertNoSecrets(entry, `${trail}.${key}`);
  }
}

function scopeKey(event) {
  return `${event.scope.kind}:${event.scope.id}`;
}

function freezeRecord(input) {
  return Object.freeze({
    journalVersion: JOURNAL_VERSION,
    sequence: input.sequence,
    scopeSequence: input.scopeSequence,
    event: input.event
  });
}

class FileEventJournal {
  constructor(options = {}) {
    if (!options.filePath) throw journalError('filePath is required.');
    this.filePath = path.resolve(String(options.filePath));
    this.fsync = options.fsync !== false;
    this.records = [];
    this.byEventId = new Map();
    this.scopeSequences = new Map();
    this.loaded = false;
  }

  load() {
    if (this.loaded) return this;
    this.loaded = true;
    if (!fs.existsSync(this.filePath)) return this;

    const text = fs.readFileSync(this.filePath, 'utf8');
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    let expectedSequence = 1;

    for (const [index, line] of lines.entries()) {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        throw journalError(`Journal line ${index + 1} is not valid JSON: ${error.message}`, 'NEXUS_EVENT_JOURNAL_CORRUPT');
      }

      if (parsed?.journalVersion !== JOURNAL_VERSION) {
        throw journalError(`Journal line ${index + 1} uses an unsupported journal version.`, 'NEXUS_EVENT_JOURNAL_VERSION');
      }
      if (parsed.sequence !== expectedSequence) {
        throw journalError(`Journal sequence is not contiguous at line ${index + 1}.`, 'NEXUS_EVENT_JOURNAL_CORRUPT');
      }

      const event = makeEvent(parsed.event);
      assertNoSecrets(event.payload);
      const key = scopeKey(event);
      const expectedScopeSequence = (this.scopeSequences.get(key) || 0) + 1;
      if (parsed.scopeSequence !== expectedScopeSequence) {
        throw journalError(`Scope sequence is not contiguous at line ${index + 1}.`, 'NEXUS_EVENT_JOURNAL_CORRUPT');
      }
      if (this.byEventId.has(event.eventId)) {
        throw journalError(`Duplicate eventId ${event.eventId} exists in the journal.`, 'NEXUS_EVENT_JOURNAL_CORRUPT');
      }

      const record = freezeRecord({
        sequence: parsed.sequence,
        scopeSequence: parsed.scopeSequence,
        event
      });
      this.records.push(record);
      this.byEventId.set(event.eventId, record);
      this.scopeSequences.set(key, parsed.scopeSequence);
      expectedSequence += 1;
    }

    return this;
  }

  append(eventInput) {
    this.load();
    const event = makeEvent(eventInput);
    assertNoSecrets(event.payload);

    const existing = this.byEventId.get(event.eventId);
    if (existing) {
      if (JSON.stringify(existing.event) !== JSON.stringify(event)) {
        throw journalError(`eventId ${event.eventId} was reused with different content.`, 'NEXUS_EVENT_ID_CONFLICT');
      }
      return Object.freeze({ duplicate: true, record: existing });
    }

    const key = scopeKey(event);
    const record = freezeRecord({
      sequence: this.records.length + 1,
      scopeSequence: (this.scopeSequences.get(key) || 0) + 1,
      event
    });

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const fd = fs.openSync(this.filePath, 'a');
    try {
      fs.writeSync(fd, `${JSON.stringify(record)}\n`, null, 'utf8');
      if (this.fsync) fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    this.records.push(record);
    this.byEventId.set(event.eventId, record);
    this.scopeSequences.set(key, record.scopeSequence);
    return Object.freeze({ duplicate: false, record });
  }

  get(eventId) {
    this.load();
    return this.byEventId.get(String(eventId || '')) || null;
  }

  list(filter = {}) {
    this.load();
    const afterSequence = Math.max(0, Number(filter.afterSequence || 0));
    const limit = Math.max(0, Number.isFinite(Number(filter.limit)) ? Number(filter.limit) : Number.MAX_SAFE_INTEGER);
    const scopeKind = filter.scope?.kind ? String(filter.scope.kind) : null;
    const scopeId = filter.scope?.id ? String(filter.scope.id) : null;
    const type = filter.type ? String(filter.type) : null;
    const correlationId = filter.correlationId ? String(filter.correlationId) : null;

    const output = [];
    for (const record of this.records) {
      if (record.sequence <= afterSequence) continue;
      if (scopeKind && record.event.scope.kind !== scopeKind) continue;
      if (scopeId && record.event.scope.id !== scopeId) continue;
      if (type && record.event.type !== type) continue;
      if (correlationId && record.event.correlationId !== correlationId) continue;
      output.push(record);
      if (output.length >= limit) break;
    }
    return Object.freeze(output.slice());
  }

  replay(projector, initialState, filter = {}) {
    if (typeof projector !== 'function') throw journalError('projector must be a function.');
    let state = initialState;
    for (const record of this.list(filter)) state = projector(state, record.event, record);
    return state;
  }

  stats() {
    this.load();
    return Object.freeze({
      journalVersion: JOURNAL_VERSION,
      records: this.records.length,
      scopes: this.scopeSequences.size,
      lastSequence: this.records.length ? this.records[this.records.length - 1].sequence : 0
    });
  }
}

module.exports = {
  JOURNAL_VERSION,
  FileEventJournal,
  assertNoSecrets
};
