'use strict';

const path = require('node:path');
const { errorClass } = require('./command-failure.cjs');
const { evaluateChannelCategory } = require('./category-gate.cjs');
const { WorldstateCache } = require('./warframe-worldstate.cjs');
const { readJson, runtimeDataDir, snowflake, upsertEmbed, writeJson } = require('./panel-message.cjs');
const { circuitEmbed } = require('./cephalon-relay.cjs');
const {
  summarizeAlerts,
  summarizeArbitration,
  summarizeEvents,
  summarizeNews,
  summarizeNightwave,
  summarizeSortie,
  summarizeSteelPath,
  summarizeVoidTrader
} = require('../backend/providers/warframe-provider.cjs');

const SHARED_CHANNEL_ENV = 'CEPHALON_WARFRAME_WORLD_CHANNEL_ID';
const PANEL_INTERVAL_MS = 10 * 60 * 1000;
const caches = new WeakMap();
const panelFlights = new Map();
let stateWrite = Promise.resolve();

const PANEL_PATHS = Object.freeze({
  news: 'news',
  events: 'events',
  alerts: 'alerts',
  sortie: 'sortie',
  arbitration: 'arbitration',
  nightwave: 'nightwave',
  voidTrader: 'voidTrader',
  steelPath: 'steelPath',
  duviri: 'duviriCycle',
  archimedea: 'deepArchimedea'
});

const PANELS = Object.freeze([
  { id: 'news', source: 'news', panel: 'warframeNews', channelEnv: 'CEPHALON_WARFRAME_NEWS_CHANNEL_ID', messageEnv: 'CEPHALON_WARFRAME_NEWS_MESSAGE_ID' },
  { id: 'events', source: 'events', panel: 'warframeEvents', channelEnv: 'CEPHALON_WARFRAME_EVENTS_CHANNEL_ID', messageEnv: 'CEPHALON_WARFRAME_EVENTS_MESSAGE_ID' },
  { id: 'alerts', source: 'alerts', panel: 'warframeAlerts', channelEnv: 'CEPHALON_WARFRAME_ALERTS_CHANNEL_ID', messageEnv: 'CEPHALON_WARFRAME_ALERTS_MESSAGE_ID' },
  { id: 'sortie', source: 'sortie', panel: 'warframeSortie', channelEnv: 'CEPHALON_WARFRAME_SORTIE_CHANNEL_ID', messageEnv: 'CEPHALON_WARFRAME_SORTIE_MESSAGE_ID' },
  { id: 'arbitration', source: 'arbitration', panel: 'warframeArbitration', channelEnv: 'CEPHALON_WARFRAME_ARBITRATION_CHANNEL_ID', messageEnv: 'CEPHALON_WARFRAME_ARBITRATION_MESSAGE_ID' },
  { id: 'nightwave', source: 'nightwave', panel: 'warframeNightwave', channelEnv: 'CEPHALON_WARFRAME_NIGHTWAVE_CHANNEL_ID', messageEnv: 'CEPHALON_WARFRAME_NIGHTWAVE_MESSAGE_ID' },
  { id: 'void-trader', source: 'voidTrader', panel: 'warframeVoidTrader', channelEnv: 'CEPHALON_WARFRAME_VOID_TRADER_CHANNEL_ID', messageEnv: 'CEPHALON_WARFRAME_VOID_TRADER_MESSAGE_ID' },
  { id: 'steel-path', source: 'steelPath', panel: 'warframeSteelPath', channelEnv: 'CEPHALON_WARFRAME_STEEL_PATH_CHANNEL_ID', messageEnv: 'CEPHALON_WARFRAME_STEEL_PATH_MESSAGE_ID' },
  { id: 'circuit', source: 'circuit', panel: 'warframeCircuit', channelEnv: 'CEPHALON_CIRCUIT_CHANNEL_ID', messageEnv: 'CEPHALON_CIRCUIT_MESSAGE_ID' }
]);

function panelInterval(env = process.env) {
  const raw = Number(env.CEPHALON_WARFRAME_PANEL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return PANEL_INTERVAL_MS;
  return Math.max(60_000, Math.round(raw));
}

function channelSetting(env, name) {
  return String(env?.[name] || '').trim();
}

function warframePanelsConfigured(env = process.env) {
  if (channelSetting(env, SHARED_CHANNEL_ENV)) return true;
  return PANELS.some((panel) => channelSetting(env, panel.channelEnv));
}

function channelRaw(env, panel) {
  return channelSetting(env, panel.channelEnv) || channelSetting(env, SHARED_CHANNEL_ENV);
}

function panelFooter(id) {
  return `Cephalon Nexus • warframe:${id}`;
}

function singleFlight(key, fn) {
  const existing = panelFlights.get(key);
  if (existing) return existing;
  const flight = Promise.resolve().then(fn);
  panelFlights.set(key, flight);
  const clear = () => {
    if (panelFlights.get(key) === flight) panelFlights.delete(key);
  };
  flight.then(clear, clear);
  return flight;
}

function writePanelRecord(file, panelId, record) {
  const run = stateWrite.then(() => {
    const latest = readJson(file, { version: 1, panels: {} });
    if (!latest.panels || typeof latest.panels !== 'object') latest.panels = {};
    latest.panels[panelId] = record;
    writeJson(file, { version: 1, panels: latest.panels });
  });
  stateWrite = run.then(() => {}, () => {});
  return run;
}

function ownedFooterMatcher(botId, footerPrefix) {
  const owner = String(botId || '');
  const prefix = String(footerPrefix || '');
  return (message) => {
    if (!owner || String(message?.author?.id || '') !== owner) return false;
    if (message?.webhookId) return false;
    const embed = message?.embeds?.[0] || null;
    const footer = String(embed?.footer?.text || embed?.data?.footer?.text || '');
    return Boolean(prefix) && footer.startsWith(prefix);
  };
}

function panelFile(dir) {
  return path.join(dir, 'cephalon-warframe-panels.json');
}

function providerFor(explicit) {
  if (explicit) return explicit;
  if (!providerFor.shared) {
    const { WarframeProvider } = require('../backend/providers/warframe-provider.cjs');
    providerFor.shared = new WarframeProvider();
  }
  return providerFor.shared;
}

function snapshotCache(provider, env) {
  let cache = caches.get(provider);
  if (!cache) {
    cache = new WorldstateCache({ provider, ttlMs: panelInterval(env), paths: PANEL_PATHS });
    caches.set(provider, cache);
  }
  return cache;
}

function clip(value, max = 1024) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function embed(title, description, fields, id) {
  const body = {
    title,
    description: String(description || 'Nothing to report.').slice(0, 4000),
    footer: { text: panelFooter(id) }
  };
  const usable = (fields || []).filter((field) => field?.name && field?.value).slice(0, 25);
  if (usable.length) body.fields = usable;
  return body;
}

function linesField(name, lines) {
  const value = lines.filter(Boolean).join('\n').slice(0, 1024);
  return value ? { name: clip(name, 256) || 'Detail', value } : null;
}

function newsEmbed(rows) {
  const items = Array.isArray(rows) ? rows : [];
  return embed(
    'Cephalon • Warframe News',
    items.length ? `${items.length} posts.` : 'No Warframe news returned.',
    items.slice(0, 8).map((item) => linesField(item.title || 'News', [item.date, item.link])),
    'news'
  );
}

function eventsEmbed(rows) {
  const items = Array.isArray(rows) ? rows : [];
  return embed(
    'Cephalon • Warframe Events',
    items.length ? `${items.length} active events.` : 'No active Warframe events.',
    items.slice(0, 8).map((item) => linesField(item.description || item.node || 'Event', [item.node, item.eta])),
    'events'
  );
}

function alertsEmbed(rows) {
  const items = Array.isArray(rows) ? rows : [];
  return embed(
    'Cephalon • Warframe Alerts',
    items.length ? `${items.length} active alerts.` : 'No active alerts.',
    items.slice(0, 8).map((item) => linesField([item.node, item.type].filter(Boolean).join(' • ') || 'Alert', [item.faction, item.reward, item.eta])),
    'alerts'
  );
}

function sortieEmbed(row) {
  const sortie = row && typeof row === 'object' ? row : {};
  const variants = Array.isArray(sortie.variants) ? sortie.variants : [];
  return embed(
    'Cephalon • Sortie',
    [sortie.boss, sortie.faction, sortie.eta].filter(Boolean).join(' · ') || 'No sortie reported.',
    variants.slice(0, 6).map((variant) => linesField(variant.node || variant.mission || 'Mission', [variant.mission, variant.modifier])),
    'sortie'
  );
}

function arbitrationEmbed(row) {
  const item = row && typeof row === 'object' ? row : {};
  return embed(
    'Cephalon • Arbitration',
    [item.node, item.mission, item.enemy, item.eta].filter(Boolean).join(' · ') || 'No arbitration reported.',
    [],
    'arbitration'
  );
}

function nightwaveEmbed(row) {
  const board = row && typeof row === 'object' ? row : {};
  const challenges = Array.isArray(board.challenges) ? board.challenges : [];
  const heading = [`Season ${board.season || 'unknown'}`, board.phase != null ? `phase ${board.phase}` : '', board.eta ? `ends ${board.eta}` : ''].filter(Boolean).join(' · ');
  const lines = challenges.slice(0, 12).map((challenge) => {
    const meta = [challenge.daily ? 'daily' : '', challenge.elite ? 'elite' : '', challenge.reputation ? `${challenge.reputation} standing` : '', challenge.eta].filter(Boolean).join(' · ');
    return `**${challenge.title || 'Challenge'}**${meta ? ` — ${meta}` : ''}`;
  });
  return embed('Cephalon • Nightwave', [heading, '', lines.join('\n') || 'No active challenges.'].filter((line) => line != null).join('\n'), [], 'nightwave');
}

function voidTraderEmbed(row) {
  const trader = row && typeof row === 'object' ? row : {};
  const inventory = Array.isArray(trader.inventory) ? trader.inventory : [];
  const when = trader.active
    ? `In system${trader.eta ? ` · leaves ${trader.eta}` : ''}`
    : `Away${trader.eta ? ` · ${trader.eta}` : ''}`;
  const lines = inventory.slice(0, 20).map((item) => {
    const price = [item.ducats ? `${item.ducats} ducats` : '', item.credits ? `${Number(item.credits).toLocaleString('en-US')} credits` : ''].filter(Boolean).join(' · ');
    return price ? `${item.item} — ${price}` : item.item;
  });
  return embed(
    "Cephalon • Baro Ki'Teer",
    [trader.character || "Baro Ki'Teer", trader.location || 'Location unavailable', when, '', lines.join('\n') || 'No inventory listed.'].join('\n'),
    [],
    'void-trader'
  );
}

function steelPathEmbed(row) {
  const board = row && typeof row === 'object' ? row : {};
  const rotation = Array.isArray(board.rotation) ? board.rotation : [];
  return embed(
    'Cephalon • Steel Path',
    [board.currentReward ? `Current reward: ${board.currentReward}` : 'No current reward listed.', board.remaining ? `Remaining ${board.remaining}` : ''].filter(Boolean).join('\n'),
    rotation.length ? [linesField('Rotation', rotation.map((item) => item.cost ? `${item.name} · ${item.cost}` : item.name))] : [],
    'steel-path'
  );
}

function circuitPanelEmbed(partial) {
  const circuit = circuitEmbed({
    duviri: partial.duviri,
    steelPath: partial.steelPath,
    archimedea: partial.archimedea,
    missing: (partial.missing || []).filter((key) => key === 'duviri' || key === 'steelPath' || key === 'archimedea')
  });
  const credit = circuit.footer?.text || '';
  return {
    ...circuit,
    title: 'Cephalon • Circuit',
    footer: { text: `${panelFooter('circuit')}${credit ? ` • ${credit}` : ''}`.slice(0, 2048) }
  };
}

function renderPanel(panel, partial) {
  if (panel.id === 'circuit') return circuitPanelEmbed(partial);
  if ((partial.missing || []).includes(panel.source)) return null;
  const raw = partial[panel.source];
  if (panel.id === 'news') return newsEmbed(summarizeNews(raw));
  if (panel.id === 'events') return eventsEmbed(summarizeEvents(raw));
  if (panel.id === 'alerts') return alertsEmbed(summarizeAlerts(raw));
  if (panel.id === 'sortie') return sortieEmbed(summarizeSortie(raw));
  if (panel.id === 'arbitration') return arbitrationEmbed(summarizeArbitration(raw));
  if (panel.id === 'nightwave') return nightwaveEmbed(summarizeNightwave(raw));
  if (panel.id === 'void-trader') return voidTraderEmbed(summarizeVoidTrader(raw));
  if (panel.id === 'steel-path') return steelPathEmbed(summarizeSteelPath(raw));
  return null;
}

async function collectGuildChannels(client) {
  const guilds = client?.guilds?.cache && typeof client.guilds.cache.values === 'function'
    ? [...client.guilds.cache.values()]
    : [];
  const channels = [];
  for (const guild of guilds) {
    let collection = guild.channels?.cache;
    if (typeof guild.channels?.fetch === 'function') {
      const fetched = await guild.channels.fetch().catch(() => null);
      if (fetched && typeof fetched.values === 'function') collection = fetched;
    }
    if (collection && typeof collection.values === 'function') channels.push(...collection.values());
  }
  return channels;
}

async function resolvePanelChannel(client, raw, env) {
  const value = String(raw || '').trim().replace(/^#/, '');
  if (!value) return { channel: null, reason: 'unset' };
  if (/^\d{17,20}$/.test(value)) {
    const channel = await client?.channels?.fetch?.(value).catch(() => null);
    if (!channel || typeof channel.send !== 'function') return { channel: null, reason: 'missing' };
    const decision = evaluateChannelCategory(channel, 'cephalon', env);
    if (!decision.allow) return { channel: null, reason: decision.reason };
    return { channel, reason: 'allow' };
  }
  const name = value.toLowerCase();
  const named = (await collectGuildChannels(client)).filter((item) => String(item?.name || '').toLowerCase() === name && typeof item.send === 'function');
  const allowed = named.find((item) => evaluateChannelCategory(item, 'cephalon', env).allow) || null;
  if (allowed) return { channel: allowed, reason: 'allow' };
  if (named.length) return { channel: null, reason: 'wrong-category' };
  return { channel: null, reason: 'missing' };
}

async function pinPanel(client, channel, savedId, rendered, panel, env) {
  const botId = String(client?.user?.id || '');
  const options = {
    panel: panel.panel,
    botId,
    envMessageId: snowflake(env[panel.messageEnv]),
    matches: ownedFooterMatcher(botId, panelFooter(panel.id))
  };
  let result = await upsertEmbed(client, channel.id, savedId, { embeds: [rendered] }, options);
  if (result.reason === 'foreign-unmatched') {
    result = await upsertEmbed(client, channel.id, '', { embeds: [rendered] }, { ...options, envMessageId: '' });
  }
  return result;
}

async function refreshWarframePanels({ client, env = process.env, provider, dir } = {}) {
  if (!warframePanelsConfigured(env)) return { refreshed: 0, skipped: 'unset' };
  const root = dir || runtimeDataDir(env);
  const file = panelFile(root);
  let refreshed = 0;
  const skipped = [];
  const targets = [];
  for (const panel of PANELS) {
    const raw = channelRaw(env, panel);
    if (!raw) {
      skipped.push({ id: panel.id, reason: 'unset' });
      continue;
    }
    const resolved = await resolvePanelChannel(client, raw, env);
    if (!resolved.channel) {
      skipped.push({ id: panel.id, reason: resolved.reason });
      continue;
    }
    targets.push({ panel, channel: resolved.channel });
  }
  if (!targets.length) return { refreshed: 0, skipped };
  const source = providerFor(provider);
  const cache = snapshotCache(source, env);
  await cache.load();
  const partial = cache.partial || { missing: [] };
  for (const { panel, channel } of targets) {
    const rendered = renderPanel(panel, partial);
    if (!rendered) {
      skipped.push({ id: panel.id, reason: 'unavailable' });
      continue;
    }
    const outcome = await singleFlight(`${file}:${panel.id}`, async () => {
      const latest = readJson(file, { version: 1, panels: {} });
      const savedId = latest.panels?.[panel.id]?.messageId || '';
      const result = await pinPanel(client, channel, savedId, rendered, panel, env);
      if (!result?.messageId || result.reason === 'foreign-unmatched') {
        return { ok: false, reason: result?.reason || 'unpinned', result };
      }
      await writePanelRecord(file, panel.id, { channelId: String(channel.id), messageId: String(result.messageId) });
      if (result.created || result.duplicatesRemoved) {
        console.log(`[Cephalon Nexus] warframe ${panel.id} message=${result.messageId} created=${result.created ? 'yes' : 'no'} duplicatesRemoved=${result.duplicatesRemoved || 0}`);
      }
      return { ok: true, result };
    });
    if (!outcome.ok) {
      skipped.push({ id: panel.id, reason: outcome.reason });
      continue;
    }
    refreshed += 1;
  }
  return { refreshed, skipped };
}

function scheduleWarframePanels({ client, env = process.env, provider } = {}) {
  if (!warframePanelsConfigured(env)) return { stop() {} };
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    refreshWarframePanels({ client, env, provider })
      .catch((error) => console.warn(`[Cephalon Nexus] warframe panels class=${errorClass(error)}`))
      .finally(() => { running = false; });
  };
  const initial = setTimeout(tick, 5000);
  initial.unref?.();
  const timer = setInterval(tick, panelInterval(env));
  timer.unref?.();
  return {
    stop() {
      clearTimeout(initial);
      clearInterval(timer);
    }
  };
}

module.exports = {
  SHARED_CHANNEL_ENV,
  PANEL_INTERVAL_MS,
  PANEL_PATHS,
  PANELS,
  panelInterval,
  panelFooter,
  ownedFooterMatcher,
  singleFlight,
  warframePanelsConfigured,
  renderPanel,
  resolvePanelChannel,
  refreshWarframePanels,
  scheduleWarframePanels
};
