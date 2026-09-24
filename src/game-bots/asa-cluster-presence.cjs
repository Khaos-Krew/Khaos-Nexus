'use strict';

const path = require('node:path');
const { MessageFlags } = require('discord.js');
const { readJson, runtimeDataDir, writeJson } = require('./panel-message.cjs');
const { errorClass } = require('./command-failure.cjs');

const UNOFFICIAL_LIST_URL = 'https://cdn2.arkdedicated.com/servers/asa/unofficialserverlist.json';
const MAX_LIST_BYTES = 80 * 1024 * 1024;
const DEFAULT_TTL_MS = 10 * 60 * 1000;

function publicText(value, max = 80) {
  return String(value ?? '')
    .replace(/\b[0-9a-f]{32}\b/gi, '')
    .replace(/[\r\n\u0000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function parseSessionAllowlist(env = process.env) {
  const ids = [];
  const seen = new Set();
  for (const part of String(env.ASCENDED_SESSION_IDS || '').split(/[,\s]+/)) {
    const id = part.trim();
    if (!/^[A-Za-z0-9:_-]{6,80}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function sessionIdOf(server) {
  return String(server?.SessionID || server?.SessionId || server?.sessionId || '').trim();
}

function publicServer(server) {
  const players = Number(server?.players ?? server?.NumPlayers ?? server?.Players ?? server?.currentPlayers);
  const max = Number(server?.maxPlayers ?? server?.MaxPlayers ?? server?.MaxPlayerNum);
  const day = server?.day ?? server?.DayTime ?? server?.Day ?? server?.Time ?? server?.SessionTime ?? '';
  const playerCount = server?.players == null && server?.NumPlayers == null && server?.Players == null && server?.currentPlayers == null
    ? null
    : (Number.isFinite(players) ? Math.max(0, Math.round(players)) : null);
  const maxCount = server?.maxPlayers == null && server?.MaxPlayers == null && server?.MaxPlayerNum == null
    ? null
    : (Number.isFinite(max) ? Math.max(0, Math.round(max)) : null);
  return {
    name: publicText(server?.name || server?.SessionName || server?.Name || server?.ServerName || 'Nexus server', 80) || 'Nexus server',
    map: publicText(server?.map || server?.MapName || server?.Map || server?.SessionMap || 'Unknown map', 60) || 'Unknown map',
    players: playerCount,
    maxPlayers: maxCount,
    day: publicText(day, 40)
  };
}

function clusterEmbed(servers, { stale = false, fetchedAt = '' } = {}) {
  const lines = (servers || []).map((server) => {
    const count = server.players == null ? 'players unavailable' : `${server.players}/${server.maxPlayers ?? '?'}`;
    const day = server.day ? ` · day ${server.day}` : '';
    return `**${server.name}**\n${server.map} · ${count}${day}`;
  });
  const when = fetchedAt ? fetchedAt.slice(0, 19) : 'unfetched';
  return {
    title: 'Nexus Cluster',
    description: lines.join('\n\n').slice(0, 4000) || 'No allowlisted sessions are in the cache yet.',
    footer: { text: `Wildcard CDN unofficial list • SessionID allowlist • ${stale ? 'stale cache' : 'cached'} ${when}` }
  };
}

function cacheTtl(env = process.env) {
  const raw = Number(env.ASCENDED_CLUSTER_CACHE_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TTL_MS;
  return Math.max(60_000, Math.min(60 * 60_000, Math.round(raw)));
}

function asServerArray(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.servers)) return body.servers;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

class SessionListCache {
  constructor({ file, fetchImpl = globalThis.fetch, ttlMs = DEFAULT_TTL_MS, now = () => Date.now(), url = UNOFFICIAL_LIST_URL } = {}) {
    this.file = file;
    this.fetchImpl = fetchImpl;
    this.ttlMs = Math.max(1000, Number(ttlMs) || DEFAULT_TTL_MS);
    this.now = now;
    this.url = url;
    this.pending = null;
  }

  read() {
    const parsed = readJson(this.file, null);
    if (!parsed || !Array.isArray(parsed.servers)) return null;
    return {
      etag: String(parsed.etag || ''),
      fetchedAt: String(parsed.fetchedAt || ''),
      fetchedAtMs: Number(parsed.fetchedAtMs) || 0,
      servers: parsed.servers.map((server) => publicServer(server))
    };
  }

  write(snapshot) {
    writeJson(this.file, {
      etag: String(snapshot.etag || ''),
      fetchedAt: snapshot.fetchedAt,
      fetchedAtMs: snapshot.fetchedAtMs,
      servers: snapshot.servers
    });
  }

  fresh(snapshot) {
    return Boolean(snapshot) && this.now() - snapshot.fetchedAtMs < this.ttlMs;
  }

  async load(sessionIds) {
    const allow = [...new Set((sessionIds || []).map((id) => String(id)))].filter(Boolean);
    const cached = this.read();
    if (!allow.length) return { servers: [], fetched: false, stale: false, reason: 'allowlist-empty', fetchedAt: cached?.fetchedAt || '' };
    if (this.fresh(cached)) return { servers: cached.servers, fetched: false, stale: false, fetchedAt: cached.fetchedAt };
    try {
      const next = await this.refresh(allow);
      return { servers: next.servers, fetched: next.fetched, stale: false, fetchedAt: next.fetchedAt };
    } catch (error) {
      if (cached) return { servers: cached.servers, fetched: false, stale: true, fetchedAt: cached.fetchedAt, errorClass: errorClass(error) };
      throw error;
    }
  }

  refresh(sessionIds) {
    if (this.pending) return this.pending;
    this.pending = this.fetchSlice(sessionIds).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  async fetchSlice(sessionIds) {
    if (typeof this.fetchImpl !== 'function') throw new Error('Cluster list fetch is unavailable.');
    const cached = this.read();
    const headers = { accept: 'application/json', 'user-agent': 'Khaos-Nexus/0.1 ASA cluster' };
    if (cached?.etag) headers['if-none-match'] = cached.etag;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(this.url, { headers, signal: controller.signal });
      if (response.status === 304 && cached) {
        const touched = { ...cached, fetchedAt: new Date(this.now()).toISOString(), fetchedAtMs: this.now(), fetched: false };
        this.write(touched);
        return touched;
      }
      if (!response.ok) throw Object.assign(new Error('Cluster list request failed.'), { code: `HTTP_${response.status}` });
      const length = Number(response.headers?.get?.('content-length') || 0);
      if (length > MAX_LIST_BYTES) throw Object.assign(new Error('Cluster list is too large.'), { code: 'LIST_TOO_LARGE' });
      const text = await response.text();
      if (Buffer.byteLength(text) > MAX_LIST_BYTES) throw Object.assign(new Error('Cluster list is too large.'), { code: 'LIST_TOO_LARGE' });
      const wanted = new Set(sessionIds);
      const servers = [];
      for (const server of asServerArray(JSON.parse(text))) {
        const id = sessionIdOf(server);
        if (!wanted.has(id)) continue;
        servers.push(publicServer(server));
      }
      const snapshot = {
        etag: String(response.headers?.get?.('etag') || ''),
        fetchedAt: new Date(this.now()).toISOString(),
        fetchedAtMs: this.now(),
        servers,
        fetched: true
      };
      this.write(snapshot);
      console.log(`[Nexus Ascended] cluster cache matched=${servers.length} allow=${wanted.size} class=none`);
      return snapshot;
    } finally {
      clearTimeout(timer);
    }
  }
}

function cacheFor(context, env) {
  if (context.clusterCache) return context.clusterCache;
  context.clusterCache = new SessionListCache({
    file: path.join(context.dir || runtimeDataDir(env), 'ascended-cluster-cache.json'),
    fetchImpl: context.fetchImpl,
    ttlMs: context.clusterTtlMs || cacheTtl(env),
    now: context.now
  });
  return context.clusterCache;
}

async function handleClusterCommand(interaction, context) {
  const env = context.env || process.env;
  const allow = context.sessionIds || parseSessionAllowlist(env);
  if (!allow.length) {
    await interaction.reply({
      content: 'Cluster presence needs `ASCENDED_SESSION_IDS`. The full unofficial list is not downloaded for this command.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] }
    });
    return true;
  }
  const loaded = await cacheFor(context, env).load(allow);
  const embed = clusterEmbed(loaded.servers, loaded);
  const text = JSON.stringify(embed);
  if (/\b[0-9a-f]{32}\b/i.test(text)) throw new Error('Cluster card included a private id.');
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  return true;
}

function clusterStaffLine(env = process.env) {
  const count = parseSessionAllowlist(env).length;
  if (!count) return 'Cluster card: SessionID allowlist is not configured.';
  return `Cluster card: ${count} SessionID allowlisted. The full unofficial list is not fetched on every command.`;
}

module.exports = {
  UNOFFICIAL_LIST_URL,
  MAX_LIST_BYTES,
  publicText,
  parseSessionAllowlist,
  publicServer,
  clusterEmbed,
  SessionListCache,
  handleClusterCommand,
  clusterStaffLine
};
