'use strict';

const { buildArkHealthEquivalenceReport } = require('./ark-health-equivalence.cjs');

class ArkShadowComparison {
  constructor({ evidence, window, logger } = {}) {
    if (!evidence?.record) throw new TypeError('ARK equivalence evidence recorder is required');
    this.evidence = evidence;
    this.window = window;
    this.logger = logger;
  }

  async hydrate({ since, limit = 500 } = {}) {
    if (!this.window?.hydrate || !this.evidence?.history) {
      return this.window?.evaluate?.();
    }
    const history = await this.evidence.history({ since, limit });
    const acceptance = this.window.hydrate(history);
    this.logger?.info?.('sentinel.ark.health_equivalence.restored', {
      samples: acceptance?.samples || 0,
      persistedSamples: acceptance?.persistedSamples || 0,
      driftedSamples: acceptance?.driftedSamples || 0,
      durationMs: acceptance?.durationMs || 0,
      retirementEligible: acceptance?.eligible === true,
      retirementReasons: acceptance?.reasons || [],
    });
    return acceptance;
  }

  async compare({ v2Results = [], legacySnapshots = [], correlationId } = {}) {
    const report = buildArkHealthEquivalenceReport(v2Results, legacySnapshots);
    const recorded = await this.evidence.record(report, { correlationId });
    const acceptance = this.window?.add?.(recorded);
    const result = Object.freeze({ report, evidence: recorded, acceptance });
    this.logger?.info?.('sentinel.ark.health_equivalence.compared', {
      equivalent: report.equivalent,
      servers: report.servers,
      drifted: report.drifted,
      retirementEligible: acceptance?.eligible === true,
      retirementReasons: acceptance?.reasons || [],
    });
    return result;
  }
}

module.exports = { ArkShadowComparison };
