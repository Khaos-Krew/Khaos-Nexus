'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { arkServerFromEnv } = require('./ark-rcon.cjs');
const { collectVerifiedHealth } = require('./ark-update-safety-extension.cjs');
const { monitorIntervalMinutes } = require('./ark-update-monitor.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.staff.status.monitor.extension');
const MARKER = 'Nexus Sentinal • ARK Staff Status • v2';
const LEGACY_MARKER = 'Nexus Sentinal • ARK Staff Status • v1';
const INITIAL_DELAY_MS = 95_000;
const PREFIXES = Object.freeze(['ARK_GEN1', 'ARK_MAP2']);
const STAFF_CHANNEL_NAMES = Object.freeze(['ark-server-status', 'ark-ops', 'staff-ops', 'staff-hub', 'server-ops']);

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

function cleanDetail(value, max = 180) {
  return String(value || '').replace(/[\r\n]+/g, ' ').replace(/`/g, "'").trim().slice(0, max);
}

function normalizeName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function isStaffCategoryName(value) {
  const name = normalizeName(value);
  return name === 'staff' || name.startsWith('staff-') || name.endsWith('-staff') || name.includes('staff');
}

function categoryFor(channel, channels = []) {
  if (!channel?.parentId) return null;
  return channels.find((item) => String(item?.id || '') === String(channel.parentId)) || channel.parent || null;
}

function isApprovedStaffChannel(channel, channels = []) {
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') return false;
  const category = categoryFor(channel, channels);
  return Boolean(category && isStaffCategoryName(category.name));
}

function updateText(report = {}) {
  const game = report.game || {};
  if (game.updateAvailable === true) return `🟡 Update pending • \`${game.installedBuildId || '?'}\` → \`${game.publicBuildId || '?'}\``;
  if (game.updateAvailable === false) return `🟢 Current • build \`${game.installedBuildId || game.publicBuildId || '?'}\``;
  return `🟡 Build comparison unavailable • installed \`${game.installedBuildId || '?'}\` • public \`${game.publicBuildId || '?'}\``;
}

function apiText(prefix, report = {}, env = process.env) {
  const api = report.api || {};
  const pending = report.game?.updateAvailable === true;
  if (!apiExpected(prefix, env)) {
    if (!pending) return '⚪ Intentionally disabled • compatibility watch only';
    return api.compatibleBuild === true
      ? `⚪ Disabled • ✅ compatible evidence found for \`${report.game?.publicBuildId || '?'}\``
      : `⚪ Disabled • compatibility not verified for \`${report.game?.publicBuildId || '?'}\``;
  }
  const version = api.installedVersion ? ` v${api.installedVersion}` : '';
  const latest = api.latestKnown && api.latestKnown !== api.installedVersion ? ` • latest v${api.latestKnown}` : '';
  const compat = pending ? (api.compatibleBuild === true ? ' • pending-build compatible' : ' • pending-build unverified') : '';
  return `${glyph(api.health)} ${String(api.health || 'unknown').toUpperCase()}${version}${latest}${compat}`;
}

function modsText(report = {}) {
  const mods = report.mods || {};
  const active = Number(mods.activeCount || 0);
  const installed = Number(mods.installedCount || 0);
  const pending = Number(mods.pendingCount || 0);
  if (mods.status === 'unknown') return `🟡 Freshness unknown • active ${active} • detected ${installed}`;
  if (pending > 0) return `🟡 ${pending} pending • ${installed || active} checked • ${active} active`;
  return `🟢 Current • ${installed || active} checked • ${active} active`;
}

function endpoint(prefix, kind, env = process.env) {
  const host = String(env[`${prefix}_${kind === 'SFTP' ? 'SFTP_HOST' : 'HOST'}`] || env[`${prefix}_HOST`] || '').trim();
  const port = String(env[`${prefix}_${kind}_PORT`] || '').trim();
  if (!host && !port) return 'not configured';
  return `${host || '?'}${port ? `:${port}` : ''}`;
}

function serverField(prefix, server, report, error = '') {
  const env = process.env;
  const fallback = prefix === 'ARK_MAP2' ? 'Khaos Nexus (Astraeos)' : 'Khaos Nexus (Gen1)';
  const name = cleanName(server?.name || env[`${prefix}_NAME`], fallback);
  const rcon = report.server?.rcon || 'unknown';
  const checkedAt = Date.parse(report.checkedAt || '');
  const checked = Number.isFinite(checkedAt) ? `<t:${Math.floor(checkedAt / 1000)}:R>` : 'just now';
  const rconReason = rcon === 'fail' ? cleanDetail(report.server?.rconMessage || error || 'No response from configured RCON endpoint.') : '';
  const diagnostics = cleanDetail(error || report.diagnostics?.sftpError || report.game?.error || '', 150);

  const lines = [
    `**Network**`,
    `• Game: \`${endpoint(prefix, 'GAME', env)}\``,
    `• Query: \`${endpoint(prefix, 'QUERY', env)}\``,
    `• RCON: \`${endpoint(prefix, 'RCON', env)}\` • ${glyph(rcon)} ${rcon === 'pass' ? 'responding' : rcon === 'fail' ? 'failed' : 'unknown'}`,
    `• SFTP: \`${endpoint(prefix, 'SFTP', env)}\``,
    `**Software / content**`,
    `• ASA: ${updateText(report)}`,
    `• Server API: ${apiText(prefix, report, env)}`,
    `• Mods: ${modsText(report)}`
  ];
  if (rconReason) lines.push(`**RCON detail:** ${rconReason}`);
  if (diagnostics && diagnostics !== rconReason) lines.push(`**Diagnostic:** ${diagnostics}`);
  lines.push(`**Last verified:** ${checked}`);

  return {
    name: `${prefix === 'ARK_MAP2' ? '🛰️' : '🦖'} ${name}`,
    value: lines.join('\n').slice(0, 1024),
    inline: false
  };
}

async function resolveChannel(guild, env = process.env) {
  const channels = await guild.channels.fetch();
  const list = channels?.values ? [...channels.values()] : [];
  const explicit = String(env.ARK_STAFF_STATUS_CHANNEL_ID || '').trim();
  if (explicit) {
    const channel = list.find((item) => String(item?.id || '') === explicit) || await guild.channels.fetch(explicit).catch(() => null);
    if (isApprovedStaffChannel(channel, list)) return channel;
    console.warn('[Nexus Sentinal] ARK staff status explicit channel rejected because it is not inside a Staff category.');
  }

  const staffText = list.filter((channel) => isApprovedStaffChannel(channel, list));
  for (const wanted of STAFF_CHANNEL_NAMES) {
    const match = staffText.find((channel) => normalizeName(channel.name) === wanted);
    if (match) return match;
  }
  const arkStatus = staffText.find((channel) => {
    const name = normalizeName(channel.name);
    return name.includes('ark') && (name.includes('status') || name.includes('ops'));
  });
  return arkStatus || null;
}

function panelPayload(results = []) {
  return {
    embeds: [{
      title: '🔒 KHAOS NEXUS • ARK STAFF OPERATIONS',
      description: 'Staff-only infrastructure and compatibility view. Each server is checked independently. **Read-only:** this monitor does not install API files, write INIs, update ASA, or restart servers.',
      fields: results.length ? results.map((item) => serverField(item.prefix, item.server, item.report, item.error)) : [{ name: 'ARK', value: 'No configured ARK servers available.', inline: false }],
      footer: { text: MARKER },
      timestamp: new Date().toISOString()
    }],
    allowedMentions: { parse: [] }
  };
}

function matchesPanel(message, botId = '') {
  if (!message) return false;
  if (botId && String(message.author?.id || '') !== String(botId)) return false;
  return (message.embeds || []).some((embed) => [MARKER, LEGACY_MARKER].includes(String(embed?.footer?.text || '')));
}

function matchesSensitiveAlert(message, botId = '') {
  if (!message) return false;
  if (botId && String(message.author?.id || '') !== String(botId)) return false;
  const content = String(message.content || '');
  return /ASA UPDATE DETECTED|ASA SERVER API COMPATIBILITY|ASA SERVER API HEALTH/i.test(content);
}

async function removePublicStaffMessages(guild, botId = '') {
  const channels = await guild.channels.fetch();
  const list = channels?.values ? [...channels.values()] : [];
  let removed = 0;
  for (const channel of list) {
    if (!channel?.isTextBased?.() || !channel.messages?.fetch) continue;
    if (isApprovedStaffChannel(channel, list)) continue;
    const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!recent?.values) continue;
    for (const message of recent.values()) {
      if (!matchesPanel(message, botId) && !matchesSensitiveAlert(message, botId)) continue;
      await message.delete('Move ARK infrastructure status to staff-only channels').then(() => { removed += 1; }).catch(() => {});
    }
  }
  return removed;
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
    messages.push(`## 🟡 ASA UPDATE DETECTED — ${name}\nInstalled build: \`${current.installedBuildId || '?'}\`\nPublic build: \`${current.publicBuildId || '?'}\`\n${apiNote}\n\n_Staff-only advisory. Sentinel did not update, install API files, write configs, or restart the server._`);
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
  const removedPublic = await removePublicStaffMessages(guild, client.user?.id || '');
  const channel = await resolveChannel(guild);
  if (!channel) {
    console.warn('[Nexus Sentinal] ARK staff status skipped: no approved text channel inside a Staff category.');
    return { skipped: 'staff-category-channel-not-found', removedPublic };
  }
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
  console.log(`[Nexus Sentinal] ARK staff status (${reason}): channel=${channel.name} servers=${results.length} alerts=${alertCount} publicRemoved=${removedPublic}`);
  return { channelId: String(channel.id), serverCount: results.length, alertCount, removedPublic };
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
  LEGACY_MARKER,
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
