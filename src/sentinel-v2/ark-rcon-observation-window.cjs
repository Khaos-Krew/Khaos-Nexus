'use strict';

const {
  OBSERVED_ACTION,
  DEGRADED_ACTION,
  EVIDENCE_SUBJECT,
} = require('./ark-rcon-observation-evidence.cjs');

class ArkRconObservationWindow {
  constructor({ minSamples = 12, minDurationMs = 60 * 60 * 1000, maxDegradedSamples = 0 } = {}) {
    this.minSamples = Math.max(1, Number(minSamples) || 12);
    this.minDurationMs = Math.max(0, Number(minDurationMs) || 0);
    this.maxDegradedSamples = Math.max(0, Number(maxDegradedSamples) || 0);
    this.samples = [];
  }

  add(evidence = {}) {
    const sample = normalizeObservationSample(evidence);
    const duplicate = sample.auditId != null
      ? this.samples.some((item) => item.auditId === sample.auditId)
      : this.samples.some((item) => item.observedAt === sample.observedAt && item.healthy === sample.healthy);
    if (!duplicate) this.samples.push(sample);
    this.samples.sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    return this.evaluate();
  }

  hydrate(evidence = []) {
    this.samples = [];
    for (const item of Array.isArray(evidence) ? evidence : []) this.add(item);
    return this.evaluate();
  }

  evaluate() {
    const count = this.samples.length;
    const first = count ? new Date(this.samples[0].observedAt).getTime() : 0;
    const last = count ? new Date(this.samples[count - 1].observedAt).getTime() : 0;
    const durationMs = count > 1 ? Math.max(0, last - first) : 0;
    const degradedSamples = this.samples.filter((sample) => !sample.healthy).length;
    const persistedSamples = this.samples.filter((sample) => sample.persisted).length;
    const reasons = [];

    if (count < this.minSamples) reasons.push('insufficient-samples');
    if (durationMs < this.minDurationMs) reasons.push('insufficient-duration');
    if (degradedSamples > this.maxDegradedSamples) reasons.push('degraded-observation-detected');
    if (persistedSamples < count) reasons.push('evidence-not-fully-persisted');

    return Object.freeze({
      eligible: reasons.length === 0,
      reasons: Object.freeze(reasons),
      samples: count,
      persistedSamples,
      degradedSamples,
      durationMs,
      criteria: Object.freeze({
        minSamples: this.minSamples,
        minDurationMs: this.minDurationMs,
        maxDegradedSamples: this.maxDegradedSamples,
      }),
    });
  }
}

function normalizeObservationSample(evidence = {}) {
  const observedAt = new Date(evidence.observedAt || Date.now());
  if (Number.isNaN(observedAt.getTime())) throw new TypeError('RCON observation evidence observedAt must be a valid date');

  const servers = Math.max(0, Number(evidence.servers || 0));
  const succeeded = Math.max(0, Number(evidence.succeeded || 0));
  const blocked = Math.max(0, Number(evidence.blocked || 0));
  const failed = Math.max(0, Number(evidence.failed || 0));
  const healthy = evidence.healthy === true
    || (evidence.healthy == null && servers > 0 && blocked === 0 && failed === 0 && succeeded === servers);

  return Object.freeze({
    observedAt: observedAt.toISOString(),
    healthy,
    servers,
    succeeded,
    blocked,
    failed,
    players: Math.max(0, Number(evidence.players || 0)),
    auditId: evidence.auditId == null ? undefined : Number(evidence.auditId),
    persisted: evidence.persisted === true,
  });
}

function mapRconObservationAuditHistory(records = []) {
  return (Array.isArray(records) ? records : [])
    .filter((record) => record && record.subject === EVIDENCE_SUBJECT)
    .filter((record) => record.action === OBSERVED_ACTION || record.action === DEGRADED_ACTION)
    .map((record) => {
      const details = record.details && typeof record.details === 'object' ? record.details : {};
      return normalizeObservationSample({
        ...details,
        healthy: record.action === OBSERVED_ACTION,
        observedAt: details.observedAt || record.createdAt || record.created_at,
        auditId: record.auditId ?? record.id,
        persisted: true,
      });
    })
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
}

module.exports = {
  ArkRconObservationWindow,
  normalizeObservationSample,
  mapRconObservationAuditHistory,
};
