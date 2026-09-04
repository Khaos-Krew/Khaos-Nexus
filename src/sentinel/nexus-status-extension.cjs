'use strict';

const { loadConfig } = require('../shared/config.cjs');
const {
  DEFAULT_REFRESH_MS,
  clampRefreshMs,
  probeHealth,
  aggregateState,
  renderNexusStatusPanel,
  reconcileStatusPanel,
  ensureNexusStatusChannel
} = require('./nexus-status.cjs');
const { registerStartupTask, startupDiagnostics } = require('./startup-coordinator.cjs');

const STARTUP_TASK_ID = 'nexus-status-panel';
const INITIAL_DELAY_MS = 10_000;
const SENTINAL_CLIENT_LISTENER_BUDGET = 20;

function configuredStatus(config = {}) {
  const status = config?.discord?.nexusStatus || {};
  const dndBase = String(config?.modules?.dnd?.provider?.baseUrl || '');
  return {
    loreHealthUrl: String(status.veyraHealthUrl || dndBase || ''),
    gatewayHealthUrl: String(status.veyraGatewayHealthUrl || ''),
    refreshMs: clampRefreshMs(Number(status.refreshSeconds || 0) > 0 ? Number(status.refreshSeconds) * 1000 : DEFAULT_REFRESH_MS)
  };
}

async function buildNexusStatusSnapshot(client, config = {}, options = {}) {
  const statusConfig = configuredStatus(config);
  const probe = options.probeHealth || probeHealth;
  const backendBase = String(config?.backend?.publicBaseUrl || process.env.NEXUS_BACKEND_URL || '');
  const discordReady = Boolean(client?.isReady?.());
  const discord = {
    state: discordReady ? 'online' : 'offline',
    label: discordReady ? 'Connected' : 'Disconnected',
    uptimeSec: discordReady ? Math.floor(Number(client?.uptime || 0) / 1000) : 0
  };
  const [backend, lore, gateway] = await Promise.all([
    probe(backendBase),
    probe(statusConfig.loreHealthUrl),
    probe(statusConfig.gatewayHealthUrl)
  ]);
  const sentinal = { discord, backend, state: aggregateState([discord, backend]) };
  const veyra = { lore, gateway, state: aggregateState([lore, gateway]) };
  return { checkedAt: new Date().toISOString(), sentinal, veyra };
}

async function refreshNexusStatusPanel(client, config = {}, options = {}) {
  const guildId = String(config?.discord?.guildId || '');
  if (!guildId) return { skipped: 'guild-unconfigured' };
  const guild = await client.guilds.fetch(guildId);
  const channelResult = await ensureNexusStatusChannel(guild, config);
  if (!channelResult.channel) return { skipped: 'information-category-missing' };
  const snapshot = await buildNexusStatusSnapshot(client, config, options);
  const panel = await reconcileStatusPanel(channelResult.channel, renderNexusStatusPanel(snapshot), { botId: client.user?.id });
  return {
    ...panel,
    channelId: String(channelResult.channel.id || ''),
    channelCreated: Boolean(channelResult.created),
    channelMoved: Boolean(channelResult.moved),
    sentinal: snapshot.sentinal.state,
    veyra: snapshot.veyra.state
  };
}

function ensureSentinalListenerBudget(client) {
  if (!client?.getMaxListeners || !client?.setMaxListeners) return 0;
  const current = Number(client.getMaxListeners() || 0);
  if (current < SENTINAL_CLIENT_LISTENER_BUDGET) client.setMaxListeners(SENTINAL_CLIENT_LISTENER_BUDGET);
  return Number(client.getMaxListeners() || SENTINAL_CLIENT_LISTENER_BUDGET);
}

function startNexusStatusMonitor(client, config, { setTimeoutFn = setTimeout, setIntervalFn = setInterval } = {}) {
  const statusConfig = configuredStatus(config);
  let running = false;
  const run = async (reason) => {
    if (running) return;
    running = true;
    try {
      const result = await refreshNexusStatusPanel(client, config);
      if (result.skipped) {
        console.warn(`[Nexus Sentinal] nexus status panel (${reason}) skipped: ${result.skipped}`);
        return;
      }
      console.log(`[Nexus Sentinal] nexus status panel (${reason}): channel=${result.channelId} channelCreated=${result.channelCreated} channelMoved=${result.channelMoved} panelCreated=${result.created} duplicatesRemoved=${result.duplicatesRemoved} pinned=${result.pinned} sentinal=${result.sentinal} veyra=${result.veyra}`);
    } catch (error) {
      console.warn(`[Nexus Sentinal] nexus status panel (${reason}) unavailable: ${String(error?.message || error).slice(0, 240)}`);
    } finally {
      running = false;
    }
  };
  const initialTimer = setTimeoutFn(() => void run('startup'), INITIAL_DELAY_MS);
  initialTimer?.unref?.();
  const periodicTimer = setIntervalFn(() => void run('periodic'), statusConfig.refreshMs);
  periodicTimer?.unref?.();
  return { initialTimer, periodicTimer, run };
}

function installNexusStatusExtension() {
  if (startupDiagnostics().tasks.some((task) => task.id === STARTUP_TASK_ID)) return { installed: false, coordinated: true };
  const config = loadConfig();
  registerStartupTask({
    id: STARTUP_TASK_ID,
    owner: 'nexus-status',
    priority: 135,
    run(client) {
      startNexusStatusMonitor(client, config);
    }
  });
  return { installed: true, coordinated: true };
}

module.exports = {
  STARTUP_TASK_ID,
  INITIAL_DELAY_MS,
  SENTINAL_CLIENT_LISTENER_BUDGET,
  configuredStatus,
  buildNexusStatusSnapshot,
  refreshNexusStatusPanel,
  ensureSentinalListenerBudget,
  startNexusStatusMonitor,
  installNexusStatusExtension
};
