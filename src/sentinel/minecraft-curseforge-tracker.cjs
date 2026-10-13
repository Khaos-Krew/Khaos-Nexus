'use strict';

// Minecraft CurseForge file tracker.
// Polls /v1/mods/{id}/files for tracked Minecraft projects (gameId 432) and posts
// one embed per new file to CURSEFORGE_TRACKER_CHANNEL_ID. Disabled unless
// CURSEFORGE_API_KEY, CURSEFORGE_TRACKED_PROJECTS and CURSEFORGE_TRACKER_CHANNEL_ID
// are all set. The first successful poll of a project seeds its existing files
// without posting. Projects still pending moderation (404 / empty) are skipped quietly.

const fs = require('node:fs');
const path = require('node:path');

const API_BASE = 'https://api.curseforge.com';
const MINECRAFT_GAME_ID = 432;
const DEFAULT_INTERVAL_MINUTES = 15;
const MIN_INTERVAL_MINUTES = 5;
const RELEASE_TYPES = { 1: 'Release', 2: 'Beta', 3: 'Alpha' };
const RELEASE_COLORS = { 1: 0x2ecc71, 2: 0x3498db, 3: 0xe67e22 };
const LOADERS = ['NeoForge', 'Forge', 'Fabric', 'Quilt', 'LiteLoader', 'Rift'];
const MAX_POSTS_PER_PROJECT_PER_POLL = 5;

function clean(value) {
  return String(value ?? '').trim();
}

function parseTrackedProjects(raw) {
  const seen = new Set();
  const out = [];
  for (const part of clean(raw).split(/[\s,]+/)) {
    const value = part.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(/^\d+$/.test(value) ? { id: Number(value) } : { slug: key });
  }
  return out;
}

function trackerConfig(env = process.env) {
  const apiKey = clean(env.CURSEFORGE_API_KEY);
  const projects = parseTrackedProjects(env.CURSEFORGE_TRACKED_PROJECTS);
  const channelId = clean(env.CURSEFORGE_TRACKER_CHANNEL_ID);
  const missing = [];
  if (!apiKey) missing.push('CURSEFORGE_API_KEY');
  if (!projects.length) missing.push('CURSEFORGE_TRACKED_PROJECTS');
  if (!/^\d{15,22}$/.test(channelId)) missing.push('CURSEFORGE_TRACKER_CHANNEL_ID');
  const minutes = Number(env.CURSEFORGE_TRACKER_INTERVAL_MINUTES || DEFAULT_INTERVAL_MINUTES);
  const intervalMinutes = Number.isFinite(minutes) ? Math.max(MIN_INTERVAL_MINUTES, minutes) : DEFAULT_INTERVAL_MINUTES;
  return { enabled: missing.length === 0, missing, apiKey, projects, channelId, intervalMs: intervalMinutes * 60_000, intervalMinutes };
}

function stateFilePath(env = process.env) {
  const root = env.NEXUS_DATA_DIR ? path.resolve(env.NEXUS_DATA_DIR) : path.resolve(__dirname, '../..', 'data');
  return path.join(root, 'minecraft-curseforge-tracker.json');
}

function loadState(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.projects && typeof parsed.projects === 'object') return parsed;
  } catch {}
  return { version: 1, projects: {} };
}

function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

class CurseForgeHttpError extends Error {
  constructor(status, url) {
    super(`CurseForge HTTP ${status} for ${url.replace(API_BASE, '')}`);
    this.status = status;
  }
}

function createApi({ apiKey, fetchImpl = globalThis.fetch }) {
  const get = async (pathname, query = {}) => {
    const url = new URL(pathname, API_BASE);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    const response = await fetchImpl(url.toString(), { headers: { Accept: 'application/json', 'x-api-key': apiKey } });
    if (!response.ok) throw new CurseForgeHttpError(response.status, url.toString());
    return response.json();
  };
  return {
    async getMod(id) {
      return (await get(`/v1/mods/${id}`))?.data || null;
    },
    async findBySlug(slug) {
      const body = await get('/v1/mods/search', { gameId: MINECRAFT_GAME_ID, slug, pageSize: 5 });
      return (body?.data || []).find((mod) => clean(mod.slug).toLowerCase() === slug) || null;
    },
    async getFiles(id) {
      const body = await get(`/v1/mods/${id}/files`, { pageSize: 50, index: 0 });
      return Array.isArray(body?.data) ? body.data : [];
    },
    async getChangelog(modId, fileId) {
      return clean((await get(`/v1/mods/${modId}/files/${fileId}/changelog`))?.data);
    }
  };
}

function htmlToText(html) {
  return clean(html)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d|div)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function changelogExcerpt(html, max = 400) {
  const text = htmlToText(html);
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function splitVersions(gameVersions = []) {
  const loaders = [];
  const versions = [];
  for (const raw of gameVersions) {
    const value = clean(raw);
    const loader = LOADERS.find((name) => name.toLowerCase() === value.toLowerCase());
    if (loader) loaders.push(loader);
    else if (/^\d+\.\d+/.test(value)) versions.push(value);
  }
  return { loaders, versions };
}

function projectUrl(mod) {
  if (mod?.links?.websiteUrl) return mod.links.websiteUrl;
  return `https://www.curseforge.com/minecraft/mc-mods/${mod?.slug || mod?.id}`;
}

function fileUrl(mod, file) {
  return `${projectUrl(mod).replace(/\/$/, '')}/files/${file.id}`;
}

function buildFileEmbed(mod, file, changelogHtml = '') {
  const { loaders, versions } = splitVersions(file.gameVersions);
  const releaseType = RELEASE_TYPES[file.releaseType] || 'Release';
  const download = fileUrl(mod, file);
  const fields = [
    { name: 'Release type', value: releaseType, inline: true },
    { name: 'Minecraft', value: versions.join(', ') || 'Unknown', inline: true },
    { name: 'Loader', value: loaders.join(', ') || 'Unknown', inline: true }
  ];
  const excerpt = changelogExcerpt(changelogHtml);
  if (excerpt) fields.push({ name: 'Changelog', value: excerpt.slice(0, 1024), inline: false });
  fields.push({ name: 'Download', value: `<${download}>`, inline: false });
  const embed = {
    title: `${mod.name}: ${clean(file.displayName) || clean(file.fileName)}`.slice(0, 256),
    url: download,
    color: RELEASE_COLORS[file.releaseType] || RELEASE_COLORS[1],
    author: { name: mod.name, url: projectUrl(mod) },
    description: `New ${releaseType} file on CurseForge.`,
    fields,
    footer: { text: 'CurseForge file tracker' }
  };
  if (file.fileDate) embed.timestamp = new Date(file.fileDate).toISOString();
  const logo = mod?.logo?.thumbnailUrl || mod?.logo?.url;
  if (logo) {
    embed.thumbnail = { url: logo };
    embed.author.icon_url = logo;
  }
  return embed;
}

// One poll over every tracked project. Returns a summary; never throws for
// per-project failures.
async function pollOnce({ config, api, state, post, log = console }) {
  const summary = { posted: 0, seeded: 0, pending: 0, errors: 0 };
  for (const project of config.projects) {
    const key = project.id ? String(project.id) : `slug:${project.slug}`;
    try {
      let mod = null;
      try {
        mod = project.id ? await api.getMod(project.id) : await api.findBySlug(project.slug);
      } catch (error) {
        if (error?.status !== 404) throw error;
      }
      if (!mod || (mod.gameId && mod.gameId !== MINECRAFT_GAME_ID)) {
        // Pending moderation: nothing public exists yet, so mark it seeded and
        // the first approved files will be announced.
        if (!state.projects[key]) state.projects[key] = { seeded: true, postedFileIds: [] };
        summary.pending += 1;
        continue;
      }
      let files = [];
      try {
        files = await api.getFiles(mod.id);
      } catch (error) {
        if (error?.status !== 404) throw error;
      }
      const entry = state.projects[key] || { seeded: false, postedFileIds: [] };
      const known = new Set(entry.postedFileIds.map(Number));
      if (!files.length) {
        if (!state.projects[key]) state.projects[key] = { seeded: true, postedFileIds: [], name: mod.name };
        summary.pending += 1;
        continue;
      }
      if (!entry.seeded) {
        for (const file of files) known.add(Number(file.id));
        entry.seeded = true;
        entry.postedFileIds = [...known];
        entry.name = mod.name;
        state.projects[key] = entry;
        summary.seeded += files.length;
        log.log?.(`[Nexus Sentinal] CurseForge tracker seeded ${mod.name} (${mod.id}): files=${files.length}`);
        continue;
      }
      const fresh = files
        .filter((file) => !known.has(Number(file.id)))
        .sort((a, b) => new Date(a.fileDate || 0) - new Date(b.fileDate || 0) || a.id - b.id)
        .slice(-MAX_POSTS_PER_PROJECT_PER_POLL);
      for (const file of fresh) {
        let changelog = '';
        try { changelog = await api.getChangelog(mod.id, file.id); } catch {}
        await post({ embeds: [buildFileEmbed(mod, file, changelog)] });
        known.add(Number(file.id));
        summary.posted += 1;
      }
      // Anything older that was skipped by the per-poll cap is marked known too.
      for (const file of files) known.add(Number(file.id));
      entry.postedFileIds = [...known].slice(-500);
      entry.name = mod.name;
      state.projects[key] = entry;
    } catch (error) {
      summary.errors += 1;
      log.warn?.(`[Nexus Sentinal] CurseForge tracker ${key} failed: ${String(error?.message || error).slice(0, 240)}`);
    }
  }
  return summary;
}

const INSTALLED = Symbol.for('nexus.sentinal.minecraftCurseForgeTracker.installed');
let owner = null;

function installMinecraftCurseForgeTracker({ env = process.env, Client, Events } = {}) {
  if (!Client) ({ Client, Events } = require('discord.js'));
  const config = trackerConfig(env);
  if (!config.enabled) {
    console.log(`[Nexus Sentinal] CurseForge tracker disabled: missing ${config.missing.join(', ')}`);
    return false;
  }
  if (Client.prototype[INSTALLED]) return true;
  Client.prototype[INSTALLED] = true;
  const file = stateFilePath(env);
  console.log(`[Nexus Sentinal] CurseForge tracker enabled: projects=${config.projects.map((p) => p.id || p.slug).join(',')} channel=${config.channelId} interval=${config.intervalMinutes}m state=${file}`);
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function nexusCurseForgeTrackerLogin(...args) {
    const client = this;
    client.once(Events.ClientReady, async () => {
      if (owner) return;
      let channel = null;
      try { channel = await client.channels.fetch(config.channelId); } catch {}
      if (!channel || typeof channel.send !== 'function' || owner) return;
      owner = client;
      const api = createApi({ apiKey: config.apiKey });
      let busy = false;
      const run = async () => {
        if (busy) return;
        busy = true;
        try {
          const state = loadState(file);
          const summary = await pollOnce({ config, api, state, post: (payload) => channel.send(payload) });
          saveState(file, state);
          if (summary.posted || summary.errors) {
            console.log(`[Nexus Sentinal] CurseForge tracker poll: posted=${summary.posted} seeded=${summary.seeded} pending=${summary.pending} errors=${summary.errors}`);
          }
        } catch (error) {
          console.warn(`[Nexus Sentinal] CurseForge tracker poll failed: ${String(error?.message || error).slice(0, 240)}`);
        } finally {
          busy = false;
        }
      };
      const starter = setTimeout(() => void run(), 30_000);
      starter.unref?.();
      const timer = setInterval(() => void run(), config.intervalMs);
      timer.unref?.();
    });
    return originalLogin.apply(this, args);
  };
  return true;
}

module.exports = {
  MINECRAFT_GAME_ID,
  parseTrackedProjects,
  trackerConfig,
  stateFilePath,
  loadState,
  saveState,
  createApi,
  changelogExcerpt,
  splitVersions,
  buildFileEmbed,
  pollOnce,
  installMinecraftCurseForgeTracker
};
