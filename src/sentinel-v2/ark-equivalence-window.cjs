'use strict';

class ArkEquivalenceWindow {
  constructor({ minSamples = 12, minDurationMs = 60 * 60 * 1000, maxDriftedSamples = 0 } = {}) {
    this.minSamples = Math.max(1, Number(minSamples) || 12);
    this.minDurationMs = Math.max(0, Number(minDurationMs) || 0);
    this.maxDriftedSamples = Math.max(0, Number(maxDriftedSamples) || 0);
    this.samples = [];
  }

  add(evidence = {}) {
    const sample = normalizeEvidenceSample(evidence);
    const duplicate = sample.auditId != null
      ? this.samples.some((item) => item.auditId === sample.auditId)
      : this.samples.some((item) => item.checkedAt === sample.checkedAt && item.equivalent === sample.equivalent);
    if (!duplicate) this.samples.push(sample);
    this.samples.sort((a, b) => a.checkedAt.localeCompare(b.checkedAt));
    return this.evaluate();
  }

  hydrate(evidence = []) {
    this.samples = [];
    for (const item of Array.isArray(evidence) ? evidence : []) this.add(item);
    return this.evaluate();
  }

  evaluate() {
    const count = this.samples.length;
    const first = count ? new Date(this.samples[0].checkedAt).getTime() : 0;
    const last = count ? new Date(this.samples[count - 1].checkedAt).getTime() : 0;
    const durationMs = count > 1 ? Math.max(0, last - first) : 0;
    const driftedSamples = this.samples.filter((sample) => !sample.equivalent || sample.drifted > 0).length;
    const persistedSamples = this.samples.filter((sample) => sample.persisted).length;
    const reasons = [];
    if (count < this.minSamples) reasons.push('insufficient-samples');
    if (durationMs < this.minDurationMs) reasons.push('insufficient-duration');
    if (driftedSamples > this.maxDriftedSamples) reasons.push('drift-detected');
    if (persistedSamples < count) reasons.push('evidence-not-fully-persisted');
    return Object.freeze({
      eligible: reasons.length === 0,
      reasons,
      samples: count,
      persistedSamples,
      driftedSamples,
      durationMs,
      criteria: Object.freeze({ minSamples: this.minSamples, minDurationMs: this.minDurationMs, maxDriftedSamples: this.maxDriftedSamples }),
    });
  }
}

function normalizeEvidenceSample(evidence = {}) {
  const checkedAt = new Date(evidence.checkedAt || Date.now());
  if (Number.isNaN(checkedAt.getTime())) throw new TypeError('equivalence evidence checkedAt must be a valid date');
  return Object.freeze({
    checkedAt: checkedAt.toISOString(),
    equivalent: evidence.equivalent === true,
    servers: Number(evidence.servers || 0),
    matched: Number(evidence.matched || 0),
    drifted: Number(evidence.drifted || 0),
    auditId: evidence.auditId == null ? undefined : Number(evidence.auditId),
    persisted: evidence.persisted === true,
  });
}

module.exports = { ArkEquivalenceWindow, normalizeEvidenceSample };
