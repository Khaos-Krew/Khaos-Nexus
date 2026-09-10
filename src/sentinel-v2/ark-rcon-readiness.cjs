'use strict';

const {
  OBSERVED_ACTION,
  DEGRADED_ACTION,
  EVIDENCE_SUBJECT,
} = require('./ark-rcon-observation-evidence.cjs');
const {
  ArkRconObservationWindow,
  mapRconObservationAuditHistory,
} = require('./ark-rcon-observation-window.cjs');

class ArkRconReadiness {
  constructor({ auditStore, minSamples = 12, minDurationMs = 60 * 60 * 1000, maxDegradedSamples = 0 } = {}) {
    if (!auditStore?.list) throw new TypeError('audit store is required');
    this.auditStore = auditStore;
    this.criteria = Object.freeze({ minSamples, minDurationMs, maxDegradedSamples });
  }

  async snapshot({ since, limit = 500 } = {}) {
    const records = await this.auditStore.list({
      actions: [OBSERVED_ACTION, DEGRADED_ACTION],
      subject: EVIDENCE_SUBJECT,
      since,
      limit,
    });
    const samples = mapRconObservationAuditHistory(records);
    const window = new ArkRconObservationWindow(this.criteria);
    const acceptance = window.hydrate(samples);
    const latest = samples.length ? samples[samples.length - 1] : null;

    return Object.freeze({
      advisory: true,
      writeCapable: false,
      eligible: acceptance.eligible === true,
      reasons: acceptance.reasons,
      samples: acceptance.samples,
      persistedSamples: acceptance.persistedSamples,
      degradedSamples: acceptance.degradedSamples,
      durationMs: acceptance.durationMs,
      criteria: acceptance.criteria,
      latest: latest ? Object.freeze({
        observedAt: latest.observedAt,
        healthy: latest.healthy,
        servers: latest.servers,
        succeeded: latest.succeeded,
        blocked: latest.blocked,
        failed: latest.failed,
        players: latest.players,
      }) : null,
    });
  }
}

module.exports = { ArkRconReadiness };
