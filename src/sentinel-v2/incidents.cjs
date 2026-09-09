'use strict';

const { createHash } = require('node:crypto');

function fingerprintIncident({ source = 'sentinel', code = 'unknown', subject = '', message = '' } = {}) {
  return createHash('sha256')
    .update([source, code, subject, normalizeMessage(message)].join('|'))
    .digest('hex')
    .slice(0, 24);
}

function normalizeMessage(message) {
  return String(message || '')
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, '<timestamp>')
    .replace(/\b\d+ms\b/g, '<duration>')
    .replace(/\s+/g, ' ')
    .trim();
}

class IncidentTracker {
  constructor() {
    this.open = new Map();
  }

  observe(input) {
    const now = new Date().toISOString();
    const fingerprint = input.fingerprint || fingerprintIncident(input);
    const current = this.open.get(fingerprint);
    if (current) {
      current.lastSeenAt = now;
      current.occurrences += 1;
      current.message = String(input.message || current.message);
      current.severity = input.severity || current.severity;
      return { incident: { ...current }, created: false };
    }

    const incident = {
      fingerprint,
      source: input.source || 'sentinel',
      code: input.code || 'unknown',
      subject: input.subject || '',
      message: String(input.message || ''),
      severity: input.severity || 'warning',
      status: 'open',
      firstSeenAt: now,
      lastSeenAt: now,
      occurrences: 1,
    };
    this.open.set(fingerprint, incident);
    return { incident: { ...incident }, created: true };
  }

  recover(fingerprint) {
    const incident = this.open.get(fingerprint);
    if (!incident) return null;
    this.open.delete(fingerprint);
    return { ...incident, status: 'recovered', recoveredAt: new Date().toISOString() };
  }

  listOpen() {
    return [...this.open.values()].map((item) => ({ ...item }));
  }
}

module.exports = { IncidentTracker, fingerprintIncident, normalizeMessage };
