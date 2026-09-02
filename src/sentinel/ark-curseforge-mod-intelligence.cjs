'use strict';

const CURSEFORGE_BASE = 'https://api.curseforge.com/v1';
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();

function apiKey(env = process.env) {
  return String(env.CURSEFORGE_API_KEY || '').trim();
}

function headers(env = process.env) {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-api-key': apiKey(env),
    'user-agent': 'Khaos-Nexus-Sentinel/1.0'
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function cached(key, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await loader();
  cache.set(key, { at: Date.now(), value });
  return value;
}

function releaseRank(value) {
  const n = Number(value || 0);
  if (n === 1) return 3;
  if (n === 2) return 2;
  if (n === 3) return 1;
  return 0;
}

function selectServerCompatibleFile(mod = {}) {
  const files = Array.isArray(mod.latestFiles) ? mod.latestFiles : [];
  const indexes = Array.isArray(mod.latestFilesIndexes) ? mod.latestFilesIndexes : [];
  const indexedIds = new Set(indexes.map((item) => String(item?.fileId || '')).filter(Boolean));
  let candidates = indexedIds.size ? files.filter((file) => indexedIds.has(String(file?.id || ''))) : files;
  if (!candidates.length && mod.mainFileId) candidates = files.filter((file) => String(file?.id || '') === String(mod.mainFileId));
  if (!candidates.length && mod.mainFileId) return { id: String(mod.mainFileId), displayName: '', fileDate: '', releaseType: 0 };
  candidates = [...candidates].sort((a, b) => {
    const rank = releaseRank(b?.releaseType) - releaseRank(a?.releaseType);
    if (rank) return rank;
    const dateDelta = Date.parse(b?.fileDate || '') - Date.parse(a?.fileDate || '');
    if (Number.isFinite(dateDelta) && dateDelta) return dateDelta;
    return Number(b?.id || 0) - Number(a?.id || 0);
  });
  const file = candidates[0] || null;
  return file ? {
    id: String(file.id || ''),
    displayName: String(file.displayName || file.fileName || ''),
    fileDate: String(file.fileDate || ''),
    releaseType: Number(file.releaseType || 0)
  } : null;
}

async function fetchMods(modIds = [], env = process.env) {
  const key = apiKey(env);
  if (!key) return { ok: false, reason: 'curseforge-key-missing', mods: [] };
  const ids = [...new Set(modIds.map(Number).filter(Number.isFinite))];
  if (!ids.length) return { ok: true, reason: 'none', mods: [] };
  return cached(`mods:${ids.sort((a, b) => a - b).join(',')}`, async () => {
    const response = await fetchWithTimeout(`${CURSEFORGE_BASE}/mods`, {
      method: 'POST',
      headers: headers(env),
      body: JSON.stringify({ modIds: ids, filterPcOnly: false })
    });
    if (!response.ok) throw new Error(`CurseForge metadata HTTP ${response.status}`);
    const payload = await response.json();
    return { ok: true, reason: 'curseforge-api', mods: Array.isArray(payload?.data) ? payload.data : [] };
  });
}

async function fetchChangelog(modId, fileId, env = process.env) {
  if (!apiKey(env) || !modId || !fileId) return '';
  return cached(`changelog:${modId}:${fileId}`, async () => {
    const response = await fetchWithTimeout(`${CURSEFORGE_BASE}/mods/${encodeURIComponent(modId)}/files/${encodeURIComponent(fileId)}/changelog`, {
      headers: headers(env)
    });
    if (!response.ok) return '';
    const payload = await response.json();
    return String(payload?.data || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/\r/g, '').trim().slice(0, 1800);
  });
}

async function evaluateInstalled(installedMods = [], env = process.env) {
  const lookup = await fetchMods(installedMods.map((item) => item.modId), env);
  if (!lookup.ok) return {
    status: 'unknown', source: lookup.reason, checked: installedMods.map((item) => ({ ...item, state: 'unverified' })),
    current: [], pending: [], unverified: installedMods
  };
  const remote = new Map(lookup.mods.map((mod) => [String(mod.id), mod]));
  const checked = [];
  for (const installed of installedMods) {
    const mod = remote.get(String(installed.modId));
    const latest = mod ? selectServerCompatibleFile(mod) : null;
    const latestFileId = String(latest?.id || '');
    const state = !mod || !latestFileId ? 'unverified' : String(installed.fileId) === latestFileId ? 'current' : 'pending';
    checked.push({
      ...installed,
      name: String(mod?.name || `Mod ${installed.modId}`).slice(0, 120),
      slug: String(mod?.slug || ''),
      latestFileId,
      latestFileDate: String(latest?.fileDate || ''),
      latestDisplayName: String(latest?.displayName || ''),
      state
    });
  }
  const current = checked.filter((item) => item.state === 'current');
  const pending = checked.filter((item) => item.state === 'pending');
  const unverified = checked.filter((item) => item.state === 'unverified');
  return {
    status: unverified.length ? 'partial' : 'pass',
    source: 'curseforge-api',
    checked,
    current,
    pending,
    unverified
  };
}

module.exports = {
  CURSEFORGE_BASE,
  apiKey,
  selectServerCompatibleFile,
  fetchMods,
  fetchChangelog,
  evaluateInstalled
};
