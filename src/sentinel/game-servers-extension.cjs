'use strict';

const { Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { BackendClient } = require('./backend-client.cjs');
const {
  ensureGameServersChannel,
  renderGameServersPanel,
  reconcileGameServersPanel,
  groupTrackedServers
} = require('./game-servers-panel.cjs');

const INSTALLED = Symbol.for('khaos.nexus.gameServers.extension');
const INITIAL_DELAY_MS = 15_000;
const REFRESH_MS = 60_000;

async function refreshGameServersPanel(client, config = {}, options = {}) {
  const guildId = String(config?.discord?.guildId || '');
  if (!guildId) return { skipped: 'guild-unconfigured' };
  const backend = options.backend || new BackendClient(config);
  const guild = await client.guilds.fetch(guildId);
  const channelResult = await ensureGameServersChannel(guild);
  if (!channelResult.channel) return { skipped: 'information-category-missing' };

  const registry = await backend.trackedServers();
  if (registry?.ok === false || Number(registry?.status || 200) >= 400) {
    throw new Error(registry?.message || `Tracked-server registry returned HTTP ${registry?.status || 'error'}.`);
  }

  const payload = renderGameServersPanel({
    generatedAt: registry.generatedAt || new Date().toISOString(),
    servers: registry.servers || []
  });
  const panel = await reconcileGameServersPanel(channelResult.channel, payload, { botId: client.user?.id });
  return {
    ...panel,
    channelId: String(channelResult.channel.id || ''),
    channelCreated: Boolean(channelResult.created),
    channelMoved: Boolean(channelResult.moved),
    tracked: Array.isArray(registry.servers) ? registry.servers.length : 0,
    groups: groupTrackedServers(registry.servers || []).length
  };
}

function installGameServersExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusGameServersLogin(...args) {
    this.once(Events.ClientReady, () => {
      let running = false;
      const run = async (reason) => {
        if (running) return;
        running = true;
        try {
          const result = await refreshGameServersPanel(this, config);
          if (result.skipped) {
            console.warn(`[Nexus Sentinal] game servers registry (${reason}) skipped: ${result.skipped}`);
            return;
          }
          console.log(`[Nexus Sentinal] game servers registry (${reason}): channel=${result.channelId} channelCreated=${result.channelCreated} channelMoved=${result.channelMoved} panelCreated=${result.created} tracked=${result.tracked} groups=${result.groups} duplicatesRemoved=${result.duplicatesRemoved} pinned=${result.pinned}`);
        } catch (error) {
          console.warn(`[Nexus Sentinal] game servers registry (${reason}) unavailable: ${String(error?.message || error).slice(0, 240)}`);
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

module.exports = {
  INITIAL_DELAY_MS,
  REFRESH_MS,
  refreshGameServersPanel,
  installGameServersExtension
};
