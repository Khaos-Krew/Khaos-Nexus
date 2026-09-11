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

      const observed = Date.parse(runtime.lastCheckedAt);
      if (!Number.isFinite(observed) || observed < Date.now() - 180_000 || observed > Date.now() + 30_000 || Number(runtime.playerCount || 0) !== (runtime.players || []).length || (runtime.players || []).some(player => !player?.eosId)) {
        results.push({ serverId, skipped: 'snapshot-incomplete-or-stale' });
        continue;
      }
      try {
        const response = await this.client.presenceSnapshot({ server: serverId, eosIds: runtime.players.map(player => cleanEos(player.eosId)), observedAt: runtime.lastCheckedAt });
        results.push({ serverId, failures: response.ok ? 0 : 1, players: runtime.players.length });
      } catch (error) {
        results.push({ serverId, failures: 1 });
        this.logger.warn?.(`[Nexus Economy] presence snapshot failed server=${serverId}: ${String(error?.message || error).slice(0, 180)}`);
      }
    }
    return { ok: true, results };
  }
}

module.exports = { cleanEos, ArkEconomyPresenceBridge };
