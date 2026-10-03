'use strict';

const path = require('node:path');
const { MessageFlags } = require('discord.js');
const { errorClass } = require('./command-failure.cjs');
const { TtlCache } = require('./ttl-cache.cjs');
const { evaluateChannelCategory } = require('./category-gate.cjs');
const { WorldstateCache } = require('./warframe-worldstate.cjs');
const { PANEL_IDENTITIES, readJson, runtimeDataDir, snowflake, upsertEmbed, writeJson } = require('./panel-message.cjs');
const { attachBrandFiles, botAvatarUrl, brandEmbed } = require('../shared/embed-style.cjs');
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

const FOOTER_KEYS = Object.freeze({
  events: 'events',
  alerts: 'alerts',
  sortie: 'sortie',
  arbitration: 'arbitration',
  nightwave: 'nightwave',
  'void-trader': 'baro',
  'steel-path': 'steel-path',
  circuit: 'circuit',
  descendia: 'descendia',
  fissures: 'fissures',
  news: 'news'
});

function panelFooter(id) {
  return `Many Worlds One Nexus • ${FOOTER_KEYS[id] || id}`;
}

function legacyPanelFooter(id) {
  return `Cephalon Nexus • warframe:${id}`;
}

function externalBannerChannel(env, channelId) {
  const id = String(channelId || '');
  const welcome = snowflake(env?.CEPHALON_WELCOME_CHANNEL_ID);
  const event = snowflake(env?.CEPHALON_EVENT_CHANNEL_ID);
  if (welcome && welcome === id) return true;
  if (event && event === id && event !== welcome) return true;
  return false;
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
  const prefixes = (Array.isArray(footerPrefix) ? footerPrefix : [footerPrefix]).map((item) => String(item || '')).filter(Boolean);
  return (message) => {
    if (!owner || String(message?.author?.id || '') !== owner) return false;
    if (message?.webhookId) return false;
    const embed = message?.embeds?.[0] || null;
    const footer = String(embed?.footer?.text || embed?.data?.footer?.text || '');
    return prefixes.some((prefix) => footer.startsWith(prefix));
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

const DATA_CREDIT = '-# Data: WarframeStat';
const DESCENDIA_TITLE = '🕳️ Descendia';
const DESCENDIA_UNAVAILABLE = 'Descendia data unavailable';

function clip(value, max = 1024) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function present(spec, options = {}) {
  const banner = Boolean(options.banner);
  return brandEmbed('cephalon', {
    title: spec.title,
    description: spec.description,
    fields: spec.fields,
    footerKey: spec.footerKey,
    banner: banner ? 'auto' : 'none',
    thumbnail: banner ? 'none' : 'icon',
    avatarUrl: options.avatarUrl || ''
  }).embed;
}

function whenText(expiry, eta) {
  return discordStamp(expiry, 'R') || discordStamp(eta, 'R') || clip(eta, 40);
}

function withCredit(lines) {
  return [...(Array.isArray(lines) ? lines : [lines]).filter((line) => line != null && String(line).length), DATA_CREDIT].join('\n');
}

function cappedLines(lines, max = 5, overflow) {
  const clean = lines.filter(Boolean);
  if (clean.length <= max) return clean.join('\n');
  const room = Math.max(1, max - 1);
  const hidden = clean.length - room;
  return [...clean.slice(0, room), overflow || `+${hidden} more`].join('\n');
}

function challengeBuckets(challenges) {
  const buckets = { daily: [], weekly: [], elite: [] };
  for (const challenge of challenges) {
    if (challenge?.elite) buckets.elite.push(challenge);
    else if (challenge?.daily) buckets.daily.push(challenge);
    else buckets.weekly.push(challenge);
  }
  return buckets;
}

function challengeLine(challenge, done) {
  const mark = done ? '✅' : '▫️';
  const title = clip(challenge?.title || 'Challenge', 40) || 'Challenge';
  const standing = Number(challenge?.reputation) > 0 ? ` **${challenge.reputation}** standing` : '';
  return `${mark} **${title}**${standing}`;
}

function eventsEmbed(rows, options = {}) {
  const items = Array.isArray(rows) ? rows : [];
  const lines = items.map((item) => {
    const name = clip(item.description || item.node || 'Event', 40) || 'Event';
    const when = whenText(item.expiry, item.eta);
    const where = item.node && item.description ? clip(item.node, 30) : '';
    return [where && where !== name ? `${name} (${where})` : name, when ? `ends ${when}` : ''].filter(Boolean).join(' ');
  });
  return present({
    title: '📅 Events',
    description: withCredit([items.length ? `${items.length} active events.` : 'No active Warframe events.']),
    fields: lines.length ? [{ name: '📅 Now', value: cappedLines(lines) }] : [],
    footerKey: 'events'
  }, options);
}

function alertsEmbed(rows, options = {}) {
  const items = Array.isArray(rows) ? rows : [];
  const fields = items.slice(0, 5).map((item) => ({
    name: clip(item.node || 'Alert', 40) || 'Alert',
    value: [item.type, item.reward, whenText(item.expiry, item.eta) ? `⏳ ${whenText(item.expiry, item.eta)}` : ''].filter(Boolean).join('\n') || 'Active'
  }));
  const extra = items.length > 5 ? `+${items.length - 5} more` : '';
  return present({
    title: '🚨 Alerts',
    description: withCredit([items.length ? `${items.length} active alerts.` : 'No active alerts.', extra]),
    fields,
    footerKey: 'alerts'
  }, options);
}

function sortieEmbed(row, options = {}) {
  const sortie = row && typeof row === 'object' ? row : {};
  const variants = Array.isArray(sortie.variants) ? sortie.variants : [];
  const when = whenText(sortie.expiry, sortie.eta);
  const heading = [sortie.boss, sortie.faction].filter(Boolean).join(' · ');
  return present({
    title: '🎯 Sortie',
    description: withCredit([heading || 'No sortie reported.', when ? `⏳ Ends ${when}` : '']),
    fields: variants.slice(0, 5).map((variant) => ({
      name: clip(variant.node || variant.mission || 'Mission', 40) || 'Mission',
      value: [variant.mission, variant.modifier].filter(Boolean).join('\n') || 'Mission'
    })),
    footerKey: 'sortie'
  }, options);
}

function arbitrationEmbed(row, options = {}) {
  const item = row && typeof row === 'object' ? row : {};
  const when = whenText(item.expiry, item.eta);
  const known = item.node || item.mission || item.enemy;
  return present({
    title: '⚖️ Arbitration',
    description: withCredit([known ? (when ? `⏳ Ends ${when}` : 'Active now.') : 'No arbitration reported.']),
    fields: known ? [
      { name: 'Node', value: clip(item.node || '—', 40), inline: true },
      { name: 'Mission', value: clip(item.mission || '—', 40), inline: true },
      { name: 'Enemy', value: clip(item.enemy || '—', 40), inline: true }
    ] : [],
    footerKey: 'arbitration'
  }, options);
}

function nightwaveEmbed(row, options = {}) {
  const board = row && typeof row === 'object' ? row : {};
  const challenges = Array.isArray(board.challenges) ? board.challenges : [];
  const buckets = challengeBuckets(challenges);
  const when = whenText(board.expiry, board.eta);
  const heading = [`Season ${board.season || 'unknown'}`, board.phase != null ? `phase ${board.phase}` : ''].filter(Boolean).join(' · ');
  return present({
    title: '🌙 Nightwave',
    description: withCredit([heading || 'Nightwave', when ? `⏳ Ends ${when}` : '']),
    fields: [
      { name: '📅 Daily', value: cappedLines(buckets.daily.map((item) => challengeLine(item, false))) || 'Nothing right now.' },
      { name: '🗓️ Weekly', value: cappedLines(buckets.weekly.map((item) => challengeLine(item, false))) || 'Nothing right now.' },
      { name: '👑 Elite', value: cappedLines(buckets.elite.map((item) => challengeLine(item, false))) || 'Nothing right now.' }
    ],
    footerKey: 'nightwave'
  }, options);
}

function voidTraderEmbed(row, options = {}) {
  const trader = row && typeof row === 'object' ? row : {};
  const inventory = Array.isArray(trader.inventory) ? trader.inventory : [];
  const place = trader.active ? (trader.location || 'In the system') : 'Away';
  const when = whenText(trader.active ? trader.expiry : (trader.activation || trader.expiry), trader.eta);
  const verb = trader.active ? 'Leaves' : 'Back';
  const ducats = [];
  const credits = [];
  for (const item of inventory) {
    const name = clip(item.item || 'Item', 40);
    if (!name) continue;
    if (Number(item.ducats) > 0) ducats.push(`${name}: ${item.ducats} 💎`);
    if (Number(item.credits) > 0) credits.push(`${name}: ${Number(item.credits).toLocaleString('en-US')} credits`);
  }
  const fields = [];
  if (ducats.length) fields.push({ name: '💎 Ducats', value: cappedLines(ducats, 8, `+${Math.max(0, ducats.length - 7)} more on /baro`) });
  if (credits.length) fields.push({ name: '💰 Credits', value: cappedLines(credits, 8, `+${Math.max(0, credits.length - 7)} more on /baro`) });
  if (!fields.length) fields.push({ name: '💎 Ducats', value: 'No inventory listed.' });
  return present({
    title: "💎 Baro Ki'Teer",
    description: withCredit([`📍 ${place}`, `⏳ ${verb} ${when || 'soon'}`]),
    fields,
    footerKey: 'baro'
  }, options);
}

function steelPathEmbed(row, options = {}) {
  const board = row && typeof row === 'object' ? row : {};
  const rotation = Array.isArray(board.rotation) ? board.rotation : [];
  const when = whenText(board.expiry, board.remaining);
  const reward = board.currentReward ? `Current reward: ${board.currentReward}` : 'No current reward listed.';
  const lines = rotation.map((item) => (item.cost ? `${item.name}: ${item.cost}` : item.name));
  return present({
    title: '⚔️ Steel Path',
    description: withCredit([reward, when ? `⏳ ${when}` : '']),
    fields: lines.length ? [{ name: 'Rotation', value: cappedLines(lines) }] : [],
    footerKey: 'steel-path'
  }, options);
}

function circuitPanelEmbed(partial, options = {}) {
  return circuitEmbed({
    duviri: partial.duviri,
    steelPath: partial.steelPath,
    archimedea: partial.archimedea,
    missing: (partial.missing || []).filter((key) => key === 'duviri' || key === 'steelPath' || key === 'archimedea')
  }, {
    banner: options.banner ? 'auto' : 'none',
    thumbnail: options.banner ? 'none' : 'icon',
    avatarUrl: options.avatarUrl || '',
    footerKey: 'circuit'
  });
}
const ROLLOVER_GRACE_MS = 5_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

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

function modifierSummary(floor, max = 56) {
  const auras = namedModifiers(floor?.auras);
  const source = auras.length ? auras : namedModifiers(floor?.specs);
  return source.join(', ').slice(0, max);
}

function floorBlock(floor) {
  const index = Number(floor?.index);
  const mission = missionNameFromTypeKey(floor?.typeKey) || 'Mission';
  const challenge = challengeName(floor) || 'Challenge';
  const label = Number.isInteger(index) && index > 0 ? `Floor ${index}` : 'Floor';
  const lines = [`${label}: ${mission} (${challenge})`];
  const mods = modifierSummary(floor);
  if (mods) lines.push(`└ ${mods}`);
  return { index: Number.isInteger(index) && index > 0 ? index : 0, lines };
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
  const when = relative ? `Resets ${relative}${absolute ? ` (${absolute})` : ''}.` : '';
  return [heading, when, DATA_CREDIT].filter(Boolean).join('\n');
}

function floorField(bucket) {
  const indexes = bucket.map((item) => item.index).filter((index) => index > 0);
  const first = indexes[0];
  const last = indexes[indexes.length - 1];
  const name = !first ? 'More' : (first === last ? `Floor ${first}` : `Floors ${first}–${last}`);
  return { name, value: bucket.flatMap((item) => item.lines).join('\n') };
}

function packFloorBlocks(blocks) {
  const fields = [];
  let cursor = 0;
  while (cursor < blocks.length && fields.length < 6) {
    const bucket = [];
    let lines = 0;
    const lastField = fields.length === 5;
    while (cursor < blocks.length) {
      const block = blocks[cursor];
      const remainAfter = blocks.length - (cursor + 1);
      const reserve = lastField && remainAfter > 0 ? 1 : 0;
      if (lines + block.lines.length + reserve > 5) break;
      bucket.push(block);
      lines += block.lines.length;
      cursor += 1;
    }
    if (!bucket.length) break;
    const hidden = blocks.length - cursor;
    if (lastField && hidden > 0) bucket.push({ index: 0, lines: [`+${hidden} more`] });
    fields.push(floorField(bucket));
    if (lastField) break;
  }
  return fields;
}

function unavailableDescendiaEmbed(options = {}) {
  return present({
    title: DESCENDIA_TITLE,
    description: DESCENDIA_UNAVAILABLE,
    fields: [],
    footerKey: 'descendia'
  }, options);
}

function descendiaEmbed(data, options = {}) {
  const floors = descendiaFloors(data);
  if (!floors.length) return unavailableDescendiaEmbed(options);
  return present({
    title: DESCENDIA_TITLE,
    description: descendiaDescription(data, floors.length),
    fields: packFloorBlocks(floors.map(floorBlock)),
    footerKey: 'descendia'
  }, options);
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
  return attachBrandFiles({ embeds: [body], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
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

function renderPanel(panel, partial, options = {}) {
  if (panel.id === 'circuit') return circuitPanelEmbed(partial, options);
  if (panel.id === 'descendia') {
    const missing = (partial.missing || []).includes('descendia');
    return descendiaEmbed(missing ? null : partial.descendia, options);
  }
  if ((partial.missing || []).includes(panel.source)) return null;
  const raw = partial[panel.source];
  if (panel.id === 'events') return eventsEmbed(summarizeEvents(raw), options);
  if (panel.id === 'alerts') return alertsEmbed(summarizeAlerts(raw), options);
  if (panel.id === 'sortie') return sortieEmbed(summarizeSortie(raw), options);
  if (panel.id === 'arbitration') return arbitrationEmbed(summarizeArbitration(raw), options);
  if (panel.id === 'nightwave') return nightwaveEmbed(summarizeNightwave(raw), options);
  if (panel.id === 'void-trader') return voidTraderEmbed(summarizeVoidTrader(raw), options);
  if (panel.id === 'steel-path') return steelPathEmbed(summarizeSteelPath(raw), options);
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
    matches: ownedFooterMatcher(botId, [panelFooter(panel.id), legacyPanelFooter(panel.id)]),
    banner: false
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
  const claimedBanners = new Set();
  for (const target of targets) {
    const channelId = String(target.channel.id);
    if (externalBannerChannel(env, channelId) || claimedBanners.has(channelId)) target.banner = false;
    else {
      claimedBanners.add(channelId);
      target.banner = true;
    }
  }
  const avatarUrl = botAvatarUrl(client);
  const source = providerFor(provider);
  const cache = snapshotCache(source, env);
  await cache.load();
  await refreshDescendiaIfDue(cache);
  const partial = cache.partial || { missing: [] };
  const descendiaExpiry = typeof partial.descendia?.expiry === 'string' ? partial.descendia.expiry : '';
  for (const { panel, channel, banner } of targets) {
    const rendered = renderPanel(panel, partial, { banner, avatarUrl });
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
