'use strict';

// Live public-server rows for the managed #game-servers panel and the
// down/up alerts. Uses the same inventory + live Minecraft probe as the
// public server list, so both embeds show the same names and status.

const { HostedServerStore } = require('../backend/core/hosted-server-store.cjs');
const { loadConfig } = require('../shared/config.cjs');
const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');
const { collectPublicServers } = require('./public-server-inventory.cjs');
const { probeServerStatus } = require('../craft/query.cjs');
const { applyLiveMinecraftStatus } = require('./public-server-list.cjs');

// Busy modded servers (ATM10) can miss the public list's 1.5s probe; the
// panel/alert cycle gives them longer so slow replies do not read Offline.
const LIVE_PROBE_TIMEOUT_MS = 4000;

function withProbeTimeout(probe, timeoutMs = LIVE_PROBE_TIMEOUT_MS) {
  return (request = {}) => probe({ ...request, timeoutMs: Math.max(Number(request.timeoutMs) || 0, timeoutMs) });
}

function clean(value, max = 120) {
  return String(value ?? '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function serverKey(game, name) {
  return `${clean(game, 80).toLowerCase()}|${clean(name, 80).toLowerCase()}`;
}

function moduleIdFor(game = '') {
  const text = clean(game, 80).toLowerCase();
  if (text.startsWith('ark')) return 'ark';
  if (text.startsWith('minecraft')) return 'minecraft';
  return text.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'game';
}

function safeList(fn) {
  try { const value = fn(); return Array.isArray(value) ? value : []; } catch { return []; }
}

async function collectLivePublicServers(options = {}) {
  const env = options.env || process.env;
  const arkRegistry = options.arkRegistry || new ArkClusterRegistry();
  const hostedStore = options.hostedStore || new HostedServerStore();
  const config = options.config || loadConfig();
  const runtime = options.runtime || { config, manifests() { return []; } };
  const rows = collectPublicServers({ env, arkRegistry, craftStore: options.craftStore, hostedStore, runtime });
  const checkedAt = new Map(safeList(() => arkRegistry.list({ includeDisabled: false }))
    .map((server) => [`ark:${server.id}`, clean(server.runtime?.lastCheckedAt, 40)]));
  const ownership = new Map(safeList(() => hostedStore.list({ includePrivate: false, includeUnlisted: false }))
    .map((server) => [`hosted:${server.id}`, server.ownershipType === 'community-approved' ? 'community-approved' : 'nexus-official']));
  const live = await applyLiveMinecraftStatus(rows, {
    ...options,
    probeServerStatus: withProbeTimeout(options.probeServerStatus || probeServerStatus, options.probeTimeoutMs || LIVE_PROBE_TIMEOUT_MS)
  });
  return live.map((row) => ({
    ...row,
    ownershipType: ownership.get(row.id) || 'nexus-official',
    ...(checkedAt.get(row.id) ? { checkedAt: checkedAt.get(row.id) } : {})
  }));
}

function parsePlayers(value = '') {
  const match = /^(\d+)(?:\/(\d+))?$/.exec(clean(value, 40));
  if (!match) return {};
  return { playerCount: Number(match[1]), ...(match[2] !== undefined ? { playerMax: Number(match[2]) } : {}) };
}

// Live inventory row -> the server shape renderGameServersPanel already draws.
function livePanelServer(row = {}) {
  const status = clean(row.status, 20).toLowerCase();
  const joinInfo = row.kind === 'realm' ? 'Apply on the Realms board.' : (row.joins || []).map((join) => clean(join, 120)).filter(Boolean).join(' • ');
  return {
    id: clean(row.id, 80),
    moduleId: moduleIdFor(row.game),
    game: clean(row.game, 80),
    name: clean(row.name, 80),
    ownershipType: row.ownershipType === 'community-approved' ? 'community-approved' : 'nexus-official',
    trackingState: ['online', 'offline', 'maintenance'].includes(status) ? status : 'listed',
    ...parsePlayers(row.players),
    ...Object.fromEntries(['pack', 'packVersion', 'mcVersion', 'loader'].map((field) => [field, clean(row[field], field === 'pack' ? 80 : 40)]).filter(([, value]) => value)),
    ...(joinInfo ? { joinInfo } : {}),
    ...(clean(row.description, 240) ? { description: clean(row.description, 240) } : {})
  };
}

// Live rows first (they carry the real status), then /server add registry
// entries. Same game + name is one server: the registry fills in ownership
// and listing text, the live row keeps the status.
function mergePanelServers(liveRows = [], registryServers = []) {
  const merged = new Map();
  for (const row of Array.isArray(liveRows) ? liveRows : []) {
    const server = livePanelServer(row);
    if (!server.game || !server.name) continue;
    const key = serverKey(server.game, server.name);
    if (!merged.has(key)) merged.set(key, server);
  }
  for (const entry of Array.isArray(registryServers) ? registryServers : []) {
    if (!entry || typeof entry !== 'object') continue;
    const key = serverKey(entry.game || entry.gameName || entry.moduleId, entry.name);
    const current = merged.get(key);
    if (!current) { merged.set(key, entry); continue; }
    const liveState = current.trackingState !== 'listed';
    merged.set(key, {
      ...entry,
      ...current,
      moduleId: entry.moduleId || current.moduleId,
      ownershipType: entry.ownershipType === 'community-approved' ? 'community-approved' : current.ownershipType,
      trackingState: liveState ? current.trackingState : (entry.trackingState || current.trackingState),
      region: entry.region || current.region,
      scenario: entry.scenario || current.scenario,
      description: current.description || entry.description,
      joinInfo: current.joinInfo || entry.joinInfo
    });
  }
  return [...merged.values()].sort((a, b) => String(a.game || '').localeCompare(String(b.game || '')) || String(a.name || '').localeCompare(String(b.name || '')));
}

module.exports = { LIVE_PROBE_TIMEOUT_MS, collectLivePublicServers, withProbeTimeout, livePanelServer, mergePanelServers, moduleIdFor, serverKey };
