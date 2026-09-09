'use strict';

class ArkEquivalenceEvidence {
  constructor({ auditStore, logger } = {}) {
    this.auditStore = auditStore;
    this.logger = logger;
  }

  async record(report = {}, { correlationId } = {}) {
    const comparisons = Array.isArray(report.comparisons) ? report.comparisons : [];
    const drift = comparisons.filter((item) => item?.equivalent !== true).map((item) => ({
      serverId: String(item?.serverId || ''),
      serverName: item?.serverName || undefined,
      differences: Array.isArray(item?.differences) ? item.differences : [],
    }));
    const evidence = {
      equivalent: report.equivalent === true,
      servers: Number(report.servers || comparisons.length || 0),
      matched: Number(report.matched || 0),
      drifted: Number(report.drifted || drift.length || 0),
      checkedAt: report.checkedAt || new Date().toISOString(),
      drift,
    };

    const action = evidence.equivalent
      ? 'sentinel.ark.health_equivalence.matched'
      : 'sentinel.ark.health_equivalence.drifted';

    const persisted = await this.auditStore?.append?.({
      actor: 'nexus-sentinel-worker',
      action,
      subject: 'ark-cluster-health',
      correlationId,
      details: evidence,
    });

    const logDetails = {
      equivalent: evidence.equivalent,
      servers: evidence.servers,
      matched: evidence.matched,
      drifted: evidence.drifted,
      checkedAt: evidence.checkedAt,
    };
    if (evidence.equivalent) this.logger?.info?.(action, logDetails);
    else this.logger?.warn?.(action, logDetails);

    return { ...evidence, persisted: persisted?.persisted === true, auditId: persisted?.auditId };
  }
}

module.exports = { ArkEquivalenceEvidence };
