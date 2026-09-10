'use strict';

const { Client, Events } = require('discord.js');
const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');
const { ArkEconomyPresenceBridge } = require('./ark-economy-presence-bridge.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.economy.presence.installed');
const INITIAL_DELAY_MS = 20_000;
const SYNC_MS = Math.max(30_000, Number(process.env.NEXUS_ECONOMY_PRESENCE_SECONDS || 60) * 1000 || 60_000);

function installArkEconomyPresenceExtension() {
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
          const servers = registry.list({ includeDisabled: false });
          const result = await bridge.syncServers(servers);
          const failures = (result.results || []).reduce((sum, item) => sum + Number(item.failures || 0), 0);
          console.log(`[Nexus Economy] ARK presence ${reason}: maps=${servers.length} failures=${failures}`);
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

module.exports = { INITIAL_DELAY_MS, SYNC_MS, installArkEconomyPresenceExtension };
