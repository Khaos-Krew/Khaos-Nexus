'use strict';

const { loadConfig } = require('../shared/config.cjs');
const { BackendClient } = require('./backend-client.cjs');
const {
  ensureGameServersChannel,
  renderGameServersPanel,
  reconcileGameServersPanel,
  groupTrackedServers,
  groupPrivateServersByRank
} = require('./game-servers-panel.cjs');
const { registerStartupTask, startupDiagnostics } = require('./startup-coordinator.cjs');

const STARTUP_TASK_ID = 'game-servers-panel';
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

  const publicServers = registry.servers || [];
  const privateServers = registry.privateServers || [];
  const payload = renderGameServersPanel({ servers: publicServers, privateServers });
  const panel = await reconcileGameServersPanel(channelResult.channel, payload, { botId: client.user?.id });
  return {
    ...panel,
    channelId: String(channelResult.channel.id || ''),
    channelCreated: Boolean(channelResult.created),
    channelMoved: Boolean(channelResult.moved),
    tracked: Array.isArray(publicServers) ? publicServers.length : 0,
    privateTracked: Array.isArray(privateServers) ? privateServers.length : 0,
    groups: groupTrackedServers(publicServers).length,
    privateRankGroups: groupPrivateServersByRank(privateServers).length
  };
}

function startGameServersMonitor(client, config, { setTimeoutFn = setTimeout, setIntervalFn = setInterval } = {}) {
  let running = false;
  const run = async (reason) => {
    if (running) return;
    running = true;
    try {
      const result = await refreshGameServersPanel(client, config);
      if (result.skipped) {
        console.warn(`[Nexus Sentinal] game servers registry (${reason}) skipped: ${result.skipped}`);
        return;
      }
      console.log(`[Nexus Sentinal] game servers registry (${reason}): channel=${result.channelId} channelCreated=${result.channelCreated} channelMoved=${result.channelMoved} panelCreated=${result.created} panelUpdated=${result.updated} public=${result.tracked} private=${result.privateTracked} gameGroups=${result.groups} rankGroups=${result.privateRankGroups} duplicatesRemoved=${result.duplicatesRemoved} pinned=${result.pinned}`);
    } catch (error) {
      console.warn(`[Nexus Sentinal] game servers registry (${reason}) unavailable: ${String(error?.message || error).slice(0, 240)}`);
    } finally {
      running = false;
    }
  };
  const initialTimer = setTimeoutFn(() => void run('startup'), INITIAL_DELAY_MS);
  initialTimer?.unref?.();
  const periodicTimer = setIntervalFn(() => void run('periodic'), REFRESH_MS);
  periodicTimer?.unref?.();
  return { initialTimer, periodicTimer, run };
}

function installGameServersExtension() {
  if (startupDiagnostics().tasks.some((task) => task.id === STARTUP_TASK_ID)) return { installed: false, coordinated: true };
  const config = loadConfig();
  registerStartupTask({
    id: STARTUP_TASK_ID,
    owner: 'game-servers',
    priority: 140,
    run(client) {
      startGameServersMonitor(client, config);
    }
  });
  return { installed: true, coordinated: true };
}

module.exports = {
  STARTUP_TASK_ID,
  INITIAL_DELAY_MS,
  REFRESH_MS,
  refreshGameServersPanel,
  startGameServersMonitor,
  installGameServersExtension
};
