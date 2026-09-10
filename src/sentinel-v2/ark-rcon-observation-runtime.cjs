'use strict';

const {
  OBSERVED_ACTION,
  DEGRADED_ACTION,
  EVIDENCE_SUBJECT,
} = require('./ark-rcon-observation-evidence.cjs');
const { mapRconObservationAuditHistory } = require('./ark-rcon-observation-window.cjs');
const { registerArkRconPlayersJob } = require('./ark-rcon-read-adapter.cjs');

class ArkRconObservationRuntime {
  constructor({ scheduler, adapter, registry, evidence, window, auditStore, logger } = {}) {
    if (!scheduler?.register) throw new TypeError('scheduler is required');
    if (!adapter?.listPlayers) throw new TypeError('read-only ARK RCON adapter is required');
    if (!registry?.list) throw new TypeError('ARK registry is required');
    if (!evidence?.record) throw new TypeError('RCON observation evidence recorder is required');
    if (!window?.hydrate || !window?.add) throw new TypeError('RCON observation window is required');
    this.scheduler = scheduler;
    this.adapter = adapter;
    this.registry = registry;
    this.evidence = evidence;
    this.window = window;
    this.auditStore = auditStore;
    this.logger = logger;
    this.registered = false;
  }

  async hydrate({ since, limit = 500 } = {}) {
    const records = this.auditStore?.list
      ? await this.auditStore.list({
        actions: [OBSERVED_ACTION, DEGRADED_ACTION],
        subject: EVIDENCE_SUBJECT,
        since,
        limit,
      })
      : [];
    const acceptance = this.window.hydrate(mapRconObservationAuditHistory(records));
    this.logger?.info?.('sentinel.ark.rcon.shadow.runtime_hydrated', {
      samples: acceptance.samples,
      degradedSamples: acceptance.degradedSamples,
      acceptanceEligible: acceptance.eligible === true,
      acceptanceReasons: acceptance.reasons,
    });
    return acceptance;
  }

  register({ intervalMs = 300000, jitterMs = 30000 } = {}) {
    if (this.registered) return false;
    registerArkRconPlayersJob(this.scheduler, {
      adapter: this.adapter,
      servers: () => this.registry.list({ includeDisabled: false }),
      intervalMs,
      jitterMs,
      onResult: async (summary, outcomes, { correlationId } = {}) => {
        if (Number(summary?.servers || 0) === 0) {
          this.logger?.info?.('sentinel.ark.rcon.shadow.skipped', { reason: 'no-rcon-servers' });
          return;
        }
        const observation = await this.evidence.record(summary, outcomes, { correlationId });
        const acceptance = this.window.add(observation);
        this.logger?.info?.('sentinel.ark.rcon.shadow.acceptance', {
          samples: acceptance.samples,
          degradedSamples: acceptance.degradedSamples,
          acceptanceEligible: acceptance.eligible === true,
          acceptanceReasons: acceptance.reasons,
        });
      },
    });
    this.registered = true;
    return true;
  }

  async start({ since, limit = 500, intervalMs = 300000, jitterMs = 30000 } = {}) {
    const acceptance = await this.hydrate({ since, limit });
    this.register({ intervalMs, jitterMs });
    return acceptance;
  }
}

module.exports = { ArkRconObservationRuntime };
