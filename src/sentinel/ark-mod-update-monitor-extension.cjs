'use strict';

const { Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { arkServerFromEnv } = require('./ark-rcon.cjs');
const { collectVerifiedHealth } = require('./ark-update-safety-extension.cjs');
const {
  monitorEnabled,
  monitorIntervalMinutes,
  clusterStateFilePath,
  loadAnnouncementState,
  saveAnnouncementState,
  unannouncedPendingMods,
  buildClusterModUpdatePayload,
  resolveAlertChannel
} = require('./ark-update-monitor.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.mod.update.monitor.extension');
const BOUND = Symbol.for('khaos.nexus.ark.mod.update.monitor.bound');
const DEFAULT_PREFIXES = Object.freeze(['ARK_GEN1', 'ARK_MAP2']);
const INITIAL_DELAY_MS = 45_000;

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function configured(prefix, env = process.env) {
  const enabled = String(env[`${prefix}_ENABLED`] || '').trim();
  if (enabled && !truthy(enabled)) return false;
  return truthy(enabled) || Boolean(String(env[`${prefix}_SFTP_HOST`] || env[`${prefix}_HOST`] || '').trim());
}

function monitorPrefixes(env = process.env) {
  const configuredList = String(env.ARK_MOD_UPDATE_PREFIXES || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const prefixes = configuredList.length ? configuredList : [...DEFAULT_PREFIXES];
  return [...new Set(prefixes)].filter((prefix) => configured(prefix, env));
}

async function collectClusterReports(prefixes = monitorPrefixes()) {
  const reports = [];
  for (const prefix of prefixes) {
    const server = arkServerFromEnv(prefix);
    if (!server.enabled && !configured(prefix)) continue;
    try {
      const report = await collectVerifiedHealth(prefix, server);
      reports.push({ prefix, serverName: server.name || prefix, report });
    } catch (error) {
      console.warn(`[Nexus Sentinal] ARK mod update check failed prefix=${prefix}: ${String(error?.message || error).slice(0, 260)}`);
    }
  }
  return reports;
}

async function runModUpdateCheck(client, { config = loadConfig(), env = process.env } = {}) {
  if (!monitorEnabled(env)) return { enabled: false, checked: 0, announced: 0 };
  const prefixes = monitorPrefixes(env);
  if (!prefixes.length) return { enabled: true, checked: 0, announced: 0, reason: 'no-configured-servers' };

  const reports = await collectClusterReports(prefixes);
  if (!reports.length) return { enabled: true, checked: 0, announced: 0, reason: 'health-collection-unavailable' };

  const statePath = clusterStateFilePath(env);
  const state = loadAnnouncementState(statePath);
  const pending = unannouncedPendingMods(reports, state);
  if (!pending.length) return { enabled: true, checked: reports.length, announced: 0 };

  const guildId = String(config.discord?.guildId || '').trim();
  if (!guildId) throw new Error('Discord guild ID is not configured.');
  const guild = await client.guilds.fetch(guildId);
  const channel = await resolveAlertChannel(guild, { modRelated: true, env });
  if (!channel) throw new Error('No ARK mod update channel is available. Configure ARK_MOD_UPDATE_CHANNEL_ID or create #mod-updates.');

  const announced = new Set(state.announced || []);
  let sent = 0;
  for (const mod of pending) {
    try {
      const payload = await buildClusterModUpdatePayload(mod, env);
      await channel.send(payload);
      announced.add(mod.key);
      saveAnnouncementState(statePath, { announced: [...announced] });
      sent += 1;
    } catch (error) {
      console.warn(`[Nexus Sentinal] ARK mod update announcement failed key=${mod.key}: ${String(error?.message || error).slice(0, 260)}`);
    }
  }
  return { enabled: true, checked: reports.length, announced: sent, pending: pending.length };
}

function installArkModUpdateMonitorExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusArkModUpdateMonitorLogin(...args) {
    const client = this;
    if (!client[BOUND]) {
      client[BOUND] = true;
      client.once(Events.ClientReady, () => {
        if (!monitorEnabled()) {
          console.log('[Nexus Sentinal] ARK automatic mod update notifications are disabled by ARK_UPDATE_MONITOR_ENABLED.');
          return;
        }
        const intervalMs = monitorIntervalMinutes() * 60_000;
        const run = () => void runModUpdateCheck(client, { config }).catch((error) => {
          console.warn(`[Nexus Sentinal] ARK automatic mod update monitor failed: ${String(error?.message || error).slice(0, 300)}`);
        });
        const initial = setTimeout(run, INITIAL_DELAY_MS);
        initial.unref?.();
        const timer = setInterval(run, intervalMs);
        timer.unref?.();
        console.log(`[Nexus Sentinal] ARK mod update monitor armed interval=${monitorIntervalMinutes()}m prefixes=${monitorPrefixes().join(',') || 'none'}`);
      });
    }
    return originalLogin.apply(this, args);
  };
}

module.exports = {
  DEFAULT_PREFIXES,
  monitorPrefixes,
  collectClusterReports,
  runModUpdateCheck,
  installArkModUpdateMonitorExtension
};
