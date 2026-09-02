'use strict';

const { Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { monitorIntervalMinutes } = require('./ark-update-monitor.cjs');
const {
  collectResults,
  resolveChannel,
  panelPayload,
  apiExpected
} = require('./ark-staff-status-monitor-extension.cjs');
const {
  fetchAsaPatchNotes,
  fetchApiReleaseNotes,
  inspectApiCache
} = require('./ark-staff-update-panels-extension.cjs');
const { inspectArkApiLog } = require('./ark-api-log-diagnostic.cjs');
const { probeSftpState } = require('./ark-update-safety.cjs');
const { evaluateInstalled } = require('./ark-curseforge-mod-intelligence.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.staff.unified.ops.panel.extension');
const MARKER = 'Nexus Sentinal • ARK Unified Staff Ops • v1';
const OLD_MARKERS = new Set([
  'Nexus Sentinal • ARK Staff Status • v1',
  'Nexus Sentinal • ARK Staff Status • v2',
  'Nexus Sentinal • ARK ASA Update Status • v1',
  'Nexus Sentinal • ARK ASA Update Status • v2',
  'Nexus Sentinal • ARK API Update Status • v1',
  'Nexus Sentinal • ARK API Update Status • v2'
]);
const INITIAL_DELAY_MS = 5_000;

function clean(value, max = 650) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .slice(0, max);
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function markerOf(message) {
  return String(message?.embeds?.[0]?.footer?.text || '');
}

function aggregateAsa(results = []) {
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

function aggregateApi(results = [], release = {}) {
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

function notesValue(notes, url, publishedAt) {
  const parsed = Date.parse(publishedAt || '');
  const when = Number.isFinite(parsed) ? `<t:${Math.floor(parsed / 1000)}:f>` : 'unknown';
  return `${clean(notes, 600) || 'No release notes were supplied by the upstream source.'}\n\n**Published:** ${when}${url ? ` • [Full notes](${url})` : ''}`.slice(0, 1024);
}

async function addCacheState(results) {
  for (const item of results) {
    item.cache = { status: 'unknown', keyHash: '', generation: '' };
    if (!apiExpected(item.prefix)) continue;
    try { item.cache = await inspectApiCache(item.prefix); } catch {}
  }
  return results;
}

async function collectModIntelligence(results = []) {
  const all = [];
  for (const item of results) {
    try {
      const diagnostic = await inspectArkApiLog(item.prefix);
      const activeIds = [...new Set([...(diagnostic.modIds || []), ...(diagnostic.newest?.modIds || [])].map(String))];
      const sftp = await probeSftpState(item.prefix, activeIds);
      const evaluated = await evaluateInstalled(sftp.mods || []);
      for (const mod of evaluated.checked || []) all.push({ ...mod, prefix: item.prefix });
    } catch (error) {
      console.warn(`[Nexus Sentinal] CurseForge mod intelligence failed for ${item.prefix}: ${clean(error?.message || error, 180)}`);
    }
  }

  const byMod = new Map();
  for (const mod of all) {
    const key = String(mod.modId || '');
    if (!key) continue;
    const existing = byMod.get(key);
    if (!existing) {
      byMod.set(key, { ...mod, maps: new Set([mod.prefix]) });
      continue;
    }
    existing.maps.add(mod.prefix);
    if (mod.state === 'pending') existing.state = 'pending';
    else if (existing.state !== 'pending' && mod.state === 'unverified') existing.state = 'unverified';
    if (!existing.name && mod.name) existing.name = mod.name;
    if (!existing.latestFileId && mod.latestFileId) existing.latestFileId = mod.latestFileId;
    if (!existing.latestFileDate && mod.latestFileDate) existing.latestFileDate = mod.latestFileDate;
  }

  const checked = [...byMod.values()];
  const pending = checked.filter((item) => item.state === 'pending');
  const unverified = checked.filter((item) => item.state === 'unverified');
  const current = checked.filter((item) => item.state === 'current');
  return { checked, pending, unverified, current };
}

function modField(mods = {}) {
  const total = mods.checked?.length || 0;
  const current = mods.current?.length || 0;
  const pending = mods.pending?.length || 0;
  const unverified = mods.unverified?.length || 0;
  let state = '🟢 CURRENT';
  if (!total) state = '🟡 VERIFYING';
  else if (pending) state = '🟡 UPDATES AVAILABLE';
  else if (unverified) state = '🟡 PARTIALLY VERIFIED';

  const lines = [
    `**State:** ${state}`,
    `**Active:** ${total} • **Current:** ${current} • **Updates:** ${pending} • **Unverified:** ${unverified}`,
    '**Source:** CurseForge API • server/cross-platform file selection'
  ];
  if (pending) {
    lines.push('', '**Updates available:**');
    for (const mod of mods.pending.slice(0, 6)) {
      lines.push(`• **${clean(mod.name || `Mod ${mod.modId}`, 90)}** • \`${mod.fileId || '?'}\` → \`${mod.latestFileId || '?'}\``);
    }
    if (pending > 6) lines.push(`• …and ${pending - 6} more`);
  }
  if (unverified) lines.push('', `⚪ ${unverified} mod${unverified === 1 ? '' : 's'} could not be positively matched to a current CurseForge server file.`);
  return { name: '🧩 ASA Mods • CurseForge', value: lines.join('\n').slice(0, 1024), inline: false };
}

function unifiedPayload(results, patch, release, mods) {
  const rawHealth = panelPayload(results).embeds?.[0]?.fields || [];
  const health = rawHealth.map((field) => ({
    ...field,
    value: String(field.value || '').replace(/^• Mods:.*$/gmi, '').replace(/\n{3,}/g, '\n\n').trim()
  }));
  const asa = aggregateAsa(results);
  const api = aggregateApi(results, release);
  return {
    embeds: [{
      title: '🔒 KHAOS NEXUS • ARK STAFF OPERATIONS',
      description: 'One staff-only operational view: per-server health plus cluster-wide ASA, mod and ARK Server API status. Read-only monitoring only.',
      fields: [
        ...health,
        modField(mods),
        {
          name: '🦖 ARK: Survival Ascended • Cluster Update',
          value: `**State:** ${asa.state}\n**Installed server build:** \`${asa.installed}\`\n**Latest public build:** \`${asa.publicBuild}\`\n**ARK version:** \`${asa.runtime}\``,
          inline: false
        },
        {
          name: `📋 ASA Patch Notes • ${clean(patch.title || 'Latest update', 120)}`,
          value: notesValue(patch.notes, patch.url, patch.publishedAt),
          inline: false
        },
        {
          name: '⚙️ ARK Server API • Cluster Status',
          value: `**State:** ${api.state}\n**Installed API:** \`v${api.installed}\`\n**Latest API:** \`v${api.latest}\`\n**ASA compatibility:** ${api.compatibility}\n**Cache:** ${api.cacheState}\n**Cache key:** \`${api.cacheKey}\`\n**Generation:** \`${clean(api.generation, 80)}\``,
          inline: false
        },
        {
          name: `📋 API Release Notes • ${clean(release.title || 'ASA Server API', 120)}`,
          value: notesValue(release.notes, release.url, release.publishedAt),
          inline: false
        }
      ].slice(0, 25),
      footer: { text: MARKER },
      timestamp: new Date().toISOString()
    }],
    allowedMentions: { parse: [] }
  };
}

async function reconcile(channel, payload, botId) {
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const messages = recent?.values ? [...recent.values()] : [];
  const own = messages.filter((message) => String(message.author?.id || '') === String(botId || ''));
  const unified = own.filter((message) => markerOf(message) === MARKER).sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0));
  let target = unified[0] || null;
  if (target) await target.edit(payload);
  else target = await channel.send(payload);
  if (!target.pinned && typeof target.pin === 'function') await target.pin('Nexus Sentinal unified ARK staff operations').catch(() => {});
  for (const message of unified.slice(1)) await message.delete('Duplicate unified ARK staff panel').catch(() => {});
  for (const message of own) {
    if (!OLD_MARKERS.has(markerOf(message))) continue;
    await message.delete('Replaced by unified ARK staff operations embed').catch(() => {});
  }
  return target;
}

async function runCycle(client, config, reason = 'periodic') {
  const guildId = String(config.discord?.guildId || '');
  if (!guildId) return { skipped: 'guild-not-configured' };
  const guild = await client.guilds.fetch(guildId);
  const channel = await resolveChannel(guild);
  if (!channel) return { skipped: 'staff-channel-not-found' };
  const results = await addCacheState(await collectResults());
  const mods = await collectModIntelligence(results);
  const publicBuild = unique(results.map((item) => item.report?.game?.publicBuildId))[0] || '';
  let patch = { title: 'Patch notes unavailable', notes: '', url: '', publishedAt: '' };
  let release = { version: '', title: 'ASA Server API', notes: '', url: '', publishedAt: '' };
  try { patch = await fetchAsaPatchNotes(publicBuild); } catch (error) { patch.notes = `Patch-note lookup failed: ${clean(error?.message || error, 220)}`; }
  try { release = await fetchApiReleaseNotes(); } catch (error) { release.notes = `API release lookup failed: ${clean(error?.message || error, 220)}`; }
  await reconcile(channel, unifiedPayload(results, patch, release, mods), client.user?.id || '');
  console.log(`[Nexus Sentinal] unified ARK staff operations (${reason}): channel=${channel.name} servers=${results.length} mods=${mods.checked.length} modUpdates=${mods.pending.length}`);
  return { channelId: String(channel.id), serverCount: results.length, modCount: mods.checked.length, modUpdates: mods.pending.length };
}

function installArkStaffUnifiedOpsPanelExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function nexusArkStaffUnifiedOpsLogin(...args) {
    const client = this;
    client.once(Events.ClientReady, () => {
      const run = (reason) => void runCycle(client, config, reason).catch((error) => console.warn(`[Nexus Sentinal] unified ARK staff operations failed: ${clean(error?.message || error, 300)}`));
      const initial = setTimeout(() => run('startup'), INITIAL_DELAY_MS);
      initial.unref?.();
      const intervalMs = Math.max(5 * 60_000, monitorIntervalMinutes() * 60_000);
      const timer = setInterval(() => run('periodic'), intervalMs);
      timer.unref?.();
      console.log(`[Nexus Sentinal] unified ARK staff operations scheduled every ${Math.round(intervalMs / 60000)} minute(s).`);
    });
    return originalLogin.apply(this, args);
  };
}

module.exports = { MARKER, unifiedPayload, collectModIntelligence, runCycle, installArkStaffUnifiedOpsPanelExtension };
