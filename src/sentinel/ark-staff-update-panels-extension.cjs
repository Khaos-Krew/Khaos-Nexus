'use strict';

const { Client, Events } = require('discord.js');
const SftpClient = require('ssh2-sftp-client');
const { loadConfig } = require('../shared/config.cjs');
const { arkServerFromEnv } = require('./ark-rcon.cjs');
const { collectVerifiedHealth } = require('./ark-update-safety-extension.cjs');
const { sftpSettingsFromEnv } = require('./ark-sftp-config.cjs');
const { findDirectoryNamed, joinRemote } = require('./ark-sftp-discovery.cjs');
const { monitorIntervalMinutes } = require('./ark-update-monitor.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.staff.update.panels.extension');
const ASA_MARKER = 'Nexus Sentinal • ARK ASA Update Status • v1';
const API_MARKER = 'Nexus Sentinal • ARK API Update Status • v1';
const LEGACY_MARKERS = new Set([
  'Nexus Sentinal • ARK Staff Status • v1',
  'Nexus Sentinal • ARK Staff Status • v2'
]);
const PREFIXES = Object.freeze(['ARK_GEN1', 'ARK_MAP2']);
const INITIAL_DELAY_MS = 35_000;
const STAFF_CHANNEL_NAMES = Object.freeze(['ark-server-status', 'ark-ops', 'staff-ops', 'staff-hub', 'server-ops']);
const ASA_CLIENT_APP_ID = '2399830';
const remoteCache = new Map();

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

function normalizeName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function cleanText(value, max = 900) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[\/?(?:b|i|u|h\d|url(?:=[^\]]+)?)\]/gi, '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .slice(0, max);
}

function staffCategoryName(value) {
  return normalizeName(value).includes('staff');
}

function categoryFor(channel, channels = []) {
  if (!channel?.parentId) return channel?.parent || null;
  return channels.find((item) => String(item?.id || '') === String(channel.parentId)) || channel.parent || null;
}

function approvedStaffChannel(channel, channels = []) {
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') return false;
  const category = categoryFor(channel, channels);
  return Boolean(category && staffCategoryName(category.name));
}

async function resolveStaffChannel(guild, env = process.env) {
  const channels = await guild.channels.fetch();
  const list = channels?.values ? [...channels.values()] : [];
  const explicit = String(env.ARK_STAFF_STATUS_CHANNEL_ID || '').trim();
  if (explicit) {
    const channel = list.find((item) => String(item?.id || '') === explicit) || await guild.channels.fetch(explicit).catch(() => null);
    if (approvedStaffChannel(channel, list)) return channel;
    console.warn('[Nexus Sentinal] ARK update panels rejected configured channel because it is not inside a Staff category.');
  }
  const candidates = list.filter((channel) => approvedStaffChannel(channel, list));
  for (const wanted of STAFF_CHANNEL_NAMES) {
    const match = candidates.find((channel) => normalizeName(channel.name) === wanted);
    if (match) return match;
  }
  return candidates.find((channel) => {
    const name = normalizeName(channel.name);
    return name.includes('ark') && (name.includes('status') || name.includes('ops'));
  }) || null;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function cached(key, maxAgeMs, loader) {
  const hit = remoteCache.get(key);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.value;
  const value = await loader();
  remoteCache.set(key, { at: Date.now(), value });
  return value;
}

async function fetchAsaPatchNotes(publicBuildId = '') {
  return cached(`asa-notes:${publicBuildId || 'latest'}`, 5 * 60 * 1000, async () => {
    const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${ASA_CLIENT_APP_ID}&count=8&maxlength=2200&format=json`;
    const response = await fetchWithTimeout(url, { headers: { 'user-agent': 'Khaos-Nexus-Sentinel/1.0' } });
    if (!response.ok) throw new Error(`Steam news HTTP ${response.status}`);
    const payload = await response.json();
    const items = Array.isArray(payload?.appnews?.newsitems) ? payload.appnews.newsitems : [];
    const preferred = items.find((item) => /patch|update|version|community crunch/i.test(String(item?.title || ''))) || items[0] || null;
    if (!preferred) return { title: 'Patch notes unavailable', notes: '', url: '', publishedAt: '' };
    return {
      title: cleanText(preferred.title, 180),
      notes: cleanText(preferred.contents, 900),
      url: String(preferred.url || '').slice(0, 500),
      publishedAt: Number(preferred.date || 0) ? new Date(Number(preferred.date) * 1000).toISOString() : ''
    };
  });
}

async function fetchApiReleaseNotes() {
  return cached('asa-api-release-notes', 5 * 60 * 1000, async () => {
    const response = await fetchWithTimeout('https://api.github.com/repos/ArkServerApi/AsaApi/releases/latest', {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'Khaos-Nexus-Sentinel/1.0' }
    });
    if (!response.ok) throw new Error(`GitHub API release HTTP ${response.status}`);
    const payload = await response.json();
    return {
      version: String(payload.tag_name || payload.name || '').replace(/^v/i, '').trim(),
      title: cleanText(payload.name || payload.tag_name || 'Latest ASA Server API release', 180),
      notes: cleanText(payload.body || '', 900),
      url: String(payload.html_url || '').slice(0, 500),
      publishedAt: String(payload.published_at || '')
    };
  });
}

async function inspectApiCache(prefix) {
  const settings = sftpSettingsFromEnv(prefix);
  if (!settings.host || !settings.username || !settings.password) return { status: 'unknown', detail: 'SFTP credentials incomplete.' };
  const client = new SftpClient(`nexus-api-cache-${prefix.toLowerCase()}`);
  try {
    await client.connect({ host: settings.host, port: settings.port, username: settings.username, password: settings.password, readyTimeout: settings.readyTimeout || 12_000 });
    const shooterGame = await findDirectoryNamed(client, {
      starts: [settings.root || '.', '.'], directoryName: 'ShooterGame', maxDepth: 4, maxDirectories: 100, maxEntries: 1500
    });
    if (!shooterGame) return { status: 'unknown', detail: 'ShooterGame directory not found.' };
    const cacheDir = joinRemote(shooterGame.path, 'Binaries/Win64/ArkApi/Cache');
    const exists = await client.exists(cacheDir);
    if (!exists || exists !== 'd') return { status: 'missing', detail: 'ArkApi cache directory is not present.' };
    const entries = await client.list(cacheDir);
    const names = new Set(entries.map((entry) => String(entry.name || '')));
    const required = ['cached_key.cache', 'cached_offsets.cache', 'cached_bitfields.cache'];
    const missing = required.filter((name) => !names.has(name));
    let keyHash = '';
    if (names.has('cached_key.cache')) {
      try {
        const raw = await client.get(joinRemote(cacheDir, 'cached_key.cache'));
        const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
        keyHash = text.match(/[a-f0-9]{64}/i)?.[0]?.toLowerCase() || '';
      } catch {}
    }
    let generation = '';
    try {
      const generations = await client.list(joinRemote(cacheDir, 'generations'));
      const dirs = generations.filter((entry) => entry?.type === 'd' || String(entry?.permissions || '').startsWith('d'));
      dirs.sort((a, b) => Number(b.modifyTime || 0) - Number(a.modifyTime || 0));
      generation = String(dirs[0]?.name || '');
    } catch {}
    return {
      status: missing.length ? 'incomplete' : 'ready',
      missing,
      keyHash,
      generation,
      detail: missing.length ? `Missing ${missing.join(', ')}` : 'Required cache entries present.'
    };
  } catch (error) {
    return { status: 'unknown', detail: cleanText(error?.message || error, 220) };
  } finally {
    await client.end().catch(() => {});
  }
}

function cacheLine(cache = {}) {
  if (cache.status === 'ready') return `🟢 Ready • key \`${cache.keyHash ? cache.keyHash.slice(0, 12) : 'unknown'}…\`${cache.generation ? ` • generation \`${cleanText(cache.generation, 60)}\`` : ''}`;
  if (cache.status === 'missing') return '🔴 Missing • ArkApi cache directory not present';
  if (cache.status === 'incomplete') return `🟡 Incomplete • ${cleanText(cache.detail, 180)}`;
  return `🟡 Unknown • ${cleanText(cache.detail || 'cache could not be verified', 180)}`;
}

function serverName(prefix, server) {
  return String(server?.name || process.env[`${prefix}_NAME`] || (prefix === 'ARK_MAP2' ? 'Khaos Nexus (Astraeos)' : 'Khaos Nexus (Gen1)')).replace(/[\r\n]+/g, ' ').slice(0, 80);
}

function asaServerField(item) {
  const game = item.report?.game || {};
  const rcon = item.report?.server?.rcon || 'unknown';
  const status = game.updateAvailable === true ? '🟡 UPDATE AVAILABLE' : game.updateAvailable === false ? '🟢 CURRENT' : '🟡 UNKNOWN';
  return {
    name: `${item.prefix === 'ARK_MAP2' ? '🛰️' : '🦖'} ${serverName(item.prefix, item.server)}`,
    value: [
      `**State:** ${status}`,
      `**Installed server build:** \`${game.installedBuildId || '?'}\``,
      `**Public server build:** \`${game.publicBuildId || '?'}\``,
      `**Runtime version:** ${game.runtimeVersion ? `\`v${game.runtimeVersion}\`` : 'unknown'}`,
      `**RCON:** ${rcon === 'pass' ? '🟢 responding' : rcon === 'fail' ? '🔴 failed' : '🟡 unknown'}`
    ].join('\n').slice(0, 1024),
    inline: false
  };
}

function apiServerField(item) {
  const api = item.report?.api || {};
  const expected = apiExpected(item.prefix);
  const pending = item.report?.game?.updateAvailable === true;
  const state = !expected
    ? '⚪ intentionally disabled'
    : api.health === 'pass' ? '🟢 healthy' : api.health === 'fail' ? '🔴 failed' : '🟡 unverified';
  const compatibility = pending
    ? (api.compatibleBuild === true ? '🟢 verified for pending ASA build' : '🔴 not verified for pending ASA build')
    : '⚪ no pending ASA build requiring compatibility gate';
  return {
    name: `${item.prefix === 'ARK_MAP2' ? '🛰️' : '🦖'} ${serverName(item.prefix, item.server)}`,
    value: [
      `**API state:** ${state}`,
      `**Installed API:** ${api.installedVersion ? `\`v${api.installedVersion}\`` : expected ? 'unknown' : 'not installed / disabled'}`,
      `**Latest API:** ${api.latestKnown ? `\`v${api.latestKnown}\`` : 'unknown'}`,
      `**ASA compatibility:** ${compatibility}`,
      `**Offset/cache:** ${cacheLine(item.cache)}`
    ].join('\n').slice(0, 1024),
    inline: false
  };
}

function notesField(label, notes, url, publishedAt) {
  const timestamp = Date.parse(publishedAt || '');
  const date = Number.isFinite(timestamp) ? `<t:${Math.floor(timestamp / 1000)}:f>` : 'unknown';
  const body = cleanText(notes, 780) || 'No release notes were supplied by the upstream source.';
  return {
    name: label,
    value: `${body}\n\n**Published:** ${date}${url ? ` • [Open full notes](${url})` : ''}`.slice(0, 1024),
    inline: false
  };
}

function asaPayload(results, patch) {
  const publicBuild = results.find((item) => item.report?.game?.publicBuildId)?.report?.game?.publicBuildId || '?';
  const anyPending = results.some((item) => item.report?.game?.updateAvailable === true);
  return {
    embeds: [{
      title: '🦖 ARK: SURVIVAL ASCENDED • SERVER UPDATE STATUS',
      description: `${anyPending ? '🟡 **An ASA server update is available.**' : '🟢 **Configured servers are on the current detectable ASA build.**'}\nCurrent public server build: \`${publicBuild}\`\n\nThis panel is read-only; Sentinel does not press Update or restart a map automatically.`,
      fields: [
        ...results.map(asaServerField),
        notesField(`📋 Latest ASA notes • ${patch.title || 'Steam update notes'}`, patch.notes, patch.url, patch.publishedAt)
      ],
      footer: { text: ASA_MARKER },
      timestamp: new Date().toISOString()
    }],
    allowedMentions: { parse: [] }
  };
}

function apiPayload(results, release) {
  const problem = results.some((item) => apiExpected(item.prefix) && (item.report?.api?.health === 'fail' || item.cache?.status === 'missing' || item.cache?.status === 'incomplete'));
  return {
    embeds: [{
      title: '⚙️ ARK SERVER API • COMPATIBILITY & CACHE',
      description: `${problem ? '🔴 **One or more API checks need attention.**' : '🟢 **No verified API/cache blocker is currently detected.**'}\nLatest upstream ASA Server API: ${release.version ? `\`v${release.version}\`` : 'unknown'}\n\nCache status is verified independently per map and does not install or replace cache files.`,
      fields: [
        ...results.map(apiServerField),
        notesField(`📋 Latest API release notes • ${release.title || 'ASA Server API'}`, release.notes, release.url, release.publishedAt)
      ],
      footer: { text: API_MARKER },
      timestamp: new Date().toISOString()
    }],
    allowedMentions: { parse: [] }
  };
}

function markerOf(message) {
  return String(message?.embeds?.[0]?.footer?.text || '');
}

async function reconcileOne(channel, marker, payload, botId) {
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const candidates = recent?.values ? [...recent.values()].filter((message) => String(message.author?.id || '') === String(botId || '') && markerOf(message) === marker) : [];
  candidates.sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0));
  let message = candidates[0] || null;
  if (message) await message.edit(payload);
  else message = await channel.send(payload);
  if (!message.pinned && typeof message.pin === 'function') await message.pin('Nexus Sentinal ARK update status').catch(() => {});
  for (const duplicate of candidates.slice(1)) await duplicate.delete('Duplicate ARK update panel').catch(() => {});
  return message;
}

async function removeLegacyPanel(channel, botId) {
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!recent?.values) return 0;
  let removed = 0;
  for (const message of recent.values()) {
    if (String(message.author?.id || '') !== String(botId || '')) continue;
    if (!LEGACY_MARKERS.has(markerOf(message))) continue;
    await message.delete('Replaced by separate ASA and API staff panels').then(() => { removed += 1; }).catch(() => {});
  }
  return removed;
}

async function collectResults() {
  const results = [];
  for (const prefix of PREFIXES) {
    if (!configured(prefix)) continue;
    let server;
    try { server = arkServerFromEnv(prefix); }
    catch { server = { name: process.env[`${prefix}_NAME`] || prefix, enabled: true }; }
    let report;
    try { report = await collectVerifiedHealth(prefix, server); }
    catch (error) {
      report = {
        checkedAt: new Date().toISOString(),
        server: { rcon: 'unknown', rconMessage: cleanText(error?.message || error, 220) },
        game: { updateAvailable: null, installedBuildId: '', publicBuildId: '', runtimeVersion: '' },
        api: { health: 'unknown', installedVersion: '', latestKnown: '', compatibleBuild: false }
      };
    }
    const cache = await inspectApiCache(prefix);
    results.push({ prefix, server, report, cache });
  }
  return results;
}

async function runCycle(client, config, reason = 'periodic') {
  const guildId = String(config.discord?.guildId || '');
  if (!guildId) return { skipped: 'guild-not-configured' };
  const guild = await client.guilds.fetch(guildId);
  const channel = await resolveStaffChannel(guild);
  if (!channel) return { skipped: 'staff-channel-not-found' };
  const results = await collectResults();
  const publicBuildId = results.find((item) => item.report?.game?.publicBuildId)?.report?.game?.publicBuildId || '';
  let patch = { title: 'Patch notes unavailable', notes: '', url: '', publishedAt: '' };
  let release = { version: '', title: 'ASA Server API', notes: '', url: '', publishedAt: '' };
  try { patch = await fetchAsaPatchNotes(publicBuildId); } catch (error) { patch.notes = `Steam patch-note lookup failed: ${cleanText(error?.message || error, 220)}`; }
  try { release = await fetchApiReleaseNotes(); } catch (error) { release.notes = `API release-note lookup failed: ${cleanText(error?.message || error, 220)}`; }
  await reconcileOne(channel, ASA_MARKER, asaPayload(results, patch), client.user?.id || '');
  await reconcileOne(channel, API_MARKER, apiPayload(results, release), client.user?.id || '');
  const removedLegacy = await removeLegacyPanel(channel, client.user?.id || '');
  console.log(`[Nexus Sentinal] ARK update panels (${reason}): channel=${channel.name} servers=${results.length} legacyRemoved=${removedLegacy}`);
  return { channelId: String(channel.id), serverCount: results.length, removedLegacy };
}

function installArkStaffUpdatePanelsExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function nexusArkStaffUpdatePanelsLogin(...args) {
    const client = this;
    client.once(Events.ClientReady, () => {
      const run = (reason) => void runCycle(client, config, reason).catch((error) => console.warn(`[Nexus Sentinal] ARK update panels failed: ${cleanText(error?.message || error, 300)}`));
      const initial = setTimeout(() => run('startup'), INITIAL_DELAY_MS);
      initial.unref?.();
      const intervalMs = Math.max(5 * 60_000, monitorIntervalMinutes() * 60_000);
      const timer = setInterval(() => run('periodic'), intervalMs);
      timer.unref?.();
      console.log(`[Nexus Sentinal] separate ASA/API staff update panels scheduled every ${Math.round(intervalMs / 60_000)} minute(s).`);
    });
    return originalLogin.apply(this, args);
  };
}

module.exports = {
  ASA_MARKER,
  API_MARKER,
  PREFIXES,
  resolveStaffChannel,
  fetchAsaPatchNotes,
  fetchApiReleaseNotes,
  inspectApiCache,
  asaPayload,
  apiPayload,
  collectResults,
  runCycle,
  installArkStaffUpdatePanelsExtension
};
