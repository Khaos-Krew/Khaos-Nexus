'use strict';

const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');
const { pollCluster } = require('./ark-cluster-monitor.cjs');
const { ArkEconomyPresenceBridge } = require('./ark-economy-presence-bridge.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.economy.presence.installed');
const INITIAL_DELAY_MS = 20_000;
const SYNC_MS = Math.max(30_000, Number(process.env.NEXUS_ECONOMY_PRESENCE_SECONDS || 60) * 1000 || 60_000);

async function runPresenceCycle({ registry, bridge, poll = pollCluster } = {}) {
  if (!registry || typeof bridge?.syncServers !== 'function') throw new Error('Presence cycle requires a registry and bridge.');
  const snapshot = await poll(registry);
  const servers = Array.isArray(snapshot?.servers) ? snapshot.servers : registry.list({ includeDisabled: true });
  const result = await bridge.syncServers(servers);
  const maps = servers.filter((server) => server && server.enabled !== false).length;
  const results = result?.results || [];
  return {
    ...result,
    maps,
    skips: results.filter((item) => item?.skipped).length,
    failures: results.reduce((sum, item) => sum + Number(item?.failures || 0), 0)
  };
}

function installArkEconomyPresenceExtension() {
  const { Client, Events } = require('discord.js');
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusArkEconomyPresenceLogin(...args) {
    const client = this;
    client.once(Events.ClientReady, () => {
      const bridge = new ArkEconomyPresenceBridge();
      if (!bridge.enabled()) {
        console.log('[Nexus Economy] ARK presence bridge disabled: economy worker is not configured.');
        return;
      }
      const registry = new ArkClusterRegistry();
      let running = false;
      const run = async (reason) => {
        if (running) return;
        running = true;
        try {
          const result = await runPresenceCycle({ registry, bridge });
          console.log(`[Nexus Economy] ARK presence ${reason}: maps=${result.maps} skips=${result.skips} failures=${result.failures}`);
        } catch (error) {
          console.warn(`[Nexus Economy] ARK presence ${reason} unavailable: ${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 240)}`);
        } finally {
          running = false;
        }
      };
      const initial = setTimeout(() => void run('startup'), INITIAL_DELAY_MS);
      initial.unref?.();
      const periodic = setInterval(() => void run('periodic'), SYNC_MS);
      periodic.unref?.();
    });
    return originalLogin.apply(this, args);
  };
}

module.exports = { INITIAL_DELAY_MS, SYNC_MS, runPresenceCycle, installArkEconomyPresenceExtension };
