'use strict';

const { Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { arkServerFromEnv } = require('./ark-rcon.cjs');
const { collectVerifiedHealth } = require('./ark-update-safety-extension.cjs');
const { monitorIntervalMinutes } = require('./ark-update-monitor.cjs');
const {
  resolveStaffChannel,
  fetchAsaPatchNotes,
  fetchApiReleaseNotes,
  inspectApiCache
} = require('./ark-staff-update-panels-extension.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.staff.cluster.update.panels.extension');
const ASA_MARKER = 'Nexus Sentinal • ARK ASA Update Status • v1';
const API_MARKER = 'Nexus Sentinal • ARK API Update Status • v1';
const OBSOLETE = new Set([
  'Nexus Sentinal • ARK ASA Update Status • v2',
  'Nexus Sentinal • ARK API Update Status • v2',
  'Nexus Sentinal • ARK Staff Status • v1',
  'Nexus Sentinal • ARK Staff Status • v2'
]);
const PREFIXES = Object.freeze(['ARK_GEN1', 'ARK_MAP2']);
const INITIAL_DELAY_MS = 5_000;

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

function clean(value, max = 900) {
  return String(value || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function markerOf(message) {
  return String(message?.embeds?.[0]?.footer?.text || '');
}

function notesField(label, notes, url, publishedAt) {
  const parsed = Date.parse(publishedAt || '');
  const when = Number.isFinite(parsed) ? `<t:${Math.floor(parsed / 1000)}:f>` : 'unknown';
  return {
    name: label,
    value: `${clean(notes, 780) || 'No release notes were supplied by the upstream source.'}\n\n**Published:** ${when}${url ? ` • [Open full notes](${url})` : ''}`.slice(0, 1024),
    inline: false
  };
}

async function collect() {
  const results = [];
  for (const prefix of PREFIXES) {
    if (!configured(prefix)) continue;
    let server;
    try { server = arkServerFromEnv(prefix); }
    catch { server = { name: prefix, enabled: true }; }
    let report;
    try { report = await collectVerifiedHealth(prefix, server); }
    catch (error) {
      report = {
        checkedAt: new Date().toISOString(),
        game: { installedBuildId: '', publicBuildId: '', runtimeVersion: '', updateAvailable: null },
        api: { health: 'unknown', installedVersion: '', latestKnown: '', compatibleBuild: false }
      };
    }
    let cache = { status: 'unknown', keyHash: '', generation: '' };
    if (apiExpected(prefix)) {
      try { cache = await inspectApiCache(prefix); } catch {}
    }
    results.push({ prefix, report, cache });
  }
  return results;
}

function aggregateAsa(results) {
  const installed = unique(results.map((item) => item.report?.game?.installedBuildId));
  const runtime = unique(results.map((item) => item.report?.game?.runtimeVersion));
  const publicBuild = unique(results.map((item) => item.report?.game?.publicBuildId))[0] || '?';
  const pending = results.some((item) => item.report?.game?.updateAvailable === true);
  const unknown = results.some((item) => item.report?.game?.updateAvailable == null);
  const drift = installed.length > 1 || runtime.length > 1;
  return {
    state: drift ? '🟡 CLUSTER VERSION DRIFT' : pending ? '🟡 UPDATE AVAILABLE' : unknown ? '🟡 VERIFYING' : '🟢 CURRENT',
    installed: installed.length === 1 ? installed[0] : installed.length > 1 ? 'mixed' : '?',
    publicBuild,
    runtime: runtime.length === 1 ? runtime[0] : runtime.length > 1 ? 'mixed' : '?'
  };
}

function aggregateApi(results, release) {
  const expected = results.filter((item) => apiExpected(item.prefix));
  const versions = unique(expected.map((item) => item.report?.api?.installedVersion));
  const healths = expected.map((item) => String(item.report?.api?.health || 'unknown'));
  const pendingAsa = results.some((item) => item.report?.game?.updateAvailable === true);
  const compatibility = pendingAsa ? expected.every((item) => item.report?.api?.compatibleBuild === true) : true;
  const statuses = unique(expected.map((item) => item.cache?.status));
  const keys = unique(expected.map((item) => item.cache?.keyHash));
  const generations = unique(expected.map((item) => item.cache?.generation));

  let cacheState = '🟡 Unknown';
  if (statuses.length === 1 && statuses[0] === 'ready') cacheState = '🟢 Ready';
  else if (statuses.includes('missing')) cacheState = '🔴 Missing';
  else if (statuses.includes('incomplete')) cacheState = '🟡 Incomplete';
  else if (statuses.length > 1) cacheState = '🟡 Mixed';

  let state = '🟢 READY';
  if (versions.length > 1) state = '🟡 VERSION DRIFT';
  else if (healths.includes('fail')) state = '🔴 FAILED';
  else if (pendingAsa && !compatibility) state = '🔴 WAIT FOR COMPATIBILITY';
  else if (healths.some((value) => value !== 'pass')) state = '🟡 VERIFYING';

  return {
    state,
    installed: versions.length === 1 ? versions[0] : versions.length > 1 ? 'mixed' : 'not detected',
    latest: release.version || unique(results.map((item) => item.report?.api?.latestKnown))[0] || '?',
    compatibility: pendingAsa ? (compatibility ? '🟢 Compatible with pending ASA build' : '🔴 Compatibility not yet verified') : '🟢 No pending ASA compatibility gate',
    cacheState,
    cacheKey: keys.length === 1 ? `${keys[0].slice(0, 12)}…` : keys.length > 1 ? 'mixed' : 'unknown',
    generation: generations.length === 1 ? generations[0] : generations.length > 1 ? 'mixed' : 'unknown'
  };
}

function asaPayload(results, patch) {
  const asa = aggregateAsa(results);
  return {
    embeds: [{
      title: '🦖 ARK: SURVIVAL ASCENDED • UPDATE STATUS',
      description: 'Cluster-wide ASA software status.',
      fields: [
        {
          name: 'Current Status',
          value: `**State:** ${asa.state}\n**Installed server build:** \`${asa.installed}\`\n**Latest public build:** \`${asa.publicBuild}\`\n**ARK version:** \`${asa.runtime}\``,
          inline: false
        },
        notesField(`📋 Latest ASA patch notes • ${patch.title || 'Update notes'}`, patch.notes, patch.url, patch.publishedAt)
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
      description: 'Cluster-wide ARK Server API software and offset-cache status.',
      fields: [
        {
          name: 'Current Status',
          value: `**State:** ${api.state}\n**Installed API:** \`v${api.installed}\`\n**Latest API:** \`v${api.latest}\`\n**ASA compatibility:** ${api.compatibility}`,
          inline: false
        },
        {
          name: 'Offset / Cache',
          value: `**Cache:** ${api.cacheState}\n**Cache key:** \`${api.cacheKey}\`\n**Generation:** \`${clean(api.generation, 90)}\``,
          inline: false
        },
        notesField(`📋 Latest API release notes • ${release.title || 'ASA Server API'}`, release.notes, release.url, release.publishedAt)
      ],
      footer: { text: API_MARKER },
      timestamp: new Date().toISOString()
    }],
    allowedMentions: { parse: [] }
  };
}

async function upsertExisting(channel, marker, payload, botId) {
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const messages = recent?.values ? [...recent.values()] : [];
  const exact = messages.filter((message) => String(message.author?.id || '') === String(botId || '') && markerOf(message) === marker);
  exact.sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0));
  let target = exact[0] || null;
  if (target) await target.edit(payload);
  else target = await channel.send(payload);
  if (!target.pinned && typeof target.pin === 'function') await target.pin('Nexus Sentinal ARK cluster update status').catch(() => {});
  for (const duplicate of exact.slice(1)) await duplicate.delete('Duplicate ARK cluster status panel').catch(() => {});
  return target;
}

async function removeObsolete(channel, botId) {
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!recent?.values) return 0;
  let removed = 0;
  for (const message of recent.values()) {
    if (String(message.author?.id || '') !== String(botId || '')) continue;
    if (!OBSOLETE.has(markerOf(message))) continue;
    await message.delete('Replaced by cluster-wide ARK software panels').then(() => { removed += 1; }).catch(() => {});
  }
  return removed;
}

async function runCycle(client, config, reason = 'periodic') {
  const guildId = String(config.discord?.guildId || '');
  if (!guildId) return;
  const guild = await client.guilds.fetch(guildId);
  const channel = await resolveStaffChannel(guild);
  if (!channel) return;
  const results = await collect();
  const publicBuild = unique(results.map((item) => item.report?.game?.publicBuildId))[0] || '';
  let patch = { title: 'Patch notes unavailable', notes: '', url: '', publishedAt: '' };
  let release = { version: '', title: 'ASA Server API', notes: '', url: '', publishedAt: '' };
  try { patch = await fetchAsaPatchNotes(publicBuild); } catch (error) { patch.notes = `Patch-note lookup failed: ${clean(error?.message || error, 220)}`; }
  try { release = await fetchApiReleaseNotes(); } catch (error) { release.notes = `API release lookup failed: ${clean(error?.message || error, 220)}`; }
  await upsertExisting(channel, ASA_MARKER, asaPayload(results, patch), client.user?.id || '');
  await upsertExisting(channel, API_MARKER, apiPayload(results, release), client.user?.id || '');
  const removed = await removeObsolete(channel, client.user?.id || '');
  console.log(`[Nexus Sentinal] cluster-wide ARK software panels (${reason}): channel=${channel.name} obsoleteRemoved=${removed}`);
}

function installArkStaffClusterUpdatePanelsExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function nexusArkStaffClusterUpdatePanelsLogin(...args) {
    const client = this;
    client.once(Events.ClientReady, () => {
      const run = (reason) => void runCycle(client, config, reason).catch((error) => console.warn(`[Nexus Sentinal] cluster-wide ARK software panels failed: ${clean(error?.message || error, 300)}`));
      const initial = setTimeout(() => run('startup'), INITIAL_DELAY_MS);
      initial.unref?.();
      const intervalMs = Math.max(5 * 60_000, monitorIntervalMinutes() * 60_000);
      const timer = setInterval(() => run('periodic'), intervalMs);
      timer.unref?.();
      console.log(`[Nexus Sentinal] cluster-wide ASA/API staff panels scheduled every ${Math.round(intervalMs / 60000)} minute(s).`);
    });
    return originalLogin.apply(this, args);
  };
}

module.exports = { installArkStaffClusterUpdatePanelsExtension, runCycle, asaPayload, apiPayload };
