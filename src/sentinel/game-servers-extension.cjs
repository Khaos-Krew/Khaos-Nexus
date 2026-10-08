'use strict';

const { Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { BackendClient } = require('./backend-client.cjs');
const {
  ensureGameServersChannel,
  renderGameServersPanel,
  reconcileGameServersPanel,
  groupTrackedServers,
  groupPrivateServersByRank
} = require('./game-servers-panel.cjs');
const { collectLivePublicServers, mergePanelServers } = require('./game-servers-live.cjs');
const { ServerAlertMonitor, alertsEnabled, runServerAlerts } = require('./server-down-alerts.cjs');

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

  // Same live inventory + status as the public server list (#717).
  const collect = options.collectLive || collectLivePublicServers;
  let liveRows = [];
  let liveError = '';
  try { liveRows = await collect({ env: options.env || process.env, config }); }
  catch (error) { liveError = String(error?.message || error).slice(0, 200); }

  let alerts = null;
  if (!liveError && options.alertMonitor) {
    try { alerts = await runServerAlerts(client, liveRows, { env: options.env || process.env, config, guild, monitor: options.alertMonitor }); }
    catch (error) { alerts = { error: String(error?.message || error).slice(0, 200) }; }
  }

  const registry = await backend.trackedServers();
  if (registry?.ok === false || Number(registry?.status || 200) >= 400) {
    throw new Error(registry?.message || `Tracked-server registry returned HTTP ${registry?.status || 'error'}.`);
  }

  const registryServers = registry.servers || [];
  const publicServers = mergePanelServers(liveRows, registryServers);
  const privateServers = registry.privateServers || [];
  const payload = renderGameServersPanel({ servers: publicServers, privateServers });
  const panel = await reconcileGameServersPanel(channelResult.channel, payload, { botId: client.user?.id });
  return {
    ...panel,
    live: liveRows.length,
    liveError,
    alerts,
    channelId: String(channelResult.channel.id || ''),
    channelCreated: Boolean(channelResult.created),
    channelMoved: Boolean(channelResult.moved),
    tracked: Array.isArray(publicServers) ? publicServers.length : 0,
    privateTracked: Array.isArray(privateServers) ? privateServers.length : 0,
    groups: groupTrackedServers(publicServers).length,
    privateRankGroups: groupPrivateServersByRank(privateServers).length
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
      let alertMonitor = null;
      try { alertMonitor = new ServerAlertMonitor(); }
      catch (error) { console.warn(`[Nexus Sentinal] server alerts unavailable: ${String(error?.message || error).slice(0, 200)}`); }
      const run = async (reason) => {
        if (running) return;
        running = true;
        try {
          const result = await refreshGameServersPanel(this, config, { alertMonitor: alertsEnabled(process.env) ? alertMonitor : null });
          if (result.skipped) {
            console.warn(`[Nexus Sentinal] game servers registry (${reason}) skipped: ${result.skipped}`);
            return;
          }
          console.log(`[Nexus Sentinal] game servers registry (${reason}): channel=${result.channelId} channelCreated=${result.channelCreated} channelMoved=${result.channelMoved} panelCreated=${result.created} panelUpdated=${result.updated} public=${result.tracked} private=${result.privateTracked} gameGroups=${result.groups} rankGroups=${result.privateRankGroups} duplicatesRemoved=${result.duplicatesRemoved} pinned=${result.pinned} live=${result.live}${result.liveError ? ` liveError=${result.liveError}` : ''}`);
          if (result.alerts?.events?.length) console.log(`[Nexus Sentinal] server alerts (${reason}): ${result.alerts.events.map((event) => `${event.type}:${event.name}`).join(', ').slice(0, 300)} dms=${result.alerts.delivery?.dms || 0} channel=${result.alerts.delivery?.channel ? 'yes' : 'no'}${result.alerts.delivery?.failures?.length ? ` failures=${result.alerts.delivery.failures.join('; ').slice(0, 200)}` : ''}`);
          else if (result.alerts?.error) console.warn(`[Nexus Sentinal] server alerts (${reason}) failed: ${result.alerts.error}`);
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
