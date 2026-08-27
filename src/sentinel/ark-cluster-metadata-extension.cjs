'use strict';

const { Client, Events } = require('discord.js');
const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');
const { syncClusterMetadata } = require('./ark-cluster-metadata.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.cluster.metadata.extension');
const INITIAL_DELAY_MS = 20_000;
const REFRESH_MS = Math.max(120_000, Number(process.env.NEXUS_ARK_METADATA_REFRESH_SECONDS || 300) * 1000 || 300_000);

function installArkClusterMetadataExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const registry = new ArkClusterRegistry();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusArkClusterMetadataLogin(...args) {
    const client = this;
    client.once(Events.ClientReady, () => {
      let running = false;
      const run = async (reason) => {
        if (running) return;
        running = true;
        try {
          const results = await syncClusterMetadata(registry);
          const changed = results.filter((item) => item.changed).length;
          const errors = results.filter((item) => item.error).length;
          console.log(`[Nexus Sentinal] ARK cluster metadata (${reason}): maps=${results.length} changed=${changed} errors=${errors}`);
          if (changed && client.__nexusArkClusterContext?.runRefresh) {
            await client.__nexusArkClusterContext.runRefresh('metadata-sync', false);
          }
        } catch (error) {
          console.warn(`[Nexus Sentinal] ARK cluster metadata (${reason}) unavailable: ${String(error?.message || error).slice(0, 300)}`);
        } finally {
          running = false;
        }
      };

      const initialTimer = setTimeout(() => void run('startup'), INITIAL_DELAY_MS);
      initialTimer.unref?.();
      const periodicTimer = setInterval(() => void run('periodic'), REFRESH_MS);
      periodicTimer.unref?.();
    });
    return originalLogin.apply(this, args);
  };
}

module.exports = { INITIAL_DELAY_MS, REFRESH_MS, installArkClusterMetadataExtension };
