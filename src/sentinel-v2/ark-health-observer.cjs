'use strict';

const { fingerprintIncident } = require('./incidents.cjs');

function arkHealthFingerprint(serverId) {
  return fingerprintIncident({
    source: 'ark.health',
    code: 'server-degraded',
    subject: String(serverId || ''),
    message: 'server-degraded',
  });
}

class ArkHealthObserver {
  constructor({ incidents, auditStore, logger } = {}) {
    this.incidents = incidents;
    this.auditStore = auditStore;
    this.logger = logger;
  }

  async observe(summary = {}) {
    const transitions = [];
    const healthRows = Array.isArray(summary.health) ? summary.health : [];

    for (const health of healthRows) {
      const serverId = String(health?.serverId || '').trim();
      if (!serverId) continue;
      const fingerprint = arkHealthFingerprint(serverId);

      if (health.ok === true && health.degraded !== true) {
        const recovered = await this.incidents?.recover?.(fingerprint);
        if (recovered) {
          const transition = { type: 'recovered', serverId, fingerprint, incident: recovered };
          transitions.push(transition);
          await this.#audit('sentinel.ark.health.recovered', health, transition);
          this.logger?.info?.('sentinel.ark.health.recovered', { serverId, fingerprint });
        }
        continue;
      }

      const errors = Array.isArray(health.errors) ? health.errors.filter(Boolean).map(String) : [];
      const message = errors.join(' | ') || 'ARK health observation reported degraded state';
      const observed = await this.incidents?.observe?.({
        fingerprint,
        source: 'ark.health',
        code: 'server-degraded',
        subject: serverId,
        message,
        severity: 'warning',
        metadata: {
          serverName: health.serverName || serverId,
          envPrefix: health.envPrefix || undefined,
          version: health.version || undefined,
          errorCount: errors.length,
          checkedAt: health.checkedAt || undefined,
        },
      });

      if (observed) {
        const transition = {
          type: observed.created ? 'opened' : 'updated',
          serverId,
          fingerprint,
          incident: observed.incident,
        };
        transitions.push(transition);
        if (observed.created) {
          await this.#audit('sentinel.ark.health.degraded', health, transition);
          this.logger?.warn?.('sentinel.ark.health.incident_opened', { serverId, fingerprint, errors: errors.length });
        }
      }
    }

    return transitions;
  }

  async #audit(action, health, transition) {
    if (!this.auditStore?.append) return null;
    return this.auditStore.append({
      actor: 'nexus-sentinel-worker',
      action,
      subject: transition.serverId,
      details: {
        fingerprint: transition.fingerprint,
        serverName: health.serverName || transition.serverId,
        ok: health.ok === true,
        degraded: health.degraded === true,
        version: health.version || null,
        errorCount: Array.isArray(health.errors) ? health.errors.length : 0,
        checkedAt: health.checkedAt || null,
      },
    });
  }
}

module.exports = { ArkHealthObserver, arkHealthFingerprint };
