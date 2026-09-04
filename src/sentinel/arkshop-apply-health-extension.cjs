'use strict';

const { loadConfig } = require('../shared/config.cjs');
const { resolveChannel } = require('./ark-staff-status-monitor-extension.cjs');
const { inspectArkShopApplyHealth } = require('./arkshop-apply-health-monitor.cjs');
const { registerStartupTask, startupDiagnostics } = require('./startup-coordinator.cjs');

const STARTUP_TASK_ID = 'arkshop-apply-health';
const INITIAL_DELAY_MS = 20_000;
const INTERVAL_MS = 5 * 60_000;

function discordPayload(alert) {
  if (!alert) return null;
  const fields = [];
  if (alert.state === 'healthy' && alert.counts) {
    fields.push({
      name: 'ArkShop Apply Journal',
      value: `Transactions retained: **${alert.counts.transactionCount}** • Store version: **${alert.counts.version}**`,
      inline: false
    });
  } else if (alert.code) {
    fields.push({ name: 'Fail-closed code', value: `\`${String(alert.code).slice(0, 80)}\``, inline: false });
  }
  return {
    embeds: [{
      title: alert.title,
      description: alert.description,
      fields,
      footer: { text: 'Nexus Sentinal • ArkShop Apply Journal Health • read-only monitoring' },
      timestamp: new Date().toISOString()
    }],
    allowedMentions: { parse: [] }
  };
}

async function runArkShopApplyHealthCycle(client, config, options = {}) {
  const result = inspectArkShopApplyHealth(options);
  const state = result.current.ok ? 'healthy' : result.current.code;
  if (!result.changed || !result.alert) return { changed: false, state };

  const guildId = String(config?.discord?.guildId || '');
  if (!guildId) return { changed: true, delivered: false, reason: 'guild-not-configured', state };
  const guild = await client.guilds.fetch(guildId);
  const channel = await resolveChannel(guild);
  if (!channel) return { changed: true, delivered: false, reason: 'staff-channel-not-found', state };
  await channel.send(discordPayload(result.alert));
  return { changed: true, delivered: true, channelId: String(channel.id), state };
}

function startArkShopApplyHealthMonitor(client, config, { setTimeoutFn = setTimeout, setIntervalFn = setInterval } = {}) {
  const run = () => void runArkShopApplyHealthCycle(client, config).catch(() => {});
  const initial = setTimeoutFn(run, INITIAL_DELAY_MS);
  initial?.unref?.();
  const periodic = setIntervalFn(run, INTERVAL_MS);
  periodic?.unref?.();
  return { initial, periodic, run };
}

function installArkShopApplyHealthExtension() {
  if (startupDiagnostics().tasks.some((task) => task.id === STARTUP_TASK_ID)) return { installed: false, coordinated: true };
  const config = loadConfig();
  registerStartupTask({
    id: STARTUP_TASK_ID,
    owner: 'arkshop',
    priority: 155,
    run(client) {
      startArkShopApplyHealthMonitor(client, config);
    }
  });
  return { installed: true, coordinated: true };
}

module.exports = {
  STARTUP_TASK_ID,
  INITIAL_DELAY_MS,
  INTERVAL_MS,
  discordPayload,
  runArkShopApplyHealthCycle,
  startArkShopApplyHealthMonitor,
  installArkShopApplyHealthExtension
};
