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

  hydrate(incidents = []) {
    this.open.clear();
    for (const incident of incidents) {
      if (incident?.status === 'open' && incident.fingerprint) {
        this.open.set(incident.fingerprint, { ...incident });
      }
    }
    return this.listOpen();
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
      current.metadata = input.metadata || current.metadata || {};
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
      metadata: input.metadata || {},
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

class DurableIncidentTracker {
  constructor({ store, logger } = {}) {
    this.store = store;
    this.logger = logger;
    this.memory = new IncidentTracker();
  }

  async hydrate() {
    if (!this.store?.enabled) return this.memory.listOpen();
    const open = await this.store.listOpen();
    this.memory.hydrate(open);
    this.logger?.info?.('sentinel.incidents.hydrated', { open: open.length });
    return this.memory.listOpen();
  }

  async observe(input) {
    const observed = this.memory.observe(input);
    if (!this.store?.enabled) return observed;
    try {
      const persisted = await this.store.observe(observed.incident);
      this.memory.open.set(persisted.fingerprint, { ...persisted });
      return { incident: { ...persisted }, created: observed.created };
    } catch (error) {
      this.logger?.error?.('sentinel.incidents.persist_failed', { error, fingerprint: observed.incident.fingerprint });
      throw error;
    }
  }

  async recover(fingerprint) {
    const recovered = this.memory.recover(fingerprint);
    if (!recovered) return null;
    if (!this.store?.enabled) return recovered;
    try {
      return await this.store.recover(fingerprint, recovered.recoveredAt) || recovered;
    } catch (error) {
      this.memory.open.set(fingerprint, { ...recovered, status: 'open', recoveredAt: undefined });
      this.logger?.error?.('sentinel.incidents.recovery_persist_failed', { error, fingerprint });
      throw error;
    }
  }

  listOpen() {
    return this.memory.listOpen();
  }
}

module.exports = { IncidentTracker, DurableIncidentTracker, fingerprintIncident, normalizeMessage };
