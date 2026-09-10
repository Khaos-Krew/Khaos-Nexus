'use strict';

const { NexusEconomyClient } = require('./nexus-economy-client.cjs');

function cleanEos(value) {
  return String(value || '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128);
}

class ArkEconomyPresenceBridge {
  constructor({ client, logger = console } = {}) {
    this.client = client || new NexusEconomyClient();
    this.logger = logger;
    this.previousByServer = new Map();
  }

  enabled() {
    return this.client.configured();
  }

  async syncServers(servers = []) {
    if (!this.enabled()) return { skipped: 'economy-worker-unconfigured' };
    const results = [];
    for (const server of servers || []) {
      if (!server || server.enabled === false) continue;
      const serverId = String(server.id || server.envPrefix || 'ark').trim().toLowerCase();
      const runtime = server.runtime || {};

      // A failed/unreachable poll must never be interpreted as players logging out.
      // Only a successful online server snapshot is authoritative for presence.
      if (runtime.state !== 'online' || runtime.lastError) {
        results.push({ serverId, skipped: 'runtime-not-authoritative' });
        continue;
      }

      const current = new Set((runtime.players || []).map((player) => cleanEos(player?.eosId)).filter(Boolean));
      const previous = this.previousByServer.get(serverId) || new Set();
      let onlineUpdates = 0;
      let offlineUpdates = 0;
      let failures = 0;

      for (const eosId of current) {
        try {
          const response = await this.client.presence({ eosId, online: true, server: serverId });
          if (response?.ok !== false || response?.reason === 'unlinked-player') onlineUpdates += 1;
        } catch (error) {
          failures += 1;
          this.logger.warn?.(`[Nexus Economy] presence online failed server=${serverId}: ${String(error?.message || error).slice(0, 180)}`);
        }
      }

      for (const eosId of previous) {
        if (current.has(eosId)) continue;
        try {
          const response = await this.client.presence({ eosId, online: false, server: serverId });
          if (response?.ok !== false || response?.reason === 'unlinked-player') offlineUpdates += 1;
        } catch (error) {
          failures += 1;
          this.logger.warn?.(`[Nexus Economy] presence offline failed server=${serverId}: ${String(error?.message || error).slice(0, 180)}`);
        }
      }

      // Advance the authoritative snapshot only if all worker writes completed.
      // On a worker outage this causes the next healthy cycle to retry transitions.
      if (!failures) this.previousByServer.set(serverId, current);
      results.push({ serverId, onlineUpdates, offlineUpdates, failures, players: current.size });
    }
    return { ok: true, results };
  }
}

module.exports = { cleanEos, ArkEconomyPresenceBridge };
