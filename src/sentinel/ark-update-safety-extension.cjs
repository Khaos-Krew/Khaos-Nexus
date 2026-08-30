'use strict';

const { Client, Events, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');
const { isStaff } = require('./ark-ops-extension.cjs');
const { BUTTON_UPDATE_SAFETY } = require('./ark-cluster-panel.cjs');
const { collectArkUpdateSafety, formatArkUpdateSafety } = require('./ark-update-safety.cjs');
const {
  monitorEnabled,
  monitorIntervalMinutes,
  enforceCompatibilityVerdict,
  snapshotReport,
  reportFingerprint,
  classifyChanges,
  stateFilePath,
  loadMonitorState,
  saveMonitorState,
  buildState,
  shouldAlert,
  formatMonitorAlert,
  formatModAlert,
  formatPreUpdateGate,
  resolveAlertChannel
} = require('./ark-update-monitor.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.update.safety.extension');
const BOUND = Symbol.for('khaos.nexus.ark.update.safety.bound');
const MONITOR = Symbol.for('khaos.nexus.ark.update.safety.monitor');
const INITIAL_MONITOR_DELAY_MS = 45_000;

function arkHealthCommand() {
  return new SlashCommandBuilder()
    .setName('ark-health')
    .setDescription('Check ASA server, mods, ArkApi and update safety.');
}

async function registerArkHealthCommand(guild) {
  const definition = arkHealthCommand().toJSON();
  const commands = await guild.commands.fetch();
  const existing = commands.find((item) => item.name === definition.name);
  if (existing) await guild.commands.edit(existing, definition);
  else await guild.commands.create(definition);
}

function makeRcon(server) {
  return server.host && server.port && server.password ? new ArkRconClient(server) : null;
}

async function collectVerifiedHealth(prefix, server) {
  const report = await collectArkUpdateSafety({ prefix, rcon: makeRcon(server) });
  return enforceCompatibilityVerdict(report);
}

async function buildHealthReply(prefix, server) {
  const report = await collectVerifiedHealth(prefix, server);
  const base = formatArkUpdateSafety(report, server.name).slice(0, 3150);
  return { report, content: `${base}\n\n${formatPreUpdateGate(report)}`.slice(0, 3900) };
}

function isHealthInteraction(interaction) {
  if (interaction.isChatInputCommand?.() && interaction.commandName === 'ark-health') return true;
  return Boolean(interaction.isButton?.() && interaction.customId === BUTTON_UPDATE_SAFETY);
}

async function respondHealthInteraction(interaction, { config, prefix, server }) {
  if (!isStaff(interaction, config)) throw new Error('ARK update safety is restricted to Nexus staff.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!server.enabled) throw new Error(`${prefix} is disabled.`);
  const result = await buildHealthReply(prefix, server);
  await interaction.editReply({ content: result.content, allowedMentions: { parse: [] } });
}

async function runMonitorCycle({ client, guild, prefix, server, statePath }) {
  const report = await collectVerifiedHealth(prefix, server);
  const previous = loadMonitorState(statePath);
  const currentSnapshot = snapshotReport(report);
  const changes = classifyChanges(previous?.snapshot || null, currentSnapshot);
  const changed = shouldAlert(previous, report, changes);

  if (changed) {
    const generalChannel = await resolveAlertChannel(guild, { modRelated: false });
    const modChanges = changes.filter((item) => item.modRelated);
    const modChannel = modChanges.length ? await resolveAlertChannel(guild, { modRelated: true }) : null;

    if (generalChannel) {
      await generalChannel.send({
        content: formatMonitorAlert(report, changes, server.name),
        allowedMentions: { parse: [] }
      });
    } else {
      console.warn('[Nexus Sentinal] ARK update monitor: no alert channel found; set ARK_UPDATE_ALERT_CHANNEL_ID or keep ark-server-status available.');
    }

    if (modChannel && modChanges.length && String(modChannel.id || '') !== String(generalChannel?.id || '')) {
      await modChannel.send({
        content: formatModAlert(report, modChanges, server.name),
        allowedMentions: { parse: [] }
      });
    }
  }

  saveMonitorState(statePath, buildState(report));
  const verdict = String(report.verdict?.level || 'unknown');
  console.log(`[Nexus Sentinal] ARK update monitor: server=${server.name} verdict=${verdict} changed=${changed} fingerprint=${reportFingerprint(report).slice(0, 12)} gameUpdate=${String(report.game?.updateAvailable)} api=${report.api?.health || 'unknown'} apiCompat=${String(report.api?.compatibleBuild)} mods=${report.mods?.status || 'unknown'} pendingMods=${Number(report.mods?.pendingCount || 0)}`);
  return { report, changed, changes };
}

function startArkUpdateMonitor(client, guild, { prefix, server } = {}) {
  if (client[MONITOR] || !server?.enabled || !monitorEnabled()) return;
  const intervalMinutes = monitorIntervalMinutes();
  const intervalMs = intervalMinutes * 60 * 1000;
  const statePath = stateFilePath(prefix);
  const state = { inFlight: false, timer: null, startupTimer: null };
  client[MONITOR] = state;

  const run = async () => {
    if (state.inFlight) return;
    state.inFlight = true;
    try {
      await runMonitorCycle({ client, guild, prefix, server, statePath });
    } catch (error) {
      console.warn(`[Nexus Sentinal] ARK update monitor failed: ${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 280)}`);
    } finally {
      state.inFlight = false;
    }
  };

  state.startupTimer = setTimeout(() => void run(), INITIAL_MONITOR_DELAY_MS);
  state.startupTimer.unref?.();
  state.timer = setInterval(() => void run(), intervalMs);
  state.timer.unref?.();
  console.log(`[Nexus Sentinal] ARK update monitor enabled: server=${server.name} every=${intervalMinutes}m state=${statePath}`);
}

function installArkUpdateSafetyExtension({ prefix = 'ARK_GEN1' } = {}) {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const server = arkServerFromEnv(prefix);
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusArkUpdateSafetyLogin(...args) {
    const client = this;
    if (!client[BOUND]) {
      client[BOUND] = true;
      client.on(Events.InteractionCreate, (interaction) => {
        if (!isHealthInteraction(interaction)) return;
        if (String(interaction.guildId || '') !== String(config.discord?.guildId || '')) return;
        void respondHealthInteraction(interaction, { config, prefix, server }).catch(async (error) => {
          const payload = { content: `⚠️ ARK health check failed: ${String(error?.message || error).slice(0, 1700)}`, allowedMentions: { parse: [] } };
          if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
          else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
        });
      });
    }

    client.once(Events.ClientReady, () => {
      void (async () => {
        if (!server.enabled) return;
        const guild = await client.guilds.fetch(String(config.discord?.guildId || ''));
        await registerArkHealthCommand(guild);
        startArkUpdateMonitor(client, guild, { prefix, server });
        console.log(`[Nexus Sentinal] ARK update-safety command registered: /ark-health server=${server.name}`);
      })().catch((error) => console.warn(`[Nexus Sentinal] ARK update-safety registration failed: ${String(error?.message || error).slice(0, 240)}`));
    });

    return originalLogin.apply(this, args);
  };
}

module.exports = {
  arkHealthCommand,
  registerArkHealthCommand,
  makeRcon,
  collectVerifiedHealth,
  buildHealthReply,
  isHealthInteraction,
  respondHealthInteraction,
  runMonitorCycle,
  startArkUpdateMonitor,
  installArkUpdateSafetyExtension
};
