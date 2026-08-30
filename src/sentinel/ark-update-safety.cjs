'use strict';

const path = require('node:path');
const SftpClient = require('ssh2-sftp-client');
const { sftpSettingsFromEnv } = require('./ark-sftp-config.cjs');
const { findDirectoryNamed, joinRemote } = require('./ark-sftp-discovery.cjs');
const { inspectArkApiLog } = require('./ark-api-log-diagnostic.cjs');

const ASA_APP_ID = '2430930';
const REMOTE_CACHE_MS = 5 * 60 * 1000;
const DEFAULT_CRITICAL_PLUGINS = Object.freeze(['ArkShop']);
const remoteCache = new Map();

function cleanVersion(value) {
  return String(value || '').trim().replace(/^v/i, '').replace(/[^0-9.].*$/, '');
}

function versionParts(value) {
  return cleanVersion(value).split('.').filter(Boolean).map((part) => Number(part) || 0);
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta) return delta < 0 ? -1 : 1;
  }
  return 0;
}

function parseSteamBuildId(text) {
  const match = String(text || '').match(/"buildid"\s+"?(\d+)"?/i);
  return match ? match[1] : '';
}

function latestLifecycleSegment(lines = []) {
  const list = Array.isArray(lines) ? lines.map(String) : [];
  let start = -1;
  for (let index = 0; index < list.length; index += 1) {
    if (/ARK:SA API\s+V?[0-9]/i.test(list[index])) start = index;
  }
  return start >= 0 ? list.slice(start) : list;
}

function analyzeApiDiagnostic(diagnostic = {}) {
  const lifecycle = latestLifecycleSegment(diagnostic.lifecycle || []);
  const joined = lifecycle.join('\n');
  const version = cleanVersion(joined.match(/ARK:SA API\s+V?([0-9]+(?:\.[0-9]+)*)/i)?.[1] || '');
  const offsetFailure = /failed to get the offset/i.test(joined);
  const apiLoaded = /API was successfully loaded/i.test(joined);
  const pluginsLoaded = /Loaded all plugins/i.test(joined);

  if (offsetFailure) {
    return { status: 'fail', version, apiLoaded, pluginsLoaded, offsetFailure, summary: 'ArkApi reported a missing offset on the latest detected startup.' };
  }
  if (apiLoaded && pluginsLoaded) {
    return { status: 'pass', version, apiLoaded, pluginsLoaded, offsetFailure: false, summary: 'ArkApi and its plugins completed startup.' };
  }
  if (!diagnostic.found) {
    return { status: 'unknown', version, apiLoaded, pluginsLoaded, offsetFailure: false, summary: diagnostic.reason || 'ArkApi log was not available.' };
  }
  return { status: 'unknown', version, apiLoaded, pluginsLoaded, offsetFailure: false, summary: 'ArkApi startup could not be positively verified from the available log.' };
}

function normalizePluginName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function pluginMatches(plugin, wanted) {
  const target = normalizePluginName(wanted);
  const candidates = [plugin.folder, plugin.fullName].map(normalizePluginName).filter(Boolean);
  if (target === 'arkshop') return candidates.some((value) => value === 'arkshop' || (value.includes('arkshop') && !value.includes('ui')));
  if (target.includes('permission')) return candidates.some((value) => value.includes('permission'));
  if (target.includes('extended') && target.includes('rcon')) return candidates.some((value) => value.includes('extended') && value.includes('rcon'));
  return candidates.some((value) => value === target || value.includes(target) || target.includes(value));
}

function criticalPluginNames() {
  const configured = String(process.env.ARK_UPDATE_CRITICAL_PLUGINS || '').split(',').map((value) => value.trim()).filter(Boolean);
  return configured.length ? configured.slice(0, 12) : [...DEFAULT_CRITICAL_PLUGINS];
}

function analyzePlugins(plugins = [], required = criticalPluginNames()) {
  if (!Array.isArray(plugins)) return { status: 'unknown', required, missing: required, installed: [] };
  const missing = required.filter((wanted) => !plugins.some((plugin) => pluginMatches(plugin, wanted)));
  return {
    status: missing.length ? 'fail' : 'pass',
    required,
    missing,
    installed: plugins.map((plugin) => ({ folder: plugin.folder, fullName: plugin.fullName, version: plugin.version }))
  };
}

function parseInstalledModFolders(entries = [], activeIds = []) {
  const active = new Set((activeIds || []).map(String));
  const byMod = new Map();
  for (const entry of entries || []) {
    if (!(entry?.type === 'd' || String(entry?.permissions || '').startsWith('d'))) continue;
    const match = String(entry.name || '').match(/^(\d{5,10})_(\d{4,14})$/);
    if (!match) continue;
    const modId = match[1];
    if (active.size && !active.has(modId)) continue;
    const candidate = { modId, fileId: match[2], modifiedAt: Number(entry.modifyTime || 0), folder: String(entry.name) };
    const existing = byMod.get(modId);
    if (!existing || candidate.modifiedAt > existing.modifiedAt || (candidate.modifiedAt === existing.modifiedAt && Number(candidate.fileId) > Number(existing.fileId))) {
      byMod.set(modId, candidate);
    }
  }
  return [...byMod.values()].sort((a, b) => Number(a.modId) - Number(b.modId));
}

function selectLatestCurseForgeFile(mod = {}) {
  const latestFiles = Array.isArray(mod.latestFiles) ? mod.latestFiles : [];
  const sorted = [...latestFiles].sort((a, b) => {
    const dateDelta = Date.parse(b.fileDate || '') - Date.parse(a.fileDate || '');
    if (Number.isFinite(dateDelta) && dateDelta) return dateDelta;
    return Number(b.id || 0) - Number(a.id || 0);
  });
  const file = sorted[0] || null;
  const id = String(file?.id || mod.mainFileId || '');
  return id ? { id, displayName: String(file?.displayName || ''), fileDate: String(file?.fileDate || '') } : null;
}

function evaluateVerdict({ server = {}, game = {}, api = {}, plugins = {}, mods = {} } = {}) {
  const blockers = [];
  const cautions = [];

  if (server.rcon === 'fail') blockers.push('Server RCON is not responding.');
  if (api.health === 'fail') blockers.push(api.healthSummary || 'ArkApi has a critical startup/offset failure.');
  if (plugins.status === 'fail') blockers.push(`Critical API plugin missing: ${plugins.missing.join(', ')}.`);

  if (game.updateAvailable === true) {
    if (api.health !== 'pass') blockers.push('A game update is pending but ArkApi health is not positively verified.');
    if (api.latestKnown && api.installedVersion && compareVersions(api.installedVersion, api.latestKnown) < 0) blockers.push(`ArkApi ${api.installedVersion} is behind ${api.latestKnown} while a game update is pending.`);
    if (mods.status === 'unknown') blockers.push('A game update is pending but mod freshness/compatibility is unknown.');
    if (mods.pendingCount > 0) blockers.push(`${mods.pendingCount} active mod update${mods.pendingCount === 1 ? '' : 's'} should be applied/verified before the game update.`);
  } else {
    if (api.health === 'unknown') cautions.push('ArkApi health could not be positively verified.');
    if (mods.status === 'unknown') cautions.push('CurseForge remote mod freshness is unavailable.');
    if (mods.pendingCount > 0) cautions.push(`${mods.pendingCount} active mod update${mods.pendingCount === 1 ? '' : 's'} detected.`);
  }

  if (api.latestKnown && api.installedVersion && compareVersions(api.installedVersion, api.latestKnown) < 0 && game.updateAvailable !== true) {
    cautions.push(`ArkApi update available: ${api.installedVersion} → ${api.latestKnown}.`);
  }
  if (game.updateAvailable === null || game.updateAvailable === undefined) cautions.push('Installed Steam build could not be compared with the public branch.');

  if (blockers.length) return { level: 'hold', label: '🔴 HOLD', blockers: [...new Set(blockers)], cautions: [...new Set(cautions)] };
  if (cautions.length) return { level: 'caution', label: '🟡 CAUTION', blockers: [], cautions: [...new Set(cautions)] };
  return { level: 'safe', label: '✅ SAFE', blockers: [], cautions: [] };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function cachedRemote(key, loader) {
  const cached = remoteCache.get(key);
  if (cached && Date.now() - cached.at < REMOTE_CACHE_MS) return cached.value;
  const value = await loader();
  remoteCache.set(key, { at: Date.now(), value });
  return value;
}

async function fetchPublicSteamBuild() {
  return cachedRemote('steam-build', async () => {
    const response = await fetchWithTimeout(`https://api.steamcmd.net/v1/info/${ASA_APP_ID}`, { headers: { 'user-agent': 'Khaos-Nexus-Sentinel/1.0' } });
    if (!response.ok) throw new Error(`Steam metadata HTTP ${response.status}`);
    const payload = await response.json();
    const app = payload?.data?.[ASA_APP_ID] || payload?.[ASA_APP_ID] || payload?.data || payload;
    const branch = app?.depots?.branches?.public || app?.branches?.public || {};
    const buildId = String(branch.buildid || branch.buildId || '');
    return { buildId, timeUpdated: Number(branch.timeupdated || branch.timeUpdated || 0) || null };
  });
}

async function fetchLatestAsaApiRelease() {
  return cachedRemote('asa-api-release', async () => {
    const response = await fetchWithTimeout('https://api.github.com/repos/ArkServerApi/AsaApi/releases/latest', {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'Khaos-Nexus-Sentinel/1.0' }
    });
    if (!response.ok) throw new Error(`GitHub release HTTP ${response.status}`);
    const payload = await response.json();
    return {
      version: cleanVersion(payload.tag_name || payload.name || ''),
      publishedAt: String(payload.published_at || ''),
      url: String(payload.html_url || '')
    };
  });
}

async function readPluginInfo(client, pluginsDir, entry) {
  const folder = String(entry?.name || '');
  const file = joinRemote(joinRemote(pluginsDir, folder), 'PluginInfo.json');
  try {
    const exists = await client.exists(file);
    if (!exists || exists === 'd') return { folder, fullName: folder, version: '' };
    const stat = await client.stat(file);
    if (Number(stat?.size || 0) > 64 * 1024) return { folder, fullName: folder, version: '' };
    const bytes = await client.get(file);
    const parsed = JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes || ''));
    return { folder, fullName: String(parsed.FullName || folder).slice(0, 120), version: String(parsed.Version ?? '').slice(0, 40) };
  } catch {
    return { folder, fullName: folder, version: '' };
  }
}

async function probeSftpState(prefix, activeModIds = []) {
  const settings = sftpSettingsFromEnv(prefix);
  if (!settings.host || !settings.username || !settings.password) throw new Error('ARK SFTP variables are incomplete.');
  const client = new SftpClient('khaos-nexus-update-safety');
  await client.connect({ host: settings.host, port: settings.port, username: settings.username, password: settings.password, readyTimeout: settings.readyTimeout });
  try {
    const shooterGame = await findDirectoryNamed(client, {
      starts: [settings.root || '.', '.'], directoryName: 'ShooterGame', maxDepth: 4, maxDirectories: 100, maxEntries: 1500
    });
    if (!shooterGame) throw new Error('ShooterGame directory was not found through SFTP.');

    const installRoot = path.posix.dirname(shooterGame.path);
    const configuredManifest = String(process.env[`${prefix}_STEAM_APP_MANIFEST_PATH`] || '').trim();
    const manifestCandidates = [
      configuredManifest,
      joinRemote(settings.root || '.', `appmanifest_${ASA_APP_ID}.acf`),
      joinRemote(settings.root || '.', `steamapps/appmanifest_${ASA_APP_ID}.acf`),
      joinRemote(installRoot, `appmanifest_${ASA_APP_ID}.acf`),
      joinRemote(installRoot, `steamapps/appmanifest_${ASA_APP_ID}.acf`),
      joinRemote(path.posix.dirname(installRoot), `steamapps/appmanifest_${ASA_APP_ID}.acf`)
    ].filter(Boolean);

    let localBuildId = '';
    let manifestPath = '';
    for (const candidate of [...new Set(manifestCandidates)]) {
      try {
        const exists = await client.exists(candidate);
        if (!exists || exists === 'd') continue;
        const stat = await client.stat(candidate);
        if (Number(stat?.size || 0) > 512 * 1024) continue;
        const bytes = await client.get(candidate);
        const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes || '');
        localBuildId = parseSteamBuildId(text);
        manifestPath = candidate;
        if (localBuildId) break;
      } catch {}
    }

    const pluginsDir = joinRemote(shooterGame.path, 'Binaries/Win64/ArkApi/Plugins');
    let plugins = null;
    try {
      const entries = (await client.list(pluginsDir)).filter((entry) => entry?.type === 'd' || String(entry?.permissions || '').startsWith('d')).slice(0, 80);
      plugins = [];
      for (const entry of entries) plugins.push(await readPluginInfo(client, pluginsDir, entry));
    } catch {}

    const modsDir = joinRemote(shooterGame.path, 'Binaries/Win64/ShooterGame/Mods/83374');
    let mods = [];
    try { mods = parseInstalledModFolders(await client.list(modsDir), activeModIds); } catch {}

    return { shooterGameRoot: shooterGame.path, localBuildId, manifestPath, plugins, mods };
  } finally {
    await client.end().catch(() => {});
  }
}

async function fetchCurseForgeFreshness(installedMods = []) {
  if (!installedMods.length) return { status: 'pass', source: 'none', pending: [], checked: [] };
  const apiKey = String(process.env.CURSEFORGE_API_KEY || '').trim();
  if (!apiKey) return { status: 'unknown', source: 'curseforge-key-missing', pending: [], checked: installedMods.map((mod) => ({ ...mod, latestFileId: '' })) };

  const ids = installedMods.map((mod) => Number(mod.modId)).filter(Number.isFinite);
  const response = await fetchWithTimeout('https://api.curseforge.com/v1/mods', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'x-api-key': apiKey, 'user-agent': 'Khaos-Nexus-Sentinel/1.0' },
    body: JSON.stringify({ modIds: ids, filterPcOnly: false })
  }, 12000);
  if (!response.ok) throw new Error(`CurseForge metadata HTTP ${response.status}`);
  const payload = await response.json();
  const remote = new Map((payload?.data || []).map((mod) => [String(mod.id), mod]));
  const checked = installedMods.map((installed) => {
    const mod = remote.get(String(installed.modId));
    const latest = selectLatestCurseForgeFile(mod || {});
    return {
      ...installed,
      name: String(mod?.name || `Mod ${installed.modId}`).slice(0, 120),
      latestFileId: String(latest?.id || ''),
      latestFileDate: String(latest?.fileDate || ''),
      pending: Boolean(latest?.id) && String(latest.id) !== String(installed.fileId)
    };
  });
  const unresolved = checked.filter((item) => !item.latestFileId);
  const pending = checked.filter((item) => item.pending);
  return { status: unresolved.length ? 'unknown' : 'pass', source: 'curseforge-api', pending, checked };
}

async function collectArkUpdateSafety({ prefix = 'ARK_GEN1', rcon = null } = {}) {
  const checkedAt = new Date().toISOString();
  let rconStatus = 'unknown';
  let rconMessage = '';
  if (rcon?.execute) {
    try {
      const result = await rcon.execute('ListPlayers');
      rconStatus = 'pass';
      rconMessage = String(result || 'No players connected.').slice(0, 300);
    } catch (error) {
      rconStatus = 'fail';
      rconMessage = String(error?.message || error).slice(0, 300);
    }
  }

  let diagnostic = { found: false, reason: 'Not checked' };
  try { diagnostic = await inspectArkApiLog(prefix); } catch (error) { diagnostic = { found: false, reason: String(error?.message || error).slice(0, 300) }; }
  const apiHealth = analyzeApiDiagnostic(diagnostic);
  const activeModIds = [...new Set([...(diagnostic.modIds || []), ...(diagnostic.newest?.modIds || [])].map(String))];
  const runtimeVersion = cleanVersion(diagnostic.version || diagnostic.newest?.version || '');

  let sftp = { localBuildId: '', manifestPath: '', plugins: null, mods: [] };
  let sftpError = '';
  try { sftp = await probeSftpState(prefix, activeModIds); } catch (error) { sftpError = String(error?.message || error).slice(0, 300); }

  let steam = { buildId: '', timeUpdated: null };
  let steamError = '';
  try { steam = await fetchPublicSteamBuild(); } catch (error) { steamError = String(error?.message || error).slice(0, 300); }

  let latestApi = { version: '', publishedAt: '', url: '' };
  let apiReleaseError = '';
  try { latestApi = await fetchLatestAsaApiRelease(); } catch (error) { apiReleaseError = String(error?.message || error).slice(0, 300); }

  let modFreshness;
  let modError = '';
  try { modFreshness = await fetchCurseForgeFreshness(sftp.mods || []); }
  catch (error) {
    modError = String(error?.message || error).slice(0, 300);
    modFreshness = { status: 'unknown', source: 'curseforge-error', pending: [], checked: sftp.mods || [] };
  }

  const gameUpdateAvailable = sftp.localBuildId && steam.buildId ? String(sftp.localBuildId) !== String(steam.buildId) : null;
  const plugins = analyzePlugins(sftp.plugins);
  const api = {
    health: apiHealth.status,
    healthSummary: apiHealth.summary,
    installedVersion: apiHealth.version,
    latestKnown: latestApi.version,
    updateAvailable: Boolean(apiHealth.version && latestApi.version && compareVersions(apiHealth.version, latestApi.version) < 0),
    offsetFailure: apiHealth.offsetFailure,
    releasePublishedAt: latestApi.publishedAt,
    releaseUrl: latestApi.url,
    error: apiReleaseError
  };
  const mods = {
    status: modFreshness.status,
    source: modFreshness.source,
    activeCount: activeModIds.length || (sftp.mods || []).length,
    installedCount: (sftp.mods || []).length,
    pendingCount: modFreshness.pending.length,
    pending: modFreshness.pending.slice(0, 12),
    error: modError
  };
  const game = {
    runtimeVersion,
    installedBuildId: sftp.localBuildId,
    publicBuildId: steam.buildId,
    updateAvailable: gameUpdateAvailable,
    publicBuildUpdatedAt: steam.timeUpdated ? new Date(steam.timeUpdated * 1000).toISOString() : '',
    manifestFound: Boolean(sftp.manifestPath),
    error: steamError || sftpError
  };
  const server = { rcon: rconStatus, rconMessage };
  const verdict = evaluateVerdict({ server, game, api, plugins, mods });

  return { checkedAt, verdict, server, game, api, plugins, mods, diagnostics: { sftpError, steamError, apiReleaseError, modError } };
}

function statusIcon(status) {
  if (status === 'pass') return '✅';
  if (status === 'fail') return '❌';
  return '⚪';
}

function formatArkUpdateSafety(report = {}, serverName = 'ARK') {
  const { verdict = {}, server = {}, game = {}, api = {}, plugins = {}, mods = {} } = report;
  const gameUpdate = game.updateAvailable === true ? `⚠️ Pending (${game.installedBuildId || '?'} → ${game.publicBuildId || '?'})`
    : game.updateAvailable === false ? `✅ Current (${game.installedBuildId || '?'})`
      : '⚪ Unknown (Steam manifest not exposed)';
  const apiVersion = api.installedVersion || '?';
  const apiLatest = api.latestKnown || '?';
  const modLine = mods.status === 'unknown'
    ? `⚪ ${mods.installedCount || mods.activeCount || 0} detected • remote freshness unavailable${mods.source === 'curseforge-key-missing' ? ' (CurseForge API key not configured)' : ''}`
    : mods.pendingCount > 0
      ? `⚠️ ${mods.pendingCount} update${mods.pendingCount === 1 ? '' : 's'} pending / ${mods.installedCount || mods.activeCount || 0} checked`
      : `✅ ${mods.installedCount || mods.activeCount || 0} active mods current`;

  const lines = [
    `## ${verdict.label || '⚪ UNKNOWN'} — ${serverName} Update Safety`,
    '',
    `**Server health:** ${server.rcon === 'pass' ? '🟢 RCON responding' : server.rcon === 'fail' ? '🔴 RCON failed' : '⚪ Unknown'}`,
    `**ASA runtime:** ${game.runtimeVersion ? `v${game.runtimeVersion}` : 'Unknown'}`,
    `**ASA server update:** ${gameUpdate}`,
    `**ASA Server API:** ${statusIcon(api.health)} installed ${apiVersion} • latest ${apiLatest}${api.updateAvailable ? ' • update available' : ''}`,
    `**Critical plugins:** ${plugins.status === 'pass' ? '✅ Healthy/present' : plugins.status === 'fail' ? `❌ Missing ${plugins.missing.join(', ')}` : '⚪ Unknown'}`,
    `**CurseForge mods:** ${modLine}`,
  ];

  if (mods.pendingCount > 0) {
    lines.push('', '**Pending mod updates:**');
    for (const mod of mods.pending.slice(0, 8)) lines.push(`• ${mod.name || `Mod ${mod.modId}`}: ${mod.fileId} → ${mod.latestFileId}`);
  }
  if (verdict.blockers?.length) {
    lines.push('', '**Why Sentinel says HOLD:**');
    for (const reason of verdict.blockers.slice(0, 6)) lines.push(`• ${reason}`);
  }
  if (verdict.cautions?.length) {
    lines.push('', '**Cautions:**');
    for (const reason of verdict.cautions.slice(0, 6)) lines.push(`• ${reason}`);
  }
  lines.push('', verdict.level === 'safe' ? '**Recommendation:** Safe to proceed based on all checks Sentinel can verify.'
    : verdict.level === 'hold' ? '**Recommendation:** Do **not** press the Citadel update button yet.'
      : '**Recommendation:** Review the unknown/pending items before updating.');
  lines.push(`_Checked ${report.checkedAt ? `<t:${Math.floor(Date.parse(report.checkedAt) / 1000)}:R>` : 'now'} • advisory only; Sentinel will never press Update automatically._`);
  return lines.join('\n').slice(0, 3900);
}

module.exports = {
  ASA_APP_ID,
  DEFAULT_CRITICAL_PLUGINS,
  cleanVersion,
  compareVersions,
  parseSteamBuildId,
  latestLifecycleSegment,
  analyzeApiDiagnostic,
  normalizePluginName,
  pluginMatches,
  analyzePlugins,
  parseInstalledModFolders,
  selectLatestCurseForgeFile,
  evaluateVerdict,
  fetchPublicSteamBuild,
  fetchLatestAsaApiRelease,
  fetchCurseForgeFreshness,
  probeSftpState,
  collectArkUpdateSafety,
  formatArkUpdateSafety
};
