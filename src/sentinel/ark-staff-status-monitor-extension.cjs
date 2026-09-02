'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { arkServerFromEnv } = require('./ark-rcon.cjs');
const { collectVerifiedHealth } = require('./ark-update-safety-extension.cjs');
const { monitorIntervalMinutes } = require('./ark-update-monitor.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.staff.status.monitor.extension');
const MARKER = 'Nexus Sentinal • ARK Staff Status • v1';
const INITIAL_DELAY_MS = 95_000;
const PREFIXES = Object.freeze(['ARK_GEN1', 'ARK_MAP2']);

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function configured(prefix, env = process.env) {
  return truthy(env[`${prefix}_ENABLED`]) || Boolean(String(env[`${prefix}_SFTP_HOST`] || env[`${prefix}_HOST`] || '').trim());
}

function apiExpected(prefix, env = process.env) {
  const raw = String(env[`${prefix}_API_EXPECTED`] || '').trim();
  return raw ? truthy(raw) : true;
}

function glyph(status) {
  if (status === 'pass') return '🟢';
  if (status === 'fail') return '🔴';
  return '🟡';
}

function cleanName(value, fallback) {
  return String(value || fallback || 'ARK').replace(/[\r\n]+/g, ' ').trim().slice(0, 80);
}

function updateText(report = {}) {
  const game = report.game || {};
  if (game.updateAvailable === true) return `🟡 **UPDATE AVAILABLE** • \`${game.installedBuildId || '?'}\` → \`${game.publicBuildId || '?'}\``;
  if (game.updateAvailable === false) return `🟢 Current • build \`${game.installedBuildId || game.publicBuildId || '?'}\``;
  return `🟡 Comparison unavailable • installed \`${game.installedBuildId || '?'}\` • public \`${game.publicBuildId || '?'}\``;
}

function apiText(prefix, report = {}, env = process.env) {
  const api = report.api || {};
  const pending = report.game?.updateAvailable === true;
  if (!apiExpected(prefix, env)) {
    if (!pending) return '⚪ **Intentionally disabled** • compatibility watch active';
    return api.compatibleBuild === true
      ? `⚪ Disabled • ✅ compatible evidence found for \`${report.game?.publicBuildId || '?'}\``
      : `⚪ Disabled • 🔴 compatibility not verified for \`${report.game?.publicBuildId || '?'}\``;
  }
  const version = api.installedVersion ? ` v${api.installedVersion}` : '';
  const latest = api.latestKnown && api.latestKnown !== api.installedVersion ? ` • latest v${api.latestKnown}` : '';
  const compat = pending ? (api.compatibleBuild === true ? ' • ✅ pending-build compatible' : ' • 🔴 pending-build unverified') : '';
  return `${glyph(api.health)} ${String(api.health || 'unknown').toUpperCase()}${version}${latest}${compat}`;
}

function modsText(report = {}) {
  const mods = report.mods || {};
  if (Number(mods.pendingCount || 0) > 0) return `🟡 ${mods.pendingCount} active mod update${Number(mods.pendingCount) === 1 ? '' : 's'} pending`;
  if (mods.status === 'pass') return `🟢 Current • ${Number(mods.activeCount || 0)} active`;
  return `🟡 Freshness ${String(mods.status || 'unknown')}`;
}

function serverField(prefix, server, report) {
  const name = cleanName(server?.name || process.env[`${prefix}_NAME`], prefix === 'ARK_MAP2' ? 'Astraeos' : 'GEN1');
  const rcon = report.server?.rcon || 'unknown';
  const checkedAt = Date.parse(report.checkedAt || '');
  const checked = Number.isFinite(checkedAt) ? `<t:${Math.floor(checkedAt / 1000)}:R>` : 'just now';
  return {
    name: `${prefix === 'ARK_MAP2' ? '🛰️' : '🦖'} ${name}`,
    value: [
      `**Server:** ${glyph(rcon)} ${rcon === 'pass' ? 'Online / RCON responding' : rcon === 'fail' ? 'RCON unavailable' : 'RCON unknown'}`,
      `**ASA:** ${updateText(report)}`,
      `**ASA Server API:** ${apiText(prefix, report)}`,
      `**Mods:** ${modsText(report)}`,
      `**Checked:** ${checked}`
    ].join('\n').slice(0, 1024),
    inline: false
  };
}

function normalizeName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function resolveChannel(guild, env = process.env) {
  const explicit = String(env.ARK_STAFF_STATUS_CHANNEL_ID || '').trim();
  if (explicit) {
    const channel = await guild.channels.fetch(explicit).catch(() => null);
    if (channel?.isTextBased?.() && typeof channel.send === 'function') return channel;
  }
  const channels = await guild.channels.fetch();
  const list = channels?.values ? [...channels.values()] : [];
  for (const wanted of ['ark-server-status', 'staff-ops', 'staff-hub']) {
    const match = list.find((channel) => channel?.isTextBased?.() && typeof channel.send === 'function' && normalizeName(channel.name) === wanted);
    if (match) return match;
  }
  return null;
}

function panelPayload(results = []) {
  return {
    embeds: [{
      title: 'KHAOS NEXUS • ARK STAFF STATUS',
      description: 'Read-only cluster health plus ASA → Server API compatibility tracking. **This monitor never installs API files, changes INIs, updates ARK, or restarts a server.**',
      fields: results.length ? results.map((item) => serverField(item.prefix, item.server, item.report)) : [{ name: 'ARK', value: 'No configured ARK servers available.', inline: false }],
      footer: { text: MARKER },
      timestamp: new Date().toISOString()
    }],
    allowedMentions: { parse: [] }
  };
}

function matchesPanel(message, botId = '') {
  if (!message) return false;
  if (botId && String(message.author?.id || '') !== String(botId)) return false;
  return (message.embeds || []).some((embed) => String(embed?.footer?.text || '') === MARKER);
}

async function reconcilePanel(channel, payload, botId = '') {
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const candidates = recent?.values ? [...recent.values()].filter((message) => matchesPanel(message, botId)) : [];
  candidates.sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0));
  let message = candidates[0] || null;
  if (message) await message.edit(payload);
  else message = await channel.send(payload);
  if (!message.pinned && typeof message.pin === 'function') await message.pin('Nexus Sentinal ARK staff status panel').catch(() => {});
  for (const duplicate of candidates.slice(1)) await duplicate.delete('Duplicate ARK staff status panel').catch(() => {});
  return message;
}

function statePath(prefix, env = process.env) {
  const root = String(env.NEXUS_DATA_DIR || '/app/data').trim() || '/app/data';
  return path.join(root, `${prefix.toLowerCase()}-staff-api-watch.json`);
}

function loadState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function snapshot(report = {}) {
  return {
    installedBuildId: String(report.game?.installedBuildId || ''),
    publicBuildId: String(report.game?.publicBuildId || ''),
    updateAvailable: report.game?.updateAvailable === true ? true : report.game?.updateAvailable === false ? false : null,
    compatibleBuild: report.api?.compatibleBuild === true,
    compatibilitySource: String(report.api?.compatibilitySource || ''),
    apiHealth: String(report.api?.health || 'unknown'),
    apiLatestKnown: String(report.api?.latestKnown || '')
  };
}

function saveState(file, report = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify({ checkedAt: report.checkedAt || new Date().toISOString(), ...snapshot(report) }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, file);
}

function changeAlerts(prefix, server, previous, report) {
  if (!previous) return [];
  const current = snapshot(report);
  const name = cleanName(server?.name || process.env[`${prefix}_NAME`], prefix);
  const messages = [];
  const newPublicBuild = current.publicBuildId && current.publicBuildId !== String(previous.publicBuildId || '');
  const newlyPending = current.updateAvailable === true && previous.updateAvailable !== true;
  if (newPublicBuild || newlyPending) {
    const apiNote = apiExpected(prefix)
      ? (current.compatibleBuild ? '✅ API compatibility evidence is already available.' : '🔴 API compatibility is not yet verified. Do not update/re-enable the API layer yet.')
      : (current.compatibleBuild ? '✅ API remains intentionally disabled; compatibility evidence is available if it is ever reinstalled.' : '⚪ API is intentionally disabled. Sentinel will keep watching for compatible API evidence.');
    messages.push(`## 🟡 ASA UPDATE DETECTED — ${name}\nInstalled build: \`${current.installedBuildId || '?'}\`\nPublic build: \`${current.publicBuildId || '?'}\`\n${apiNote}\n\n_Sentinel is advisory only; no update, API install, config write, or restart was performed._`);
  }
  if (current.updateAvailable === true && current.compatibleBuild === true && previous.compatibleBuild !== true) {
    messages.push(`## ✅ ASA SERVER API COMPATIBILITY — ${name}\nCompatibility evidence is now available for ASA build \`${current.publicBuildId || '?'}\`.\n${apiExpected(prefix) ? 'Review `/ark-health` before touching the API/server.' : 'The API remains intentionally disabled; this only records that a compatible path is available.'}`);
  }
  if (apiExpected(prefix) && current.apiHealth === 'fail' && previous.apiHealth !== 'fail') {
    messages.push(`## 🔴 ASA SERVER API HEALTH — ${name}\nThe installed API layer changed to a failed health state. Sentinel did not attempt an automatic repair or restart.`);
  }
  return messages.map((message) => message.slice(0, 1900));
}

async function collectResults() {
  const results = [];
  for (const prefix of PREFIXES) {
    if (!configured(prefix)) continue;
    let server;
    try { server = arkServerFromEnv(prefix); } catch { server = { name: process.env[`${prefix}_NAME`] || prefix, enabled: true }; }
    try {
      const report = await collectVerifiedHealth(prefix, server);
      results.push({ prefix, server, report, error: '' });
    } catch (error) {
      results.push({
        prefix,
        server,
        report: { checkedAt: new Date().toISOString(), server: { rcon: 'unknown' }, game: { updateAvailable: null }, api: { health: 'unknown', compatibleBuild: false }, mods: { status: 'unknown', pendingCount: 0 } },
        error: String(error?.message || error).slice(0, 240)
      });
    }
  }
  return results;
}

async function runCycle(client, config, reason = 'periodic') {
  const guildId = String(config.discord?.guildId || '');
  if (!guildId) return { skipped: 'guild-not-configured' };
  const guild = await client.guilds.fetch(guildId);
  const channel = await resolveChannel(guild);
  if (!channel) return { skipped: 'staff-channel-not-found' };
  const results = await collectResults();
  await reconcilePanel(channel, panelPayload(results), client.user?.id || '');
  let alertCount = 0;
  for (const item of results) {
    if (item.error) continue;
    const file = statePath(item.prefix);
    const previous = loadState(file);
    const alerts = changeAlerts(item.prefix, item.server, previous, item.report);
    saveState(file, item.report);
    for (const content of alerts) {
      await channel.send({ content, allowedMentions: { parse: [] } });
      alertCount += 1;
    }
  }
  console.log(`[Nexus Sentinal] ARK staff status (${reason}): channel=${channel.name} servers=${results.length} alerts=${alertCount}`);
  return { channelId: String(channel.id), serverCount: results.length, alertCount };
}

function installArkStaffStatusMonitorExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function nexusArkStaffStatusLogin(...args) {
    const client = this;
    client.once(Events.ClientReady, () => {
      const run = (reason) => void runCycle(client, config, reason).catch((error) => console.warn(`[Nexus Sentinal] ARK staff status monitor failed: ${String(error?.message || error).slice(0, 300)}`));
      const initial = setTimeout(() => run('startup'), INITIAL_DELAY_MS);
      initial.unref?.();
      const intervalMs = monitorIntervalMinutes() * 60_000;
      const timer = setInterval(() => run('periodic'), intervalMs);
      timer.unref?.();
      console.log(`[Nexus Sentinal] ARK staff/API compatibility monitor scheduled every ${Math.round(intervalMs / 60_000)} minute(s).`);
    });
    return originalLogin.apply(this, args);
  };
}

module.exports = {
  MARKER,
  INITIAL_DELAY_MS,
  PREFIXES,
  apiExpected,
  configured,
  updateText,
  apiText,
  modsText,
  resolveChannel,
  panelPayload,
  snapshot,
  changeAlerts,
  collectResults,
  runCycle,
  installArkStaffStatusMonitorExtension
};
