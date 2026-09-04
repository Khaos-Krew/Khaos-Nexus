'use strict';

const { loadConfig } = require('../shared/config.cjs');
const { monitorIntervalMinutes } = require('./ark-update-monitor.cjs');
const { resolveChannel } = require('./ark-staff-status-monitor-extension.cjs');
const { runArkConfigDriftAlerts } = require('./ark-config-drift-alerts.cjs');
const { registerStartupTask, startupDiagnostics } = require('./startup-coordinator.cjs');

const STARTUP_TASK_ID = 'ark-config-drift-alerts';
const INITIAL_DELAY_MS = 20_000;

function outboundMessage(payload) {
  const message = String(payload?.message || '').replace(/[\r\n]{3,}/g, '\n\n').trim().slice(0, 1800);
  if (!message) return null;
  return Object.freeze({ content: message, allowedMentions: Object.freeze({ parse: Object.freeze([]) }) });
}

async function runCycle(client, config, {
  resolveStaffChannel = resolveChannel,
  runAlerts = runArkConfigDriftAlerts
} = {}) {
  const guildId = String(config?.discord?.guildId || '').trim();
  if (!guildId) return Object.freeze({ skipped: 'guild-not-configured' });
  const guild = await client.guilds.fetch(guildId);
  const channel = await resolveStaffChannel(guild);
  if (!channel || typeof channel.send !== 'function') return Object.freeze({ skipped: 'staff-channel-not-found' });

  const deliveries = await runAlerts({
    notify: async (payload) => {
      const message = outboundMessage(payload);
      if (!message) return;
      await channel.send(message);
    }
  });
  const alerted = deliveries.filter((item) => item.alert).length;
  const sent = deliveries.filter((item) => item.sent).length;
  return Object.freeze({ channelId: String(channel.id || ''), checked: deliveries.length, alerted, sent });
}

function startArkConfigDriftAlerts(client, config, {
  setTimeoutFn = setTimeout,
  setIntervalFn = setInterval,
  intervalMs = Math.max(5 * 60_000, monitorIntervalMinutes() * 60_000)
} = {}) {
  const run = (reason) => void runCycle(client, config)
    .then((result) => console.log(`[Nexus Sentinal] ARK config drift alerts (${reason}): checked=${result.checked || 0} alerted=${result.alerted || 0} sent=${result.sent || 0} skipped=${result.skipped || 'none'}`))
    .catch(() => console.warn(`[Nexus Sentinal] ARK config drift alerts (${reason}) unavailable; no configuration was changed.`));
  const initial = setTimeoutFn(() => run('startup'), INITIAL_DELAY_MS);
  initial?.unref?.();
  const periodic = setIntervalFn(() => run('periodic'), intervalMs);
  periodic?.unref?.();
  console.log(`[Nexus Sentinal] ARK config drift transition alerts scheduled every ${Math.round(intervalMs / 60000)} minute(s).`);
  return { initial, periodic, run, intervalMs };
}

function installArkConfigDriftAlertExtension() {
  if (startupDiagnostics().tasks.some((task) => task.id === STARTUP_TASK_ID)) return { installed: false, coordinated: true };
  const config = loadConfig();
  registerStartupTask({
    id: STARTUP_TASK_ID,
    owner: 'ark-config',
    priority: 165,
    run(client) {
      startArkConfigDriftAlerts(client, config);
    }
  });
  return { installed: true, coordinated: true };
}

module.exports = {
  STARTUP_TASK_ID,
  INITIAL_DELAY_MS,
  outboundMessage,
  runCycle,
  startArkConfigDriftAlerts,
  installArkConfigDriftAlertExtension
};
