'use strict';

const { loadLiveArkPublicInfo } = require('../sentinel/ark-public-server-info.cjs');

function normalizeServer(server = {}) {
  return {
    id: String(server.id || server.envPrefix || '').trim(),
    name: String(server.mapName || server.name || server.id || server.envPrefix || 'ARK Server').trim(),
    envPrefix: String(server.envPrefix || 'ARK_GEN1').trim(),
    enabled: server.enabled !== false,
    detectedMods: Array.isArray(server.detectedMods) ? server.detectedMods : [],
    installedMods: Array.isArray(server.installedMods) ? server.installedMods : [],
  };
}

function summarizeArkHealth(snapshot = {}) {
  const errors = Array.isArray(snapshot.errors) ? snapshot.errors.filter(Boolean).map(String) : [];
  return {
    serverId: String(snapshot.serverId || ''),
    serverName: String(snapshot.serverName || snapshot.serverId || 'ARK Server'),
    envPrefix: String(snapshot.envPrefix || ''),
    ok: errors.length === 0,
    degraded: errors.length > 0,
    version: snapshot.version || undefined,
    modCount: Array.isArray(snapshot.modIds) ? snapshot.modIds.length : 0,
    inventoryAvailable: snapshot.inventoryAvailable === true,
    errors,
    checkedAt: snapshot.checkedAt || new Date().toISOString(),
  };
}

class ArkHealthAdapter {
  constructor({ loader = loadLiveArkPublicInfo, logger } = {}) {
    this.loader = loader;
    this.logger = logger;
  }

  async inspect(server, dependencies = {}) {
    const normalized = normalizeServer(server);
    if (!normalized.id) throw new TypeError('ARK server id or envPrefix is required');
    const snapshot = await this.loader({ ...server, ...normalized }, dependencies);
    const health = summarizeArkHealth(snapshot);
    this.logger?.info?.('sentinel.ark.health.observed', {
      serverId: health.serverId,
      serverName: health.serverName,
      ok: health.ok,
      degraded: health.degraded,
      modCount: health.modCount,
      errorCount: health.errors.length,
    });
    return { snapshot, health };
  }

  async inspectMany(servers = [], dependencies = {}) {
    const results = [];
    for (const server of (Array.isArray(servers) ? servers : []).filter((item) => item?.enabled !== false)) {
      try {
        results.push(await this.inspect(server, dependencies));
      } catch (error) {
        const normalized = normalizeServer(server);
        const health = {
          serverId: normalized.id,
          serverName: normalized.name,
          envPrefix: normalized.envPrefix,
          ok: false,
          degraded: true,
          modCount: 0,
          inventoryAvailable: false,
          errors: [String(error?.message || error)],
          checkedAt: new Date().toISOString(),
        };
        this.logger?.warn?.('sentinel.ark.health.failed', { serverId: health.serverId, error: health.errors[0] });
        results.push({ snapshot: null, health });
      }
    }
    return results;
  }
}

function registerArkHealthJob(scheduler, { adapter, servers, intervalMs = 300000, jitterMs = 30000, onResult } = {}) {
  if (!scheduler?.register) throw new TypeError('scheduler is required');
  const healthAdapter = adapter || new ArkHealthAdapter();
  const getServers = typeof servers === 'function' ? servers : () => (Array.isArray(servers) ? servers : []);
  scheduler.register({
    name: 'ark.health.read',
    owner: 'ark',
    trigger: { type: 'interval', intervalMs, jitterMs },
    timeoutMs: 120000,
    retry: { attempts: 3, baseDelayMs: 2000, maxDelayMs: 15000, factor: 2, jitterMs: 1000 },
    run: async () => {
      const results = await healthAdapter.inspectMany(getServers());
      const summary = {
        servers: results.length,
        healthy: results.filter((item) => item.health.ok).length,
        degraded: results.filter((item) => item.health.degraded).length,
        health: results.map((item) => item.health),
      };
      await onResult?.(summary, results);
      return summary;
    },
  });
}

module.exports = { ArkHealthAdapter, normalizeServer, summarizeArkHealth, registerArkHealthJob };
