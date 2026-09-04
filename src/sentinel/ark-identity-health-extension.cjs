'use strict';

const { loadConfig } = require('../shared/config.cjs');
const { resolveChannel } = require('./ark-staff-status-monitor-extension.cjs');
const { inspectIdentityHealth } = require('./ark-identity-health-monitor.cjs');
const { registerStartupTask, startupDiagnostics } = require('./startup-coordinator.cjs');

const STARTUP_TASK_ID = 'ark-identity-health';
const INITIAL_DELAY_MS = 12_000;
const INTERVAL_MS = 5 * 60_000;

function discordPayload(alert) {
  if (!alert) return null;
  const fields = [];
  if (alert.state === 'healthy' && alert.counts) {
    fields.push({
      name: 'Identity Store',
      value: `Profiles: **${alert.counts.profiles}** • Linked ARK accounts: **${alert.counts.linkedArkAccounts}** • Pending challenges: **${alert.counts.pendingChallenges}**`,
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
      footer: { text: 'Nexus Sentinal • ARK Identity Health • read-only monitoring' },
      timestamp: new Date().toISOString()
    }],
    allowedMentions: { parse: [] }
  };
}

async function runIdentityHealthCycle(client, config, options = {}) {
  const result = inspectIdentityHealth(options);
  if (!result.changed || !result.alert) return { changed: false, state: result.current.ok ? 'healthy' : result.current.code };

  const guildId = String(config?.discord?.guildId || '');
  if (!guildId) return { changed: true, delivered: false, reason: 'guild-not-configured', state: result.current.ok ? 'healthy' : result.current.code };
  const guild = await client.guilds.fetch(guildId);
  const channel = await resolveChannel(guild);
  if (!channel) return { changed: true, delivered: false, reason: 'staff-channel-not-found', state: result.current.ok ? 'healthy' : result.current.code };
  const payload = discordPayload(result.alert);
  await channel.send(payload);
  return { changed: true, delivered: true, channelId: String(channel.id), state: result.current.ok ? 'healthy' : result.current.code };
}

function startIdentityHealthMonitor(client, config, { setTimeoutFn = setTimeout, setIntervalFn = setInterval } = {}) {
  const run = () => void runIdentityHealthCycle(client, config).catch(() => {});
  const initial = setTimeoutFn(run, INITIAL_DELAY_MS);
  initial?.unref?.();
  const periodic = setIntervalFn(run, INTERVAL_MS);
  periodic?.unref?.();
  return { initial, periodic, run };
}

function installArkIdentityHealthExtension() {
  if (startupDiagnostics().tasks.some((task) => task.id === STARTUP_TASK_ID)) return { installed: false, coordinated: true };
  const config = loadConfig();
  registerStartupTask({
    id: STARTUP_TASK_ID,
    owner: 'ark-identity',
    priority: 145,
    run(client) {
      startIdentityHealthMonitor(client, config);
    }
  });
  return { installed: true, coordinated: true };
}

module.exports = {
  STARTUP_TASK_ID,
  INITIAL_DELAY_MS,
  INTERVAL_MS,
  discordPayload,
  runIdentityHealthCycle,
  startIdentityHealthMonitor,
  installArkIdentityHealthExtension
};
