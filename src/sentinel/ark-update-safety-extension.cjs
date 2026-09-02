'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Client, Events, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');
const { isStaff } = require('./ark-ops-extension.cjs');
const { BUTTON_UPDATE_SAFETY } = require('./ark-cluster-panel.cjs');
const { collectArkUpdateSafety, formatArkUpdateSafety } = require('./ark-update-safety.cjs');
const {
  enforceCompatibilityVerdict,
  formatPreUpdateGate,
  monitorIntervalMinutes
} = require('./ark-update-monitor.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.update.safety.extension');
const BOUND = Symbol.for('khaos.nexus.ark.update.safety.bound');
const STAFF_PANEL_MARKER = 'Nexus Sentinal • ARK Staff Status • v1';
const STAFF_PANEL_INITIAL_DELAY_MS = 95_000;
const MONITORED_PREFIXES = Object.freeze(['ARK_GEN1', 'ARK_MAP2']);

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

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function serverConfigured(prefix, env = process.env) {
  if (truthy(env[`${prefix}_ENABLED`])) return true;
  return Boolean(String(env[`${prefix}_SFTP_HOST`] || env[`${prefix}_HOST`] || '').trim());
}

function apiExpected(prefix, env = process.env) {
  const configured = String(env[`${prefix}_API_EXPECTED`] || '').trim();
  if (configured) return truthy(configured);
  return true;
}

function cleanName(value, fallback) {
  return String(value || fallback || 'ARK').replace(/[\r\n]+/g, ' ').trim().slice(0, 80);
}

function statusGlyph(status) {
  if (status === 'pass') return '🟢';
  if (status === 'fail') return '🔴';
  return '🟡';
}

function gameUpdateLine(report = {}) {
  const game = report.game || {};
  if (game.updateAvailable === true) return `🟡 **UPDATE AVAILABLE** • installed \`${game.installedBuildId || '?'}\` → public \`${game.publicBuildId || '?'}\``;
  if (game.updateAvailable === false) return `🟢 Current • build \`${game.installedBuildId || game.publicBuildId || '?'}\``;
  return `🟡 Build comparison unavailable • installed \`${game.installedBuildId || '?'}\` • public \`${game.publicBuildId || '?'}\``;
}

function apiLine(prefix, report = {}, env = process.env) {
  const api = report.api || {};
  const pendingBuild = report.game?.updateAvailable === true;
  if (!apiExpected(prefix, env)) {
    if (!pendingBuild) return '⚪ **Intentionally disabled** • compatibility watch remains active';
    return api.compatibleBuild === true
      ? `⚪ API disabled • ✅ compatibility evidence found for build \`${report.game?.publicBuildId || '?'}\``
      : `⚪ API disabled • 🔴 compatibility **not yet verified** for build \`${report.game?.publicBuildId || '?'}\``;
  }
  const version = api.installedVersion ? ` v${api.installedVersion}` : '';
  const latest = api.latestKnown && api.latestKnown !== api.installedVersion ? ` • latest v${api.latestKnown}` : '';
  const compat = pendingBuild
    ? (api.compatibleBuild === true ? ' • ✅ pending-build compatible' : ' • 🔴 pending-build unverified')
    : '';
  return `${statusGlyph(api.health)} ${String(api.health || 'unknown').toUpperCase()}${version}${latest}${compat}`;
}

function modsLine(report = {}) {
  const mods = report.mods || {};
  if (Number(mods.pendingCount || 0) > 0) return `🟡 ${mods.pendingCount} active mod update${Number(mods.pendingCount) === 1 ? '' : 's'} pending`;
  if (mods.status === 'pass') return `🟢 Current • ${Number(mods.activeCount || 0)} active`;
  return `🟡 Freshness ${String(mods.status || 'unknown')}`;
}

function serverField(prefix, server, report, env = process.env) {
  const name = cleanName(server?.name || env[`${prefix}_NAME`], prefix === 'ARK_MAP2' ? 'Astraeos' : 'GEN1');
  const rcon = report?.server?.rcon || 'unknown';
  const checked = report?.checkedAt ? `<t:${Math.floor(Date.parse(report.checkedAt) / 1000)}:R>` : 'just now';
  const value = [
    `**Server:** ${statusGlyph(rcon)} ${rcon === 'pass' ? 'Online / RCON responding' : rcon === 'fail' ? 'RCON unavailable' : 'RCON unknown'}`,
    `**ASA:** ${gameUpdateLine(report)}`,
    `**ASA Server API:** ${apiLine(prefix, report, env)}`,
    `**Mods:** ${modsLine(report)}`,
    `**Checked:** ${checked}`
  ].join('\n');
  return { name: `${prefix === 'ARK_MAP2' ? '🛰️' : '🦖'} ${name}`, value: value.slice(0, 1024), inline: false };
}

function normalizeChannelName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function resolveStaffStatusChannel(guild, env = process.env) {
  const configuredId = String(env.ARK_STAFF_STATUS_CHANNEL_ID || '').trim();
  if (configuredId) {
    const direct = await guild.channels.fetch(configuredId).catch(() => null);
    if (direct?.isTextBased?.() && typeof direct.send === 'function') return direct;
  }
  const channels = await guild.channels.fetch();
  const values = channels?.values ? [...channels.values()] : [];
  for (const wanted of ['ark-server-status', 'staff-ops', 'staff-hub']) {
    const channel = values.find((item) => item?.isTextBased?.() && typeof item.send === 'function' && normalizeChannelName(item.name) === wanted);
    if (channel) return channel;
  }
  return null;
}

function panelPayload(results = []) {
  const fields = results.map(({ prefix, server, report }) => serverField(prefix, server, report));
  return {
    embeds: [{
      title: 'KHAOS NEXUS • ARK STAFF STATUS',
      description: 'Read-only live cluster health and ASA → Server API compatibility tracking. Sentinel will **not** install API files, change INIs, update ARK, or restart a server from this monitor.',
      fields: fields.length ? fields : [{ name: 'ARK', value: 'No configured ARK servers were available to monitor.', inline: false }],
      footer: { text: STAFF_PANEL_MARKER },
      timestamp: new Date().toISOString()
    }],
    allowedMentions: { parse: [] }
  };
}

function panelMessageMatches(message, botId = '') {
  if (!message) return false;
  if (botId && String(message.author?.id || '') !== String(botId)) return false;
  return (message.embeds || []).some((embed) => String(embed?.footer?.text || '') === STAFF_PANEL_MARKER);
}

async function reconcileStaffPanel(channel, payload, botId = '') {
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const candidates = recent?.values ? [...recent.values()].filter((message) => panelMessageMatches(message, botId)) : [];
  candidates.sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0));
  let message = candidates[0] || null;
  let created = false;
  if (message) await message.edit(payload);
  else { message = await channel.send(payload); created = true; }
  if (!message.pinned && typeof message.pin === 'function') await message.pin('Nexus Sentinal ARK staff status panel').catch(() => {});
  for (const duplicate of candidates.slice(1)) await duplicate.delete('Duplicate Nexus Sentinal ARK staff panel').catch(() => {});
  return { message, created };
}

function statePath(prefix, env = process.env) {
  const root = String(env.NEXUS_DATA_DIR || '/app/data').trim() || '/app/data';
  return path.join(root, `${prefix.toLowerCase()}-staff-api-watch.json`);
}

function readState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function compactState(report = {}) {
  return {
    publicBuildId: String(report.game?.publicBuildId || ''),
    installedBuildId: String(report.game?.installedBuildId || ''),
    updateAvailable: report.game?.updateAvailable === true ? true : report.game?.updateAvailable === false ? false : null,
    apiCompatible: report.api?.compatibleBuild === true,
    compatibilitySource: String(report.api?.compatibilitySource || ''),
    apiLatestKnown: String(report.api?.latestKnown || ''),
    apiHealth: String(report.api?.health || 'unknown')
  };
}

function saveState(file, report = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify({ checkedAt: report.checkedAt || new Date().toISOString(), ...compactState(report) }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, file);
}

function buildChangeAlerts(prefix, server, previous, report, env = process.env) {
  if (!previous) return [];
  const current = compactState(report);
  const name = cleanName(server?.name || env[`${prefix}_NAME`], prefix);
  const messages = [];
  const newPublicBuild = current.publicBuildId && current.publicBuildId !== String(previous.publicBuildId || '');
  const updateBecamePending = current.updateAvailable === true && previous.updateAvailable !== true;
  if (newPublicBuild || updateBecamePending) {
    const apiNote = apiExpected(prefix, env)
      ? (current.apiCompatible ? '✅ API compatibility evidence is already available.' : '🔴 API compatibility is not yet verified; do not update/re-enable the API layer yet.')
      : (current.apiCompatible ? '✅ API remains intentionally disabled; compatibility evidence is available if you choose to reinstall it later.' : '⚪ API is intentionally disabled. Sentinel will keep watching for compatible API evidence before any future reinstall.');
    messages.push(`## 🟡 ASA UPDATE DETECTED — ${name}\nInstalled build: \`${current.installedBuildId || '?'}\`\nPublic build: \`${current.publicBuildId || '?'}\`\n${apiNote}\n\n_Sentinel is advisory only: no API install, game update, config write, or restart was performed._`);
  }
  if (current.updateAvailable === true && current.apiCompatible === true && previous.apiCompatible !== true) {
    messages.push(`## ✅ ASA SERVER API COMPATIBILITY — ${name}\nCompatibility evidence is now available for ASA build \`${current.publicBuildId || '?'}\`.\n${apiExpected(prefix, env) ? 'Staff can review the update gate before touching the API/server.' : 'The API remains intentionally disabled; this only records that a compatible path is now available.'}`);
  }
  if (apiExpected(prefix, env) && current.apiHealth === 'fail' && previous.apiHealth !== 'fail') {
    messages.push(`## 🔴 ASA SERVER API HEALTH — ${name}\nThe installed API layer changed to a failed health state. No automatic repair or restart was attempted.`);
  }
  return messages.map((message) => message.slice(0, 1900));
}

async function collectStaffResults(env = process.env) {
  const results = [];
  for (const prefix of MONITORED_PREFIXES) {
    if (!serverConfigured(prefix, env)) continue;
    let server;
    try { server = arkServerFromEnv(prefix); } catch { server = { name: env[`${prefix}_NAME`] || prefix, enabled: true }; }
    try {
      const report = await collectVerifiedHealth(prefix, server);
      results.push({ prefix, server, report, error: '' });
    } catch (error) {
      results.push({
        prefix,
        server,
        report: {
          checkedAt: new Date().toISOString(),
          server: { rcon: 'unknown' },
          game: { updateAvailable: null, installedBuildId: '', publicBuildId: '' },
          api: { health: 'unknown', compatibleBuild: false },
          mods: { status: 'unknown', pendingCount: 0, activeCount: 0 }
        },
        error: String(error?.message || error).slice(0, 240)
      });
    }
  }
  return results;
}

async function runStaffStatusCycle(client, config, reason = 'periodic') {
  const guildId = String(config.discord?.guildId || '');
  if (!guildId) return { skipped: 'guild-not-configured' };
  const guild = await client.guilds.fetch(guildId);
  const channel = await resolveStaffStatusChannel(guild);
  if (!channel) return { skipped: 'staff-status-channel-not-found' };
  const results = await collectStaffResults();
  await reconcileStaffPanel(channel, panelPayload(results), client.user?.id || '');
  let alerts = 0;
  for (const item of results) {
    if (item.error) continue;
    const file = statePath(item.prefix);
    const previous = readState(file);
    const messages = buildChangeAlerts(item.prefix, item.server, previous, item.report);
    saveState(file, item.report);
    for (const message of messages) {
      await channel.send({ content: message, allowedMentions: { parse: [] } });
      alerts += 1;
    }
  }
  console.log(`[Nexus Sentinal] ARK staff status (${reason}): channel=${channel.name} servers=${results.length} alerts=${alerts}`);
  return { channelId: String(channel.id), servers: results.length, alerts };
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
        if (server.enabled) {
          const guild = await client.guilds.fetch(String(config.discord?.guildId || ''));
          await registerArkHealthCommand(guild);
          console.log(`[Nexus Sentinal] ARK update safety ready: button + /ark-health server=${server.name}`);
        }
      })().catch((error) => console.warn(`[Nexus Sentinal] ARK update-safety registration failed: ${String(error?.message || error).slice(0, 240)}`));

      const run = (reason) => void runStaffStatusCycle(client, config, reason)
        .catch((error) => console.warn(`[Nexus Sentinal] ARK staff status unavailable: ${String(error?.message || error).slice(0, 300)}`));
      const initial = setTimeout(() => run('startup'), STAFF_PANEL_INITIAL_DELAY_MS);
      initial.unref?.();
      const intervalMs = monitorIntervalMinutes() * 60_000;
      const timer = setInterval(() => run('periodic'), intervalMs);
      timer.unref?.();
      console.log(`[Nexus Sentinal] ARK staff/API compatibility watch scheduled every ${Math.round(intervalMs / 60_000)} minute(s).`);
    });

    return originalLogin.apply(this, args);
  };
}

module.exports = {
  STAFF_PANEL_MARKER,
  STAFF_PANEL_INITIAL_DELAY_MS,
  MONITORED_PREFIXES,
  arkHealthCommand,
  registerArkHealthCommand,
  makeRcon,
  collectVerifiedHealth,
  buildHealthReply,
  isHealthInteraction,
  respondHealthInteraction,
  apiExpected,
  serverConfigured,
  gameUpdateLine,
  apiLine,
  modsLine,
  resolveStaffStatusChannel,
  panelPayload,
  compactState,
  buildChangeAlerts,
  collectStaffResults,
  runStaffStatusCycle,
  installArkUpdateSafetyExtension
};
