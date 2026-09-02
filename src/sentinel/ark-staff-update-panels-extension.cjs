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
const ASA_MARKER = 'Nexus Sentinal • ARK ASA Update Status • v2';
const API_MARKER = 'Nexus Sentinal • ARK API Update Status • v2';
const LEGACY_MARKERS = new Set([
  'Nexus Sentinal • ARK Staff Status • v1',
  'Nexus Sentinal • ARK Staff Status • v2',
  'Nexus Sentinal • ARK ASA Update Status • v1',
  'Nexus Sentinal • ARK API Update Status • v1'
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

function normalizeName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function categoryFor(channel, channels = []) {
  if (!channel?.parentId) return channel?.parent || null;
  return channels.find((item) => String(item?.id || '') === String(channel.parentId)) || channel.parent || null;
}

function approvedStaffChannel(channel, channels = []) {
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') return false;
  const category = categoryFor(channel, channels);
  return Boolean(category && normalizeName(category.name).includes('staff'));
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
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
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
    const response = await fetchWithTimeout(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${ASA_CLIENT_APP_ID}&count=8&maxlength=2200&format=json`, { headers: { 'user-agent': 'Khaos-Nexus-Sentinel/1.0' } });
    if (!response.ok) throw new Error(`Steam news HTTP ${response.status}`);
    const payload = await response.json();
    const items = Array.isArray(payload?.appnews?.newsitems) ? payload.appnews.newsitems : [];
    const item = items.find((entry) => /patch|update|version|community crunch/i.test(String(entry?.title || ''))) || items[0] || null;
    if (!item) return { title: 'Patch notes unavailable', notes: '', url: '', publishedAt: '' };
    return {
      title: cleanText(item.title, 180),
      notes: cleanText(item.contents, 900),
      url: String(item.url || '').slice(0, 500),
      publishedAt: Number(item.date || 0) ? new Date(Number(item.date) * 1000).toISOString() : ''
    };
  });
}

async function fetchApiReleaseNotes() {
  return cached('asa-api-release-notes', 5 * 60 * 1000, async () => {
    const response = await fetchWithTimeout('https://api.github.com/repos/ArkServerApi/AsaApi/releases/latest', { headers: { accept: 'application/vnd.github+json', 'user-agent': 'Khaos-Nexus-Sentinel/1.0' } });
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
    const shooterGame = await findDirectoryNamed(client, { starts: [settings.root || '.', '.'], directoryName: 'ShooterGame', maxDepth: 4, maxDirectories: 100, maxEntries: 1500 });
    if (!shooterGame) return { status: 'unknown', detail: 'ShooterGame directory not found.' };
    const cacheDir = joinRemote(shooterGame.path, 'Binaries/Win64/ArkApi/Cache');
    if (await client.exists(cacheDir) !== 'd') return { status: 'missing', detail: 'ArkApi cache directory is not present.' };
    const entries = await client.list(cacheDir);
    const names = new Set(entries.map((entry) => String(entry.name || '')));
    const required = ['cached_key.cache', 'cached_offsets.cache', 'cached_bitfields.cache'];
    const missing = required.filter((name) => !names.has(name));
    let keyHash = '';
    if (names.has('cached_key.cache')) {
      try {
        const raw = await client.get(joinRemote(cacheDir, 'cached_key.cache'));
        keyHash = (Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '')).match(/[a-f0-9]{64}/i)?.[0]?.toLowerCase() || '';
      } catch {}
    }
    let generation = '';
    try {
      const generations = await client.list(joinRemote(cacheDir, 'generations'));
      const dirs = generations.filter((entry) => entry?.type === 'd' || String(entry?.permissions || '').startsWith('d')).sort((a, b) => Number(b.modifyTime || 0) - Number(a.modifyTime || 0));
      generation = String(dirs[0]?.name || '');
    } catch {}
    return { status: missing.length ? 'incomplete' : 'ready', missing, keyHash, generation, detail: missing.length ? `Missing ${missing.join(', ')}` : 'Required cache entries present.' };
  } catch (error) {
    return { status: 'unknown', detail: cleanText(error?.message || error, 220) };
  } finally {
    await client.end().catch(() => {});
  }
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function notesField(label, notes, url, publishedAt) {
  const timestamp = Date.parse(publishedAt || '');
  const date = Number.isFinite(timestamp) ? `<t:${Math.floor(timestamp / 1000)}:f>` : 'unknown';
  const body = cleanText(notes, 780) || 'No release notes were supplied by the upstream source.';
  return { name: label, value: `${body}\n\n**Published:** ${date}${url ? ` • [Open full notes](${url})` : ''}`.slice(0, 1024), inline: false };
}

function aggregateAsa(results = []) {
  const installed = unique(results.map((item) => item.report?.game?.installedBuildId));
  const runtime = unique(results.map((item) => item.report?.game?.runtimeVersion));
  const publicBuild = unique(results.map((item) => item.report?.game?.publicBuildId))[0] || '?';
  const anyPending = results.some((item) => item.report?.game?.updateAvailable === true);
  const unknown = results.some((item) => item.report?.game?.updateAvailable == null);
  const drift = installed.length > 1 || runtime.length > 1;
  return {
    publicBuild,
    installed: installed.length === 1 ? installed[0] : installed.length ? `mixed (${installed.join(', ')})` : '?',
    runtime: runtime.length === 1 ? runtime[0] : runtime.length ? `mixed (${runtime.join(', ')})` : '?',
    state: drift ? '🟡 CLUSTER VERSION DRIFT' : anyPending ? '🟡 UPDATE AVAILABLE' : unknown ? '🟡 VERIFYING' : '🟢 CURRENT'
  };
}

function aggregateApi(results = [], release = {}) {
  const expected = results.filter((item) => apiExpected(item.prefix));
  const installed = unique(expected.map((item) => item.report?.api?.installedVersion));
  const anyFail = expected.some((item) => item.report?.api?.health === 'fail');
  const anyUnknown = expected.some((item) => item.report?.api?.health !== 'pass');
  const pendingAsa = results.some((item) => item.report?.game?.updateAvailable === true);
  const compat = pendingAsa ? expected.every((item) => item.report?.api?.compatibleBuild === true) : true;
  const caches = expected.map((item) => item.cache || {});
  const cacheStatuses = unique(caches.map((cache) => cache.status));
  const cacheKeys = unique(caches.map((cache) => cache.keyHash));
  const generations = unique(caches.map((cache) => cache.generation));
  let cacheState = '🟡 Unknown';
  if (cacheStatuses.length === 1 && cacheStatuses[0] === 'ready') cacheState = '🟢 Ready';
  else if (cacheStatuses.includes('missing')) cacheState = '🔴 Missing';
  else if (cacheStatuses.includes('incomplete')) cacheState = '🟡 Incomplete';
  else if (cacheStatuses.length > 1) cacheState = '🟡 Mixed';
  const versionDrift = installed.length > 1;
  const state = versionDrift ? '🟡 VERSION DRIFT' : anyFail ? '🔴 FAILED' : (pendingAsa && !compat) ? '🔴 WAIT FOR COMPATIBILITY' : anyUnknown ? '🟡 VERIFYING' : '🟢 READY';
  return {
    state,
    installed: installed.length === 1 ? installed[0] : installed.length ? `mixed (${installed.join(', ')})` : 'not detected',
    latest: release.version || unique(results.map((item) => item.report?.api?.latestKnown))[0] || '?',
    compatibility: pendingAsa ? (compat ? '🟢 Compatible with pending ASA build' : '🔴 Compatibility not yet verified') : '🟢 No pending ASA compatibility gate',
    cacheState,
    cacheKey: cacheKeys.length === 1 ? `${cacheKeys[0].slice(0, 12)}…` : cacheKeys.length > 1 ? 'mixed' : 'unknown',
    generation: generations.length === 1 ? generations[0] : generations.length > 1 ? 'mixed' : 'unknown'
  };
}

function asaPayload(results, patch) {
  const asa = aggregateAsa(results);
  return {
    embeds: [{
      title: '🦖 ARK: SURVIVAL ASCENDED • UPDATE STATUS',
      description: '**Cluster-wide ASA software status** — no per-map server details are shown here.',
      fields: [
        { name: 'Current Status', value: `**State:** ${asa.state}\n**Installed build:** \`${asa.installed}\`\n**Current public build:** \`${asa.publicBuild}\`\n**Runtime version:** \`${asa.runtime}\``, inline: false },
        notesField(`📋 Latest ASA patch notes • ${patch.title || 'Steam update notes'}`, patch.notes, patch.url, patch.publishedAt)
      ],
      footer: { text: ASA_MARKER },
      timestamp: new Date().toISOString()
    }],
    allowedMentions: { parse: [] }
  };
}

function apiPayload(results, release) {
  const api = aggregateApi(results, release);
  return {
    embeds: [{
      title: '⚙️ ARK SERVER API • UPDATE & CACHE STATUS',
      description: '**Cluster-wide ARK Server API status** — no per-map server details are shown here.',
      fields: [
        { name: 'Current Status', value: `**State:** ${api.state}\n**Installed API:** \`v${api.installed}\`\n**Latest API:** \`v${api.latest}\`\n**ASA compatibility:** ${api.compatibility}`, inline: false },
        { name: 'Offset / Cache', value: `**Cache:** ${api.cacheState}\n**Cache key:** \`${api.cacheKey}\`\n**Generation:** \`${cleanText(api.generation, 90)}\``, inline: false },
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

async function removeLegacyPanels(channel, botId) {
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!recent?.values) return 0;
  let removed = 0;
  for (const message of recent.values()) {
    if (String(message.author?.id || '') !== String(botId || '')) continue;
    if (!LEGACY_MARKERS.has(markerOf(message))) continue;
    await message.delete('Replaced by cluster-wide ASA/API status panels').then(() => { removed += 1; }).catch(() => {});
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
      report = { checkedAt: new Date().toISOString(), game: { updateAvailable: null }, api: { health: 'unknown', compatibleBuild: false }, server: { rconMessage: cleanText(error?.message || error, 220) } };
    }
    results.push({ prefix, report, cache: await inspectApiCache(prefix) });
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
  const publicBuildId = unique(results.map((item) => item.report?.game?.publicBuildId))[0] || '';
  let patch = { title: 'Patch notes unavailable', notes: '', url: '', publishedAt: '' };
  let release = { version: '', title: 'ASA Server API', notes: '', url: '', publishedAt: '' };
  try { patch = await fetchAsaPatchNotes(publicBuildId); } catch (error) { patch.notes = `Steam patch-note lookup failed: ${cleanText(error?.message || error, 220)}`; }
  try { release = await fetchApiReleaseNotes(); } catch (error) { release.notes = `API release-note lookup failed: ${cleanText(error?.message || error, 220)}`; }
  const removedLegacy = await removeLegacyPanels(channel, client.user?.id || '');
  await reconcileOne(channel, ASA_MARKER, asaPayload(results, patch), client.user?.id || '');
  await reconcileOne(channel, API_MARKER, apiPayload(results, release), client.user?.id || '');
  console.log(`[Nexus Sentinal] cluster-wide ARK update panels (${reason}): channel=${channel.name} sources=${results.length} legacyRemoved=${removedLegacy}`);
  return { channelId: String(channel.id), sourceCount: results.length, removedLegacy };
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
      console.log(`[Nexus Sentinal] cluster-wide ASA/API staff update panels scheduled every ${Math.round(intervalMs / 60_000)} minute(s).`);
    });
    return originalLogin.apply(this, args);
  };
}

module.exports = { ASA_MARKER, API_MARKER, PREFIXES, resolveStaffChannel, fetchAsaPatchNotes, fetchApiReleaseNotes, inspectApiCache, aggregateAsa, aggregateApi, asaPayload, apiPayload, collectResults, runCycle, installArkStaffUpdatePanelsExtension };
