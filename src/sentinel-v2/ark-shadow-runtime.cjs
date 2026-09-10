'use strict';

const { randomUUID } = require('node:crypto');
const { loadLiveArkPublicInfo } = require('../sentinel/ark-public-server-info.cjs');

class ArkLegacyPublicInfoReader {
  constructor({ loader = loadLiveArkPublicInfo, logger } = {}) {
    this.loader = loader;
    this.logger = logger;
  }

  async inspectMany(servers = []) {
    const snapshots = [];
    for (const server of (Array.isArray(servers) ? servers : []).filter((item) => item?.enabled !== false)) {
      try {
        snapshots.push(await this.loader(server));
      } catch (error) {
        const serverId = String(server?.id || server?.envPrefix || '');
        const serverName = String(server?.mapName || server?.name || serverId || 'ARK Server');
        const message = String(error?.message || error);
        this.logger?.warn?.('sentinel.ark.shadow.legacy_read_failed', { serverId, error: message });
        snapshots.push({
          serverId,
          serverName,
          envPrefix: String(server?.envPrefix || ''),
          errors: [message],
          modIds: [],
          inventoryAvailable: false,
          checkedAt: new Date().toISOString(),
        });
      }
    }
    return snapshots;
  }
}

class ArkShadowRuntime {
  constructor({ scheduler, registry, v2Adapter, legacyReader, comparison, logger } = {}) {
    if (!scheduler?.register) throw new TypeError('scheduler is required');
    if (!registry?.list) throw new TypeError('ARK registry is required');
    if (!v2Adapter?.inspectMany) throw new TypeError('ARK v2 health adapter is required');
    if (!comparison?.compare || !comparison?.hydrate) throw new TypeError('ARK shadow comparison is required');
    this.scheduler = scheduler;
    this.registry = registry;
    this.v2Adapter = v2Adapter;
    this.legacyReader = legacyReader || new ArkLegacyPublicInfoReader({ logger });
    this.comparison = comparison;
    this.logger = logger;
    this.registered = false;
  }

  async hydrate({ since, limit = 500 } = {}) {
    const acceptance = await this.comparison.hydrate({ since, limit });
    this.logger?.info?.('sentinel.ark.shadow.runtime_hydrated', {
      samples: acceptance?.samples || 0,
      retirementEligible: acceptance?.eligible === true,
      retirementReasons: acceptance?.reasons || [],
    });
    return acceptance;
  }

  register({ intervalMs = 300000, jitterMs = 30000 } = {}) {
    if (this.registered) return false;
    this.scheduler.register({
      name: 'ark.health.shadow_compare',
      owner: 'ark',
      trigger: { type: 'interval', intervalMs, jitterMs },
      timeoutMs: 180000,
      retry: { attempts: 2, baseDelayMs: 3000, maxDelayMs: 15000, factor: 2, jitterMs: 1000 },
      run: async () => this.runOnce(),
    });
    this.registered = true;
    return true;
  }

  async start({ since, limit = 500, intervalMs = 300000, jitterMs = 30000 } = {}) {
    const acceptance = await this.hydrate({ since, limit });
    this.register({ intervalMs, jitterMs });
    return acceptance;
  }

  async runOnce({ correlationId = randomUUID() } = {}) {
    const servers = this.registry.list({ includeDisabled: false });
    if (!servers.length) {
      this.logger?.info?.('sentinel.ark.shadow.skipped', { reason: 'no-servers' });
      return { skipped: true, reason: 'no-servers' };
    }

    const [v2Results, legacySnapshots] = await Promise.all([
      this.v2Adapter.inspectMany(servers),
      this.legacyReader.inspectMany(servers),
    ]);
    const result = await this.comparison.compare({ v2Results, legacySnapshots, correlationId });
    return {
      skipped: false,
      correlationId,
      equivalent: result.report.equivalent,
      servers: result.report.servers,
      drifted: result.report.drifted,
      evidencePersisted: result.evidence.persisted === true,
      retirementEligible: result.acceptance?.eligible === true,
      retirementReasons: result.acceptance?.reasons || [],
    };
  }
}

module.exports = { ArkLegacyPublicInfoReader, ArkShadowRuntime };
