'use strict';

const { Client, Events } = require('discord.js');
const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');
const { syncClusterMetadata } = require('./ark-cluster-metadata.cjs');
const { registerStartupTask, startupDiagnostics } = require('./startup-coordinator.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.cluster.metadata.extension');
const BOUND = Symbol.for('khaos.nexus.ark.cluster.metadata.bound');
const STARTUP_TASK_ID = 'ark-cluster-metadata';
const INITIAL_DELAY_MS = 20_000;
const REFRESH_MS = Math.max(120_000, Number(process.env.NEXUS_ARK_METADATA_REFRESH_SECONDS || 300) * 1000 || 300_000);

function createMetadataRunner(registry) {
  let running = false;
  return async function runMetadata(client, reason, forcePanelRefresh = false) {
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
}

function startArkClusterMetadataMonitor(client, runMetadata, { setTimeoutFn = setTimeout, setIntervalFn = setInterval } = {}) {
  const initialTimer = setTimeoutFn(() => void runMetadata(client, 'startup'), INITIAL_DELAY_MS);
  initialTimer?.unref?.();
  const periodicTimer = setIntervalFn(() => void runMetadata(client, 'periodic'), REFRESH_MS);
  periodicTimer?.unref?.();
  return { initialTimer, periodicTimer };
}

function bindMetadataInteractions(client, runMetadata) {
  if (client[BOUND]) return false;
  client[BOUND] = true;
  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand?.()) return;
    let sub = '';
    try { sub = interaction.options.getSubcommand(); } catch { return; }

    if (interaction.commandName === 'arkconfig') {
      if (!['set-ini', 'set-shop', 'sync-mysql'].includes(sub)) return;
      if (interaction.options.getBoolean('dry_run') === true) return;
      const timer = setTimeout(() => void runMetadata(client, `config-${sub}`, true), 3_000);
      timer.unref?.();
      return;
    }

    if (interaction.commandName === 'arkprofile') {
      if (!['apply', 'rollback'].includes(sub)) return;
      if (interaction.options.getBoolean('confirm') !== true) return;
      const timer = setTimeout(() => void runMetadata(client, `profile-${sub}`, true), 7_000);
      timer.unref?.();
    }
  });
  return true;
}

function installArkClusterMetadataExtension() {
  if (Client.prototype[INSTALLED]) return { installed: false };
  Client.prototype[INSTALLED] = true;
  const registry = new ArkClusterRegistry();
  const runMetadata = createMetadataRunner(registry);
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusArkClusterMetadataLogin(...args) {
    bindMetadataInteractions(this, runMetadata);
    return originalLogin.apply(this, args);
  };

  if (!startupDiagnostics().tasks.some((task) => task.id === STARTUP_TASK_ID)) {
    registerStartupTask({
      id: STARTUP_TASK_ID,
      owner: 'ark-metadata',
      priority: 175,
      run(client) {
        startArkClusterMetadataMonitor(client, runMetadata);
      }
    });
  }
  return { installed: true, coordinated: true };
}

module.exports = {
  STARTUP_TASK_ID,
  INITIAL_DELAY_MS,
  REFRESH_MS,
  createMetadataRunner,
  startArkClusterMetadataMonitor,
  bindMetadataInteractions,
  installArkClusterMetadataExtension
};
