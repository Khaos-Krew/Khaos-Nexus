'use strict';

const { ArkEquivalenceEvidence } = require('./ark-equivalence-evidence.cjs');
const { ArkEquivalenceWindow } = require('./ark-equivalence-window.cjs');

class ArkHealthReadiness {
  constructor({ auditStore, minSamples = 12, minDurationMs = 60 * 60 * 1000, maxDriftedSamples = 0 } = {}) {
    if (!auditStore?.list) throw new TypeError('audit store is required');
    this.evidence = new ArkEquivalenceEvidence({ auditStore });
    this.criteria = Object.freeze({ minSamples, minDurationMs, maxDriftedSamples });
  }

  async snapshot({ since, limit = 500 } = {}) {
    const samples = await this.evidence.history({ since, limit });
    const window = new ArkEquivalenceWindow(this.criteria);
    const acceptance = window.hydrate(samples);
    const latest = samples.length ? samples[samples.length - 1] : null;

    return Object.freeze({
      advisory: true,
      writeCapable: false,
      eligible: acceptance.eligible === true,
      reasons: acceptance.reasons,
      samples: acceptance.samples,
      persistedSamples: acceptance.persistedSamples,
      driftedSamples: acceptance.driftedSamples,
      durationMs: acceptance.durationMs,
      criteria: acceptance.criteria,
      latest: latest ? Object.freeze({
        checkedAt: latest.checkedAt,
        equivalent: latest.equivalent,
        servers: latest.servers,
        matched: latest.matched,
        drifted: latest.drifted,
      }) : null,
    });
  }
}

module.exports = { ArkHealthReadiness };
