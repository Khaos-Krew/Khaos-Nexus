'use strict';

const { Client, Events } = require('discord.js');
const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');
const { syncClusterMetadata } = require('./ark-cluster-metadata.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.cluster.metadata.extension');
const BOUND = Symbol.for('khaos.nexus.ark.cluster.metadata.bound');
const INITIAL_DELAY_MS = 20_000;
const REFRESH_MS = Math.max(120_000, Number(process.env.NEXUS_ARK_METADATA_REFRESH_SECONDS || 300) * 1000 || 300_000);

function installArkClusterMetadataExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const registry = new ArkClusterRegistry();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusArkClusterMetadataLogin(...args) {
    const client = this;
    let running = false;
    const run = async (reason, forcePanelRefresh = false) => {
      if (running) return;
      running = true;
      try {
        const results = await syncClusterMetadata(registry);
        const changed = results.filter((item) => item.changed).length;
        const errors = results.filter((item) => item.error).length;
        const installedMods = results.reduce((sum, item) => sum + (Number(item.installedMods) || 0), 0);
        const inventories = results.filter((item) => item.inventoryAccessible).length;
        console.log(`[Nexus Sentinal] ARK cluster metadata (${reason}): maps=${results.length} changed=${changed} errors=${errors} diskInventories=${inventories} installedMods=${installedMods}`);
        if ((changed || forcePanelRefresh) && client.__nexusArkClusterContext?.runRefresh) {
          await client.__nexusArkClusterContext.runRefresh(`metadata-${reason}`, false);
        }
      } catch (error) {
        console.warn(`[Nexus Sentinal] ARK cluster metadata (${reason}) unavailable: ${String(error?.message || error).slice(0, 300)}`);
      } finally {
        running = false;
      }
    };

    if (!client[BOUND]) {
      client[BOUND] = true;
      client.on(Events.InteractionCreate, (interaction) => {
        if (!interaction.isChatInputCommand?.()) return;
        let sub = '';
        try { sub = interaction.options.getSubcommand(); } catch { return; }

        if (interaction.commandName === 'arkconfig') {
          if (!['set-ini', 'set-shop', 'sync-mysql'].includes(sub)) return;
          if (interaction.options.getBoolean('dry_run') === true) return;
          const timer = setTimeout(() => void run(`config-${sub}`, true), 3_000);
          timer.unref?.();
          return;
        }

        if (interaction.commandName === 'arkprofile') {
          if (!['apply', 'rollback'].includes(sub)) return;
          if (interaction.options.getBoolean('confirm') !== true) return;
          const timer = setTimeout(() => void run(`profile-${sub}`, true), 7_000);
          timer.unref?.();
        }
      });
    }

    client.once(Events.ClientReady, () => {
      const initialTimer = setTimeout(() => void run('startup'), INITIAL_DELAY_MS);
      initialTimer.unref?.();
      const periodicTimer = setInterval(() => void run('periodic'), REFRESH_MS);
      periodicTimer.unref?.();
    });
    return originalLogin.apply(this, args);
  };
}

module.exports = { INITIAL_DELAY_MS, REFRESH_MS, installArkClusterMetadataExtension };
