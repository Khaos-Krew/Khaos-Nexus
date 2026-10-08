'use strict';

const { configuredTrackedServers } = require('../backend/tracked-servers.cjs');
const { HostedServerStore } = require('../backend/core/hosted-server-store.cjs');
const { publicJoinInfo } = require('../shared/game-server-catalog.cjs');
const { joinValue } = require('../craft/embeds.cjs');
const { CraftStore, openCraftStore } = require('../craft/store.cjs');
const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');
const { ArkRconConfigStore } = require('./ark-rcon-config-store.cjs');

const SECRET_TEXT = /password|rcon|token|secret|api[_-]?key|credential/i;

function clean(value, max = 180) {
  return String(value ?? '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function keyOf(game, name) {
  return `${clean(game, 80).toLowerCase()}|${clean(name, 80).toLowerCase()}`;
}

function safePublicText(value, forbidden = []) {
  const text = clean(value, 300);
  if (!text || SECRET_TEXT.test(text)) return '';
  for (const secret of forbidden) {
    const token = clean(secret, 255);
    if (token.length >= 4 && text.toLowerCase().includes(token.toLowerCase())) return '';
  }
  return text;
}

function statusLabel(value) {
  const state = clean(value, 40).toLowerCase();
  if (state === 'online') return 'Online';
  if (state === 'offline') return 'Offline';
  if (state === 'maintenance') return 'Maintenance';
  return '';
}

function playersLabel(count, max) {
  if (count === null || count === undefined || count === '') return '';
  if (!Number.isFinite(Number(count))) return '';
  const shown = Math.max(0, Math.trunc(Number(count)));
  if (Number.isFinite(Number(max))) return `${shown}/${Math.max(0, Math.trunc(Number(max)))}`;
  return String(shown);
}

function arkForbiddenHosts(registry) {
  const forbidden = [];
  try {
    const store = new ArkRconConfigStore(registry?.dir);
    for (const record of Object.values(store.read().servers || {})) {
      if (record?.host) forbidden.push(String(record.host));
    }
  } catch {}
  return forbidden;
}

function craftStoreFor(env, explicit) {
  if (explicit) return explicit;
  const dir = clean(env.NEXUS_CRAFT_DATA_DIR, 400);
  if (dir) return new CraftStore(dir, env);
  return openCraftStore(env);
}

function minecraftJoins(panel) {
  const kind = panel.kind === 'bedrock' || panel.kind === 'geyser' ? panel.kind : (panel.kind ? 'java' : 'geyser');
  const joins = [];
  if (kind === 'bedrock') {
    const join = joinValue(panel.host, panel.bedrockPort);
    if (join) joins.push(`Bedrock ${join}`);
  } else if (kind === 'geyser') {
    const java = joinValue(panel.host, panel.javaPort);
    const bedrock = joinValue(panel.host, panel.bedrockPort);
    if (java) joins.push(`Java ${java}`);
    if (bedrock) joins.push(`Bedrock ${bedrock}`);
  } else {
    const java = joinValue(panel.host, panel.javaPort);
    if (java) joins.push(`Java ${java}`);
  }
  return { kind, joins };
}

function pushRow(rows, seen, row) {
  const game = clean(row.game, 80);
  const name = clean(row.name, 80);
  if (!game || !name) return;
  const key = keyOf(game, name);
  if (seen.has(key)) return;
  seen.add(key);
  rows.push({
    id: clean(row.id, 80) || key,
    game,
    name,
    kind: clean(row.kind, 40),
    joins: (Array.isArray(row.joins) ? row.joins : []).map((item) => clean(item, 200)).filter(Boolean).slice(0, 4),
    description: clean(row.description, 240),
    status: statusLabel(row.status),
    players: clean(row.players, 40)
  });
}

function collectArkRows(registry, env) {
  const rows = [];
  if (!registry || typeof registry.list !== 'function') return rows;
  const forbidden = arkForbiddenHosts(registry);
  for (const server of registry.list({ includeDisabled: false })) {
    // Display the server's registry name (same label Ascended's ARK panel uses);
    // fall back to the map name only when no name is set.
    const name = clean(server.name || server.mapName, 80);
    const prefix = clean(server.envPrefix, 64);
    const configuredJoin = safePublicText(env[`${prefix}_PUBLIC_JOIN`] || env[`${prefix}_JOIN`] || '', forbidden);
    const joins = configuredJoin ? [configuredJoin] : (name ? [`In-game server list: ${name}`] : []);
    const checked = Boolean(clean(server.runtime?.lastCheckedAt, 40));
    rows.push({
      id: `ark:${server.id}`,
      game: 'ARK: Survival Ascended',
      name,
      kind: 'ark',
      joins,
      status: checked ? server.runtime?.state : '',
      players: checked ? playersLabel(server.runtime?.playerCount) : ''
    });
  }
  return rows;
}

// Nexus Craft runs in its own service with its own volume, so Sentinal usually
// cannot see the Craft status panel. NEXUS_CRAFT_PUBLIC_JOIN ("host:port", Java)
// lists the official server anyway; NEXUS_CRAFT_PUBLIC_NAME overrides the label.
function envCraftRow(env = {}) {
  const raw = clean(env.NEXUS_CRAFT_PUBLIC_JOIN, 300).replace(/^java\s+/i, '');
  const split = raw.lastIndexOf(':');
  if (split < 1) return null;
  const join = joinValue(raw.slice(0, split), raw.slice(split + 1));
  if (!join || !safePublicText(join)) return null;
  return {
    id: 'minecraft:env',
    game: 'Minecraft',
    name: clean(env.NEXUS_CRAFT_PUBLIC_NAME, 80) || 'Nexus Craft',
    kind: 'java',
    joins: [`Java ${join}`]
  };
}

function collectCraftRows(store, env = {}) {
  const rows = [];
  const panel = store && typeof store.getStatusPanel === 'function' ? store.getStatusPanel() : null;
  if (!panel?.host) {
    const fallback = envCraftRow(env);
    if (fallback) rows.push(fallback);
  }
  if (!store || typeof store.getStatusPanel !== 'function') return rows;
  if (panel?.host) {
    const named = minecraftJoins(panel);
    rows.push({
      id: 'minecraft:panel',
      game: 'Minecraft',
      name: clean(panel.host, 80),
      kind: named.kind,
      joins: named.joins
    });
  }
  const listings = typeof store.listListings === 'function' ? store.listListings() : [];
  for (const listing of listings) {
    if (!listing || listing.status === 'closed') continue;
    rows.push({
      id: `realm:${listing.id}`,
      game: 'Minecraft',
      name: listing.name,
      kind: 'realm',
      description: safePublicText(listing.description),
      joins: []
    });
  }
  return rows;
}

function collectHostedRows(store) {
  const rows = [];
  if (!store || typeof store.list !== 'function') return rows;
  for (const server of store.list({ includePrivate: false, includeUnlisted: false })) {
    if (server.public === false || server.listingState === 'hidden' || server.listingState === 'suspended') continue;
    const join = safePublicText(publicJoinInfo(server));
    rows.push({
      id: `hosted:${server.id}`,
      game: server.game || server.gameName,
      name: server.name,
      kind: server.serverType || 'hosted',
      joins: join ? [join] : [],
      description: safePublicText(server.description),
      status: server.trackingState,
      players: playersLabel(server.playerCount, server.playerMax)
    });
  }
  return rows;
}

function collectConfiguredRows(runtime) {
  const rows = [];
  if (!runtime?.config) return rows;
  for (const server of configuredTrackedServers(runtime)) {
    rows.push({
      id: `config:${server.id}`,
      game: server.game,
      name: server.name,
      kind: 'configured',
      joins: [],
      status: server.trackingState
    });
  }
  return rows;
}

function collectPublicServers(options = {}) {
  const env = options.env || process.env;
  const seen = new Set();
  const rows = [];
  const sources = [
    ...collectCraftRows(craftStoreFor(env, options.craftStore), env),
    ...collectArkRows(options.arkRegistry || new ArkClusterRegistry(), env),
    ...collectHostedRows(options.hostedStore || new HostedServerStore()),
    ...collectConfiguredRows(options.runtime || null)
  ];
  for (const row of sources) pushRow(rows, seen, row);
  rows.sort((left, right) => left.game.localeCompare(right.game) || left.name.localeCompare(right.name));
  return rows;
}

module.exports = {
  collectPublicServers,
  minecraftJoins,
  safePublicText,
  statusLabel
};
