'use strict';

const path = require('node:path');
const { MessageFlags } = require('discord.js');
const { errorClass } = require('./command-failure.cjs');
const { TtlCache } = require('./ttl-cache.cjs');
const { evaluateChannelCategory } = require('./category-gate.cjs');
const { WorldstateCache } = require('./warframe-worldstate.cjs');
const { PANEL_IDENTITIES, readJson, runtimeDataDir, snowflake, upsertEmbed, writeJson } = require('./panel-message.cjs');
const { circuitEmbed } = require('./cephalon-relay.cjs');
const {
  summarizeAlerts,
  summarizeArbitration,
  summarizeEvents,
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

const NEWS_CHANNEL_ENV = 'CEPHALON_WARFRAME_NEWS_CHANNEL_ID';
const NEWS_MESSAGE_ENV = 'CEPHALON_WARFRAME_NEWS_MESSAGE_ID';

const PANEL_PATHS = Object.freeze({
  events: 'events',
  alerts: 'alerts',
  sortie: 'sortie',
  arbitration: 'arbitration',
  nightwave: 'nightwave',
  voidTrader: 'voidTrader',
  steelPath: 'steelPath',
  duviri: 'duviriCycle',
  archimedea: 'deepArchimedea',
  descendia: 'descendia'
});

const PANELS = Object.freeze([
  { id: 'events', source: 'events', panel: 'warframeEvents', channelEnv: 'CEPHALON_WARFRAME_EVENTS_CHANNEL_ID', messageEnv: 'CEPHALON_WARFRAME_EVENTS_MESSAGE_ID' },
  { id: 'alerts', source: 'alerts', panel: 'warframeAlerts', channelEnv: 'CEPHALON_WARFRAME_ALERTS_CHANNEL_ID', messageEnv: 'CEPHALON_WARFRAME_ALERTS_MESSAGE_ID' },
  { id: 'sortie', source: 'sortie', panel: 'warframeSortie', channelEnv: 'CEPHALON_WARFRAME_SORTIE_CHANNEL_ID', messageEnv: 'CEPHALON_WARFRAME_SORTIE_MESSAGE_ID' },
  { id: 'arbitration', source: 'arbitration', panel: 'warframeArbitration', channelEnv: 'CEPHALON_WARFRAME_ARBITRATION_CHANNEL_ID', messageEnv: 'CEPHALON_WARFRAME_ARBITRATION_MESSAGE_ID' },
  { id: 'nightwave', source: 'nightwave', panel: 'warframeNightwave', channelEnv: 'CEPHALON_WARFRAME_NIGHTWAVE_CHANNEL_ID', messageEnv: 'CEPHALON_WARFRAME_NIGHTWAVE_MESSAGE_ID' },
  { id: 'void-trader', source: 'voidTrader', panel: 'warframeVoidTrader', channelEnv: 'CEPHALON_WARFRAME_VOID_TRADER_CHANNEL_ID', messageEnv: 'CEPHALON_WARFRAME_VOID_TRADER_MESSAGE_ID' },
  { id: 'steel-path', source: 'steelPath', panel: 'warframeSteelPath', channelEnv: 'CEPHALON_WARFRAME_STEEL_PATH_CHANNEL_ID', messageEnv: 'CEPHALON_WARFRAME_STEEL_PATH_MESSAGE_ID' },
  { id: 'circuit', source: 'circuit', panel: 'warframeCircuit', channelEnv: 'CEPHALON_CIRCUIT_CHANNEL_ID', messageEnv: 'CEPHALON_CIRCUIT_MESSAGE_ID' },
  { id: 'descendia', source: 'descendia', panel: 'warframeDescendia', channelEnv: 'CEPHALON_DESCENDIA_CHANNEL_ID', messageEnv: 'CEPHALON_DESCENDIA_MESSAGE_ID' }
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

function panelState(file) {
  const latest = readJson(file, { version: 1, panels: {} });
  if (!latest.panels || typeof latest.panels !== 'object') latest.panels = {};
  if (!latest.retired || typeof latest.retired !== 'object') latest.retired = {};
  return latest;
}

function commitPanelState(file, state) {
  const body = { version: 1, panels: state.panels };
  if (Object.keys(state.retired).length) body.retired = state.retired;
  writeJson(file, body);
}

function mutatePanelState(file, mutate) {
  const run = stateWrite.then(() => {
    const latest = panelState(file);
    mutate(latest);
    commitPanelState(file, latest);
  });
  stateWrite = run.then(() => {}, () => {});
  return run;
}

function writePanelRecord(file, panelId, record) {
  return mutatePanelState(file, (latest) => {
    latest.panels[panelId] = record;
  });
}

function addUnique(list, value) {
  const text = String(value || '').trim();
  if (!text || list.includes(text)) return;
  list.push(text);
}

function newsPanelMessage(message, botId) {
  const owner = String(botId || '');
  if (!owner || String(message?.author?.id || '') !== owner) return false;
  if (message?.webhookId) return false;
  const embed = message?.embeds?.[0] || null;
  const title = String(embed?.title || embed?.data?.title || '');
  const footer = String(embed?.footer?.text || embed?.data?.footer?.text || '');
  const identity = PANEL_IDENTITIES.warframeNews || {};
  if (title && (identity.titles || []).includes(title)) return true;
  return (identity.footerPrefixes || []).some((prefix) => footer.startsWith(prefix));
}

async function newsRetirementChannels(client, env, storedChannelId) {
  const raws = [];
  addUnique(raws, storedChannelId);
  addUnique(raws, channelSetting(env, NEWS_CHANNEL_ENV));
  addUnique(raws, channelSetting(env, SHARED_CHANNEL_ENV));
  const channels = [];
  const seen = new Set();
  for (const raw of raws) {
    let channel = null;
    if (/^\d{17,20}$/.test(raw)) channel = await client?.channels?.fetch?.(raw).catch(() => null);
    else channel = (await resolvePanelChannel(client, raw, env)).channel;
    const id = String(channel?.id || '');
    if (!id || seen.has(id) || typeof channel?.messages?.fetch !== 'function') continue;
    seen.add(id);
    channels.push(channel);
  }
  return channels;
}

async function deleteNewsMessages(channel, messageIds, botId) {
  const pending = new Map();
  for (const id of messageIds) {
    const stored = await channel.messages.fetch(String(id)).catch(() => null);
    if (stored?.id) pending.set(String(stored.id), stored);
  }
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const values = recent && typeof recent.values === 'function'
    ? [...recent.values()]
    : (Array.isArray(recent) ? recent : []);
  for (const message of values) {
    if (message?.id) pending.set(String(message.id), message);
  }
  let deleted = 0;
  let failed = 0;
  for (const message of pending.values()) {
    if (!newsPanelMessage(message, botId)) continue;
    if (typeof message.delete !== 'function') {
      failed += 1;
      continue;
    }
    try {
      await message.delete('Cephalon Nexus retired the Warframe news panel');
      deleted += 1;
    } catch {
      failed += 1;
    }
  }
  return { deleted, failed };
}

async function retireNewsPanelOnce({ client, env, file, logger }) {
  const current = panelState(file);
  if (current.retired?.news?.status === 'done') return { status: 'done', skipped: true, deleted: 0, failed: 0 };
  const botId = String(client?.user?.id || '');
  if (!botId) return { status: 'deferred', skipped: true, deleted: 0, failed: 0 };
  const stored = current.panels?.news && typeof current.panels.news === 'object' ? current.panels.news : {};
  const messageIds = [];
  addUnique(messageIds, snowflake(stored.messageId));
  addUnique(messageIds, snowflake(env?.[NEWS_MESSAGE_ENV]));
  let deleted = 0;
  let failed = 0;
  try {
    const channels = await newsRetirementChannels(client, env, stored.channelId);
    for (const channel of channels) {
      const outcome = await deleteNewsMessages(channel, messageIds, botId);
      deleted += outcome.deleted;
      failed += outcome.failed;
    }
  } catch {
    failed += 1;
  }
  // One attempt is terminal, including a failed delete. The next boot only reads this record.
  await mutatePanelState(file, (latest) => {
    delete latest.panels.news;
    latest.retired.news = {
      status: 'done',
      deleted,
      failed,
      at: new Date().toISOString()
    };
  });
  logger.log?.(`[Cephalon Nexus] warframe news retired deleted=${deleted} failed=${failed}`);
  return { status: 'done', skipped: false, deleted, failed };
}

async function retireNewsPanel({ client, env = process.env, dir, logger = console } = {}) {
  const file = panelFile(dir || runtimeDataDir(env));
  return singleFlight(`news-retire:${file}`, () => retireNewsPanelOnce({ client, env, file, logger }));
}

function scheduleNewsRetirement({ client, env, dir }) {
  let timer = null;
  let stopped = false;
  const run = () => {
    if (stopped) return;
    retireNewsPanel({ client, env, dir }).catch((error) => {
      console.warn(`[Cephalon Nexus] warframe news retirement class=${errorClass(error)}`);
    });
  };
  const arm = () => {
    if (stopped) return;
    timer = setTimeout(run, 5000);
    timer.unref?.();
  };
  if (typeof client?.isReady === 'function' && client.isReady()) arm();
  else if (typeof client?.once === 'function') client.once('ready', arm);
  else arm();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    }
  };
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

const BRAND_MOTTO = 'Many Worlds One Nexus';
const DESCENDIA_TITLE = 'Cephalon • Descendia';
const DESCENDIA_UNAVAILABLE = 'Descendia data unavailable';
const ROLLOVER_GRACE_MS = 5_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

function descendiaFooter() {
  return `${panelFooter('descendia')} • ${BRAND_MOTTO}`.slice(0, 2048);
}

function missionNameFromTypeKey(typeKey) {
  const stripped = String(typeKey ?? '').trim().replace(/^DT_/i, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!stripped) return '';
  return stripped.toLowerCase().replace(/(^|[^a-z])([a-z])/g, (all, lead, char) => `${lead}${char.toUpperCase()}`);
}

function labelFromKey(key) {
  const text = String(key || '')
    .replace(/_/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.replace(/\b([a-z])/g, (letter) => letter.toUpperCase()).slice(0, 80);
}

function looksSpaced(value) {
  const tokens = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return false;
  const short = tokens.filter((token) => token.replace(/[^A-Za-z]/g, '').length <= 1).length;
  return short >= 2 && short / tokens.length >= 0.4;
}

function challengeName(floor) {
  const text = clip(floor?.challenge, 80);
  const fromKey = labelFromKey(floor?.challengeKey);
  if (!text) return fromKey;
  if (looksSpaced(text) && fromKey) return fromKey;
  return text;
}

function shortModifier(value) {
  return String(value || '')
    .replace(/\s+Aura$/i, '')
    .replace(/\s+Spec$/i, '')
    .replace(/\s+Enhancement$/i, '')
    .replace(/^Co H\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function namedModifiers(rows) {
  const names = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = shortModifier(typeof row === 'string' ? row : row?.name);
    if (!name || names.includes(name)) continue;
    names.push(name);
  }
  return names;
}

function modifierSummary(floor, max = 90) {
  const auras = namedModifiers(floor?.auras);
  const source = auras.length ? auras : namedModifiers(floor?.specs);
  return source.join(', ').slice(0, max);
}

function floorLine(floor, options = {}) {
  const index = Number(floor?.index);
  const mission = missionNameFromTypeKey(floor?.typeKey) || 'Mission';
  const challenge = challengeName(floor) || 'Challenge';
  const mods = options.modifiers === false ? '' : modifierSummary(floor);
  const prefix = Number.isInteger(index) && index > 0 ? `${index}. ` : '';
  const body = mods ? `${mission} — ${challenge} · ${mods}` : `${mission} — ${challenge}`;
  return `${prefix}${body}`.slice(0, 300);
}

function descendiaFloors(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.challenges)) return [];
  return data.challenges
    .filter((row) => row && typeof row === 'object')
    .filter((row) => missionNameFromTypeKey(row.typeKey) || challengeName(row))
    .slice()
    .sort((left, right) => (Number(left.index) || 0) - (Number(right.index) || 0));
}

function discordStamp(iso, style) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '';
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

function descendiaDescription(data, count) {
  const heading = count === 1 ? 'Weekly Descent · 1 floor.' : `Weekly Descent · ${count} floors.`;
  const relative = discordStamp(data?.expiry, 'R');
  const absolute = discordStamp(data?.expiry, 'F');
  if (!relative) return heading.slice(0, 4096);
  return `${heading} Resets ${relative}${absolute ? ` (${absolute})` : ''}.`.slice(0, 4096);
}

function packFloorFields(lines, indexes) {
  const fields = [];
  let start = 0;
  while (start < lines.length && fields.length < 25) {
    let end = start;
    let value = '';
    while (end < lines.length) {
      const next = value ? `${value}\n${lines[end]}` : lines[end];
      const count = end - start + 1;
      if (end > start && (next.length > 1024 || count > 7)) break;
      value = next.slice(0, 1024);
      end += 1;
      if (next.length >= 1024 || count >= 7) break;
    }
    const first = indexes[start];
    const last = indexes[end - 1];
    const name = first && first === last ? `Floor ${first}` : `Floors ${first}–${last}`;
    fields.push({ name: String(name).slice(0, 256), value });
    start = end;
  }
  return fields;
}

function embedChars(body) {
  const fields = Array.isArray(body.fields) ? body.fields : [];
  return (body.title || '').length
    + (body.description || '').length
    + (body.footer?.text || '').length
    + fields.reduce((sum, field) => sum + String(field?.name || '').length + String(field?.value || '').length, 0);
}

function unavailableDescendiaEmbed() {
  return {
    title: DESCENDIA_TITLE,
    description: DESCENDIA_UNAVAILABLE,
    footer: { text: descendiaFooter() }
  };
}

function descendiaEmbed(data) {
  const floors = descendiaFloors(data);
  if (!floors.length) return unavailableDescendiaEmbed();
  const indexed = floors.map((floor) => ({
    index: Number(floor.index) || 0,
    line: floorLine(floor),
    plain: floorLine(floor, { modifiers: false })
  }));
  const description = descendiaDescription(data, floors.length);
  let fields = packFloorFields(indexed.map((item) => item.line), indexed.map((item) => item.index));
  let body = {
    title: DESCENDIA_TITLE,
    description,
    fields,
    footer: { text: descendiaFooter() }
  };
  if (embedChars(body) > 6000) {
    fields = packFloorFields(indexed.map((item) => item.plain), indexed.map((item) => item.index));
    body = { ...body, fields };
  }
  return body;
}

function descendiaWeekExpired(data, now = Date.now()) {
  if (!data || typeof data !== 'object') return false;
  const expiry = Date.parse(data.expiry || '');
  return Number.isFinite(expiry) && expiry <= now;
}

function descendiaRolloverDelay(expiry, now = Date.now()) {
  const at = Date.parse(expiry || '');
  if (!Number.isFinite(at)) return 0;
  const delay = at + ROLLOVER_GRACE_MS - now;
  if (delay <= 0) return 0;
  return Math.min(delay, MAX_TIMEOUT_MS);
}

function ephemeralEmbed(body) {
  return { embeds: [body], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

function ephemeralText(content) {
  return { content: String(content || '').slice(0, 1900), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

function descendiaCacheFor(context, env) {
  if (context.descendiaCache) return context.descendiaCache;
  context.descendiaCache = new TtlCache({
    ttlMs: panelInterval(env),
    load: async () => providerFor(context.provider).worldstate('descendia')
  });
  return context.descendiaCache;
}

async function readDescendia(context, env) {
  const cache = descendiaCacheFor(context, env);
  let loaded = await cache.get();
  if (!descendiaWeekExpired(loaded.value)) return loaded.value;
  cache.at = 0;
  loaded = await cache.get();
  return loaded.value;
}

async function handleDescendiaCommand(interaction, context = {}) {
  const env = context.env || process.env;
  try {
    const data = await readDescendia(context, env);
    await interaction.reply(ephemeralEmbed(descendiaEmbed(data)));
  } catch (error) {
    console.warn(`[Cephalon Nexus] descendia class=${errorClass(error)}`);
    await interaction.reply(ephemeralText('Descendia data unavailable. Try again in a minute.'));
  }
  return true;
}

async function refreshDescendiaIfDue(cache, now = Date.now()) {
  const partial = cache?.partial;
  if (!partial || typeof partial !== 'object') return partial;
  if (!descendiaWeekExpired(partial.descendia, now)) return partial;
  try {
    partial.descendia = await cache.provider.worldstate('descendia');
    partial.missing = (partial.missing || []).filter((key) => key !== 'descendia');
  } catch {
    partial.descendia = null;
    const missing = Array.isArray(partial.missing) ? partial.missing : [];
    if (!missing.includes('descendia')) missing.push('descendia');
    partial.missing = missing;
  }
  return partial;
}

function renderPanel(panel, partial) {
  if (panel.id === 'circuit') return circuitPanelEmbed(partial);
  if (panel.id === 'descendia') {
    const missing = (partial.missing || []).includes('descendia');
    return descendiaEmbed(missing ? null : partial.descendia);
  }
  if ((partial.missing || []).includes(panel.source)) return null;
  const raw = partial[panel.source];
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
  await retireNewsPanel({ client, env, dir }).catch((error) => {
    console.warn(`[Cephalon Nexus] warframe news retirement class=${errorClass(error)}`);
  });
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
  if (!targets.length) return { refreshed: 0, skipped, descendiaExpiry: '' };
  const source = providerFor(provider);
  const cache = snapshotCache(source, env);
  await cache.load();
  await refreshDescendiaIfDue(cache);
  const partial = cache.partial || { missing: [] };
  const descendiaExpiry = typeof partial.descendia?.expiry === 'string' ? partial.descendia.expiry : '';
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
  return { refreshed, skipped, descendiaExpiry };
}

function scheduleWarframePanels({ client, env = process.env, provider, dir } = {}) {
  const retirement = scheduleNewsRetirement({ client, env, dir });
  if (!warframePanelsConfigured(env)) return retirement;
  let running = false;
  let rolloverTimer = null;
  const clearRollover = () => {
    if (rolloverTimer) clearTimeout(rolloverTimer);
    rolloverTimer = null;
  };
  const tick = () => {
    if (running) return;
    running = true;
    refreshWarframePanels({ client, env, provider, dir })
      .then((result) => {
        clearRollover();
        const delay = descendiaRolloverDelay(result?.descendiaExpiry);
        if (!delay) return;
        rolloverTimer = setTimeout(tick, delay);
        rolloverTimer.unref?.();
      })
      .catch((error) => console.warn(`[Cephalon Nexus] warframe panels class=${errorClass(error)}`))
      .finally(() => { running = false; });
  };
  const initial = setTimeout(tick, 5000);
  initial.unref?.();
  const timer = setInterval(tick, panelInterval(env));
  timer.unref?.();
  return {
    stop() {
      retirement.stop();
      clearTimeout(initial);
      clearInterval(timer);
      clearRollover();
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
  missionNameFromTypeKey,
  descendiaEmbed,
  descendiaWeekExpired,
  descendiaRolloverDelay,
  handleDescendiaCommand,
  renderPanel,
  resolvePanelChannel,
  refreshWarframePanels,
  retireNewsPanel,
  scheduleWarframePanels
};
