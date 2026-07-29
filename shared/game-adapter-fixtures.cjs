'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { redactText, redactObject } = require('./redaction.cjs');
const { normalizeAdapterId, normalizeCapabilityId } = require('./game-adapter-sdk.cjs');

const FIXTURE_SCHEMA_VERSION = 1;
const DEFAULT_MAX_ENTRY_BYTES = 128 * 1024;
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const SENSITIVE_KEY = /password|token|secret|api[_-]?key|authorization|cookie|credential|session|private[_-]?key|rcon/i;

function cleanText(value, max = 200, fallback = '') {
  const text = String(value ?? '').replace(/\u0000/g, '').trim();
  return (text || fallback).slice(0, max);
}

function redactFixtureValue(value, explicitSecrets = [], depth = 0) {
  if (depth > 12) return '[TRUNCATED_DEPTH]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactText(value, explicitSecrets).slice(0, 20000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => redactFixtureValue(item, explicitSecrets, depth + 1));
  if (typeof value !== 'object') return cleanText(value, 2000);
  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 500)) {
    result[cleanText(key, 120, 'field')] = SENSITIVE_KEY.test(key)
      ? (item ? '[REDACTED]' : item)
      : redactFixtureValue(item, explicitSecrets, depth + 1);
  }
  return redactObject(result, explicitSecrets);
}

function boundedRecord(record, maxEntryBytes) {
  let line = JSON.stringify(record);
  if (Buffer.byteLength(line, 'utf8') <= maxEntryBytes) return { record, line, truncated: false };
  const compact = {
    schemaVersion: record.schemaVersion,
    id: record.id,
    time: record.time,
    adapterId: record.adapterId,
    gameId: record.gameId,
    capability: record.capability,
    outcome: record.outcome,
    durationMs: record.durationMs,
    requestId: record.requestId,
    truncated: true,
    preview: redactText(line.slice(0, Math.max(1000, Math.floor(maxEntryBytes / 2))))
  };
  line = JSON.stringify(compact);
  return { record: compact, line, truncated: true };
}

class GameAdapterFixtureRecorder {
  constructor({ directory, enabled = false, maxEntryBytes = DEFAULT_MAX_ENTRY_BYTES, maxFileBytes = DEFAULT_MAX_FILE_BYTES, now, fsImpl } = {}) {
    this.directory = directory ? path.resolve(directory) : '';
    this.enabled = Boolean(enabled && this.directory);
    this.maxEntryBytes = Math.max(4096, Math.min(1024 * 1024, Number(maxEntryBytes) || DEFAULT_MAX_ENTRY_BYTES));
    this.maxFileBytes = Math.max(this.maxEntryBytes * 2, Math.min(100 * 1024 * 1024, Number(maxFileBytes) || DEFAULT_MAX_FILE_BYTES));
    this.now = now || (() => new Date());
    this.fs = fsImpl || fs;
  }

  filePath(adapterId) {
    const id = normalizeAdapterId(adapterId);
    return path.join(this.directory, `${id}.jsonl`);
  }

  ensureDirectory() {
    if (!this.enabled) return;
    this.fs.mkdirSync(this.directory, { recursive: true });
  }

  rotate(filePath) {
    try {
      const size = this.fs.statSync(filePath).size;
      if (size < this.maxFileBytes) return;
      const previous = `${filePath}.1`;
      this.fs.rmSync(previous, { force: true });
      this.fs.renameSync(filePath, previous);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  record(input = {}) {
    if (!this.enabled) return { recorded: false, reason: 'disabled' };
    this.ensureDirectory();
    const adapterId = normalizeAdapterId(input.adapterId);
    const capability = normalizeCapabilityId(input.capability);
    const explicitSecrets = Array.isArray(input.explicitSecrets) ? input.explicitSecrets : [];
    const time = input.time ? new Date(input.time) : this.now();
    const record = {
      schemaVersion: FIXTURE_SCHEMA_VERSION,
      id: cleanText(input.id, 80) || crypto.randomUUID(),
      time: Number.isFinite(time.getTime()) ? time.toISOString() : new Date().toISOString(),
      adapterId,
      gameId: cleanText(input.gameId || 'generic', 60, 'generic').toLowerCase(),
      capability,
      outcome: ['success', 'failure', 'cancelled'].includes(input.outcome) ? input.outcome : (input.error ? 'failure' : 'success'),
      durationMs: Math.max(0, Number(input.durationMs) || 0),
      requestId: cleanText(input.requestId, 80),
      request: redactFixtureValue(input.request, explicitSecrets),
      response: redactFixtureValue(input.response, explicitSecrets),
      error: input.error ? redactFixtureValue({
        code: input.error.code,
        message: input.error.message || input.error,
        status: input.error.status,
        retryable: input.error.retryable
      }, explicitSecrets) : null,
      metadata: redactFixtureValue(input.metadata || {}, explicitSecrets)
    };
    const bounded = boundedRecord(record, this.maxEntryBytes);
    const filePath = this.filePath(adapterId);
    this.rotate(filePath);
    this.fs.appendFileSync(filePath, `${bounded.line}\n`, 'utf8');
    return { recorded: true, filePath, id: bounded.record.id, truncated: bounded.truncated };
  }

  list(adapterId, limit = 50) {
    if (!this.directory) return [];
    const filePath = this.filePath(adapterId);
    try {
      const lines = this.fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
      return lines.slice(-Math.max(1, Math.min(500, Number(limit) || 50))).map((line) => {
        try { return JSON.parse(line); }
        catch { return { invalid: true, preview: line.slice(0, 500) }; }
      });
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  clear(adapterId) {
    if (!this.directory) return { cleared: false };
    const filePath = this.filePath(adapterId);
    this.fs.rmSync(filePath, { force: true });
    this.fs.rmSync(`${filePath}.1`, { force: true });
    return { cleared: true, filePath };
  }
}

module.exports = {
  FIXTURE_SCHEMA_VERSION,
  DEFAULT_MAX_ENTRY_BYTES,
  DEFAULT_MAX_FILE_BYTES,
  GameAdapterFixtureRecorder,
  redactFixtureValue,
  boundedRecord
};
