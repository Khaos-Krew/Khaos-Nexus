'use strict';

const MATCHED_ACTION = 'sentinel.ark.health_equivalence.matched';
const DRIFTED_ACTION = 'sentinel.ark.health_equivalence.drifted';
const EVIDENCE_SUBJECT = 'ark-cluster-health';

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

    const action = evidence.equivalent ? MATCHED_ACTION : DRIFTED_ACTION;

    const persisted = await this.auditStore?.append?.({
      actor: 'nexus-sentinel-worker',
      action,
      subject: EVIDENCE_SUBJECT,
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

  async history({ since, limit = 500 } = {}) {
    const entries = await this.auditStore?.list?.({
      actions: [MATCHED_ACTION, DRIFTED_ACTION],
      subject: EVIDENCE_SUBJECT,
      since,
      limit,
    });
    if (!Array.isArray(entries)) return [];

    return entries.map((entry) => {
      const details = entry?.details && typeof entry.details === 'object' ? entry.details : {};
      const checkedAt = details.checkedAt || entry.occurredAt;
      const parsed = new Date(checkedAt);
      if (Number.isNaN(parsed.getTime())) return null;
      const equivalent = entry.action === MATCHED_ACTION && details.equivalent !== false;
      return Object.freeze({
        checkedAt: parsed.toISOString(),
        equivalent,
        servers: Number(details.servers || 0),
        matched: Number(details.matched || 0),
        drifted: Number(details.drifted || (equivalent ? 0 : 1)),
        auditId: entry.auditId || undefined,
        persisted: entry.persisted === true,
      });
    }).filter(Boolean);
  }
}

module.exports = {
  ArkEquivalenceEvidence,
  MATCHED_ACTION,
  DRIFTED_ACTION,
  EVIDENCE_SUBJECT,
};
