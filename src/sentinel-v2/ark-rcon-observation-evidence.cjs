'use strict';

const OBSERVED_ACTION = 'sentinel.ark.rcon.players_observed';
const DEGRADED_ACTION = 'sentinel.ark.rcon.players_degraded';
const EVIDENCE_SUBJECT = 'ark-rcon-players-shadow';

class ArkRconObservationEvidence {
  constructor({ auditStore, logger } = {}) {
    this.auditStore = auditStore;
    this.logger = logger;
  }

  async record(summary = {}, outcomes = [], { correlationId } = {}) {
    const servers = Array.isArray(outcomes) ? outcomes.map((outcome) => normalizeOutcome(outcome)).filter(Boolean) : [];
    const evidence = Object.freeze({
      observedAt: new Date().toISOString(),
      servers: Number(summary.servers || servers.length || 0),
      succeeded: Number(summary.succeeded || 0),
      blocked: Number(summary.blocked || 0),
      failed: Number(summary.failed || 0),
      players: Number(summary.players || 0),
      results: Object.freeze(servers),
    });

    const healthy = evidence.failed === 0 && evidence.blocked === 0 && evidence.succeeded === evidence.servers;
    const action = healthy ? OBSERVED_ACTION : DEGRADED_ACTION;
    const persisted = await this.auditStore?.append?.({
      actor: 'nexus-sentinel-worker',
      action,
      subject: EVIDENCE_SUBJECT,
      correlationId,
      details: evidence,
    });

    const logDetails = {
      servers: evidence.servers,
      succeeded: evidence.succeeded,
      blocked: evidence.blocked,
      failed: evidence.failed,
      players: evidence.players,
      persisted: persisted?.persisted === true,
    };
    if (healthy) this.logger?.info?.(action, logDetails);
    else this.logger?.warn?.(action, logDetails);

    return Object.freeze({
      ...evidence,
      healthy,
      persisted: persisted?.persisted === true,
      auditId: persisted?.auditId,
    });
  }
}

function normalizeOutcome(outcome = {}) {
  const result = outcome?.result && typeof outcome.result === 'object' ? outcome.result : {};
  const serverId = String(result.serverId || outcome.serverId || outcome.subject || '').trim();
  if (!serverId) return null;
  return Object.freeze({
    serverId,
    ok: outcome.ok === true,
    blocked: outcome.blocked === true,
    playerCount: outcome.ok === true ? Number(result.playerCount || 0) : undefined,
    reason: outcome.ok === true ? undefined : boundedReason(outcome.reason || outcome.error?.message),
  });
}

function boundedReason(value) {
  const text = String(value || '').trim();
  return text ? text.slice(0, 160) : undefined;
}

module.exports = {
  ArkRconObservationEvidence,
  OBSERVED_ACTION,
  DEGRADED_ACTION,
  EVIDENCE_SUBJECT,
  normalizeOutcome,
};
