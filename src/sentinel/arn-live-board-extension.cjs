'use strict';

const fs = require('node:fs');
const path = require('node:path');
const discord = require('discord.js');
const { ChannelType, Client, Events, PermissionFlagsBits, Routes } = discord;
const { loadConfig } = require('../shared/config.cjs');
const { getArnWebhookRegistry, discoverNamedWebhooks, ARN_INTAKE_CHANNEL_NAME } = require('./arn-intake-extension.cjs');
const { pruneStaleActive, resolveLifecyclePolicy } = require('./arn-lifecycle-policy.cjs');
const { observeFromDiscordMessage, journalPath } = require('./arn-token-award.cjs');

const INSTALLED = Symbol.for('khaos.nexus.arnLiveBoard.extension');
const GUILD_MESSAGES = Symbol.for('khaos.nexus.arn.guildMessages');
const boundClients = new WeakSet();
const ARN_PUBLIC_CHANNEL_NAME = 'arn';
const ARN_PUBLIC_TOPIC = 'Anomaly Response Network — live Shiny! Dinos detections and lifecycle tracking across the Khaos Nexus ARK cluster.';
const INFO_MARKER = 'ARN • NETWORK BRIEFING';
const BOARD_MARKER = 'ARN • LIVE BOUNTY BOARD';
const RESOLVED_LINGER_MS = 15 * 60 * 1000;
const REPLAY_PAGE_SIZE = 50;
const REPLAY_MAX_PAGES = 2;
const PANEL_SCAN_LIMIT = 50;
const BOARD_REFRESH_MS = 60 * 1000;
const SETUP_RETRY_BASE_MS = 20_000;
const SETUP_RETRY_CAP_MS = 5 * 60_000;

const state = {
  guildId: '',
  publicChannelId: '',
  intakeChannelId: '',
  infoMessageId: '',
  boardMessageId: '',
  anomalies: new Map(),
  refreshTimer: null,
  retryTimer: null,
  setupWork: null
};

let publicChannelFlight = null;
let panelFlight = null;
let knownPublic = null;

const clean = (value, max = 180) => String(value || '')
  .replace(/[\r\n\0]+/g, ' ')
  .replace(/[@`]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

function cleanDinoName(value) {
  return clean(value, 180)
    .replace(/^\*{1,3}\s*/, '')
    .replace(/\s*\*{1,3}$/, '')
    .replace(/^_{1,3}\s*/, '')
    .replace(/\s*_{1,3}$/, '')
    .trim();
}

function normalizeMapName(value) {
  const raw = clean(value, 100);
  if (/astraeos/i.test(raw)) return 'Astraeos';
  if (/gen(?:esis)?\s*1/i.test(raw) || /genesis/i.test(raw)) return 'Genesis 1';
  return raw;
}

function payloadText(payload = {}) {
  const lines = [];
  if (payload.content) lines.push(payload.content);
  for (const embed of Array.isArray(payload.embeds) ? payload.embeds : []) {
    lines.push(embed?.title, embed?.description, embed?.footer?.text);
    for (const field of Array.isArray(embed?.fields) ? embed.fields : []) lines.push(field?.name, field?.value);
  }
  return lines.map((line) => String(line || '').trim()).filter(Boolean).join('\n');
}

function mapFromFooter(payload = {}) {
  for (const embed of Array.isArray(payload.embeds) ? payload.embeds : []) {
    const footer = String(embed?.footer?.text || '');
    const match = footer.match(/\(([^()]+)\)\s*$/);
    if (match) return normalizeMapName(match[1]);
  }
  return '';
}

function lifecycleFromText(title, description) {
  const joined = `${title} ${description}`.toLowerCase();
  if (/signal\s+lost|no longer detectable|despawn(?:ed)?|dissipat(?:ed|ed)/i.test(joined)) return 'SIGNAL_LOST';
  if (/captur(?:ed|e)|tam(?:ed|e)/i.test(joined)) return 'CAPTURED';
  if (/defeat(?:ed)?|kill(?:ed)?|slain/i.test(joined)) return 'DEFEATED';
  if (/anomaly\s+detected|detected\s+on|\bhas\s+spawned\b|\bspawned\s+at\b/i.test(joined)) return 'ACTIVE';
  return '';
}

function coordinatesFromText(value) {
  const text = String(value || '').replace(/\*+/g, ' ');
  const match = text.match(/Lat(?:itude)?\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*(?:\/|,|\s)+\s*Lon(?:gitude)?\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i);
  if (!match) return { lat: null, lon: null };
  return { lat: Number(match[1]), lon: Number(match[2]) };
}

function parseShinyDiscordPayload(payload = {}, authoritativeMap = '') {
  const embed = Array.isArray(payload.embeds) ? payload.embeds[0] || {} : {};
  const title = clean(embed.title || payload.title, 200);
  const description = clean(embed.description || payload.description || payload.content, 1000);
  const lifecycle = lifecycleFromText(title, description);
  if (!lifecycle) return null;

  let dinoName = '';
  let mapName = normalizeMapName(authoritativeMap || mapFromFooter(payload));
  let lat = null;
  let lon = null;

  const detected = description.match(/^(.+?)\s+detected\s+on\s+(.+?)\s+at\s+Lat\s+(-?\d+(?:\.\d+)?)\s*\/\s*Lon\s+(-?\d+(?:\.\d+)?)/i);
  const spawned = description.match(/^(.+?)\s+has\s+spawned(?:\s+at\s+(.+?))?[!.]?$/i);
  const lost = description.match(/^(.+?)\s+is\s+no\s+longer\s+detectable(?:\s+on\s+(?:the\s+network|(.+?)))?\.?$/i);
  const despawned = description.match(/^(.+?)\s+has\s+despawned\b/i);
  const resolved = description.match(/^(.+?)(?:\s+on\s+(.+?))?\s+(?:was|has been|is)\s+(?:captured|tamed|defeated|killed|slain)/i);
  const nativeResolved = description.match(/^(.+?)\s+has\s+been\s+(tamed|killed)\b/i);

  if (detected) {
    dinoName = cleanDinoName(detected[1]);
    if (!mapName) mapName = normalizeMapName(detected[2]);
    lat = Number(detected[3]);
    lon = Number(detected[4]);
  } else if (spawned) {
    dinoName = cleanDinoName(spawned[1]);
    const coords = coordinatesFromText(spawned[2] || description);
    lat = coords.lat;
    lon = coords.lon;
  } else if (lost) {
    dinoName = cleanDinoName(lost[1]);
    if (!mapName && lost[2]) mapName = normalizeMapName(lost[2]);
  } else if (despawned) {
    dinoName = cleanDinoName(despawned[1]);
  } else if (nativeResolved) {
    dinoName = cleanDinoName(nativeResolved[1]);
  } else if (resolved) {
    dinoName = cleanDinoName(resolved[1]);
    if (!mapName && resolved[2]) mapName = normalizeMapName(resolved[2]);
  }

  if (!dinoName || !mapName) return null;
  return {
    lifecycle,
    dinoName,
    mapName,
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    sourceText: payloadText(payload).slice(0, 2000)
  };
}

function classifyThreat(dinoName) {
  const name = String(dinoName || '');
  if (/\benraged\b/i.test(name)) return { level: 'KAIJU', rank: 100, note: 'Enraged anomaly — extreme threat.' };
  return { level: 'WATCH', rank: 10, note: 'Standard anomaly observation.' };
}

function anomalyKey(event) {
  return `${normalizeMapName(event.mapName).toLowerCase()}|${cleanDinoName(event.dinoName).toLowerCase()}`;
}

function applyEvent(event, occurredAt = Date.now()) {
  const key = anomalyKey(event);
  if (event.lifecycle === 'ACTIVE') {
    const threat = classifyThreat(event.dinoName);
    state.anomalies.set(key, {
      ...event,
      threat,
      status: 'ACTIVE',
      detectedAt: occurredAt,
      updatedAt: occurredAt,
      resolvedAt: null
    });
    return state.anomalies.get(key);
  }

  const current = state.anomalies.get(key);
  if (!current) return null;
  const status = event.lifecycle === 'CAPTURED' ? 'CAPTURED' : event.lifecycle === 'DEFEATED' ? 'DEFEATED' : 'SIGNAL LOST';
  const next = { ...current, status, updatedAt: occurredAt, resolvedAt: occurredAt };
  state.anomalies.set(key, next);
  return next;
}

function pruneResolved(now = Date.now()) {
  const expired = pruneStaleActive(state.anomalies, now, resolveLifecyclePolicy());
  for (const item of expired) {
    console.log(`[Nexus Sentinal] ARN stale spawn auto-removed: map=${item.mapName} dino=${item.dinoName} reason=${item.reason}`);
  }
  for (const [key, item] of state.anomalies) {
    if (item.status !== 'ACTIVE' && item.resolvedAt && now - item.resolvedAt >= RESOLVED_LINGER_MS) state.anomalies.delete(key);
  }
}

function sortedAnomalies(now = Date.now()) {
  pruneResolved(now);
  return [...state.anomalies.values()].sort((a, b) => {
    if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1;
    if (a.status !== 'ACTIVE' && b.status === 'ACTIVE') return 1;
    if ((b.threat?.rank || 0) !== (a.threat?.rank || 0)) return (b.threat?.rank || 0) - (a.threat?.rank || 0);
    return (b.detectedAt || 0) - (a.detectedAt || 0);
  });
}

function formatAge(timestamp, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - Number(timestamp || now)) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

function infoEmbed() {
  const policy = resolveLifecyclePolicy();
  const expiryHours = policy.hardExpiryMs ? (policy.hardExpiryMs / 3600000).toFixed(1).replace(/\.0$/, '') : 'disabled';
  return {
    color: 0xb00020,
    title: '🧬 ANOMALY RESPONSE NETWORK',
    description: 'The **Anomaly Response Network (ARN)** tracks Shiny! Dinos detections across the Khaos Nexus ARK cluster. Sentinel receives the native per-map Shiny webhook signal, identifies the originating map by webhook identity, and keeps the live board below updated in place.',
    fields: [
      { name: '📡 How it works', value: 'A Shiny detection enters the private ARN intake bus → Sentinel validates the source map → the anomaly is added to this live board. Lifecycle signals update the same tracked anomaly instead of creating chat spam.' },
      { name: '🚦 Status', value: '**ACTIVE** — currently detectable\n**CAPTURED** — successfully tamed/captured\n**DEFEATED** — killed/defeated\n**SIGNAL LOST** — no longer detectable' },
      { name: '☢️ Threat Level', value: '**KAIJU** is reserved for **Enraged** anomalies. Other traits remain conservatively classified until their documented Shiny ability behavior is mapped into ARN.' },
      { name: '🗺️ Tracking', value: `Coordinates shown here come directly from the native Shiny detection notification. Color/appearance names do **not** create artificial rarity or threat tiers. Stale ACTIVE entries are automatically removed after the configured Shiny maximum lifetime${policy.hardExpiryMs ? ` plus grace (${expiryHours}h total)` : ''}.` }
    ],
    footer: { text: INFO_MARKER }
  };
}

function boardEmbed(now = Date.now()) {
  const items = sortedAnomalies(now);
  const active = items.filter((item) => item.status === 'ACTIVE').length;
  const fields = [];
  const grouped = new Map();
  for (const item of items) {
    const list = grouped.get(item.mapName) || [];
    list.push(item);
    grouped.set(item.mapName, list);
  }

  for (const [mapName, list] of grouped) {
    const lines = list.slice(0, 12).map((item) => {
      const coords = item.lat !== null && item.lon !== null ? ` • Lat ${item.lat} / Lon ${item.lon}` : '';
      const statusIcon = item.status === 'ACTIVE' ? '🟢' : item.status === 'CAPTURED' ? '🔵' : item.status === 'DEFEATED' ? '⚔️' : '⚫';
      return `${statusIcon} **${item.dinoName}** — Threat Level - **${item.threat.level}**\n${item.status}${coords} • ${formatAge(item.updatedAt, now)}`;
    });
    fields.push({ name: `🗺️ ${mapName}`, value: lines.join('\n\n').slice(0, 1024) || 'No tracked anomalies.' });
  }

  if (!fields.length) fields.push({ name: '📡 Network clear', value: 'No active anomalies are currently tracked. ARN is standing by for the next Shiny detection.' });
  return {
    color: active ? 0xe53935 : 0x455a64,
    title: '📡 ARN • LIVE ANOMALY BOUNTY BOARD',
    description: `**${active} active** anomal${active === 1 ? 'y' : 'ies'} across the tracked ARK cluster. Highest threat signals are shown first. Resolved signals remain briefly for confirmation, then clear automatically.`,
    fields: fields.slice(0, 25),
    footer: { text: `${BOARD_MARKER} • Sentinel managed • Last refresh` },
    timestamp: new Date(now).toISOString()
  };
}

function findArkCategory(channels) {
  return [...channels.values()].find((item) => item?.type === ChannelType.GuildCategory && /^\s*ark\s*$/i.test(String(item.name || '')))
    || [...channels.values()].find((item) => item?.type === ChannelType.GuildCategory && /\bark\b/i.test(String(item.name || '')))
    || null;
}

async function createPublicChannel(guild, channels) {
  if (knownPublic?.channel) return knownPublic;
  const list = channels || await guild.channels.fetch();
  const category = findArkCategory(list);
  if (!category) {
    const error = new Error('category-not-found');
    error.reasonCode = 'category-not-found';
    throw error;
  }
  let channel = [...list.values()].find((item) => item?.type === ChannelType.GuildText && String(item.name || '').toLowerCase() === ARN_PUBLIC_CHANNEL_NAME);
  if (!channel) {
    channel = await guild.channels.create({
      name: ARN_PUBLIC_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: String(category.id),
      topic: ARN_PUBLIC_TOPIC,
      reason: 'Nexus Sentinel ARN public live board'
    });
  }
  knownPublic = { channel, category };
  return knownPublic;
}

function ensurePublicChannel(guild, channels) {
  if (!publicChannelFlight) {
    publicChannelFlight = createPublicChannel(guild, channels).finally(() => {
      publicChannelFlight = null;
    });
  }
  return publicChannelFlight;
}

async function organizePublicChannel(channel, category) {
  if (!channel || !category) return;
  if (String(channel.parentId || '') !== String(category.id)) {
    await channel.setParent(String(category.id), { lockPermissions: false, reason: 'Nexus Sentinel ARN channel organization' });
  }
  if (String(channel.topic || '') !== ARN_PUBLIC_TOPIC) {
    await channel.setTopic(ARN_PUBLIC_TOPIC, 'Nexus Sentinel ARN topic reconciliation');
  }
}

function isOwnPanelMessage(message, marker, botId) {
  if (!botId || String(message?.author?.id || '') !== String(botId)) return false;
  return (message.embeds || []).some((embed) => {
    const footer = String(embed?.footer?.text || '');
    return footer === marker || footer.startsWith(`${marker} • Sentinel managed`);
  });
}

function boardRecordPath(env = process.env) {
  return path.join(path.dirname(journalPath(env)), 'arn-live-board.json');
}

function readBoardRecord(env = process.env) {
  try {
    const parsed = JSON.parse(fs.readFileSync(boardRecordPath(env), 'utf8'));
    const infoMessageId = String(parsed?.infoMessageId || '').replace(/\D/g, '');
    const boardMessageId = String(parsed?.boardMessageId || '').replace(/\D/g, '');
    if (!infoMessageId && !boardMessageId) return null;
    return { infoMessageId, boardMessageId };
  } catch {
    return null;
  }
}

function writeBoardRecord(record, env = process.env) {
  const target = boardRecordPath(env);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const body = JSON.stringify({
    infoMessageId: String(record.infoMessageId || ''),
    boardMessageId: String(record.boardMessageId || '')
  });
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, body);
  fs.renameSync(temporary, target);
}

async function fetchOwnedPanelMessage(channel, id, marker, botId) {
  if (!id) return null;
  try {
    const message = await channel.messages.fetch(id);
    return isOwnPanelMessage(message, marker, botId) ? message : null;
  } catch {
    return null;
  }
}

async function placePanelMessages(channel, botId, env) {
  const stored = readBoardRecord(env);
  let info = await fetchOwnedPanelMessage(channel, stored?.infoMessageId, INFO_MARKER, botId);
  let board = await fetchOwnedPanelMessage(channel, stored?.boardMessageId, BOARD_MARKER, botId);
  if (!info || !board) {
    const recent = await channel.messages.fetch({ limit: PANEL_SCAN_LIMIT });
    const owned = [...recent.values()];
    if (!info) info = owned.find((message) => isOwnPanelMessage(message, INFO_MARKER, botId));
    if (!board) board = owned.find((message) => isOwnPanelMessage(message, BOARD_MARKER, botId));
  }
  if (!info) info = await channel.send({ embeds: [infoEmbed()], allowedMentions: { parse: [] } });
  else await info.edit({ embeds: [infoEmbed()], allowedMentions: { parse: [] } });
  if (!board) board = await channel.send({ embeds: [boardEmbed()], allowedMentions: { parse: [] } });
  else await board.edit({ embeds: [boardEmbed()], allowedMentions: { parse: [] } });
  state.infoMessageId = String(info.id);
  state.boardMessageId = String(board.id);
  try {
    writeBoardRecord({ infoMessageId: info.id, boardMessageId: board.id }, env);
  } catch (error) {
    warnLiveBoardStep(console, error, 'panel-record');
  }
  return { info, board };
}

function ensurePanelMessages(channel, botId, options = {}) {
  if (!panelFlight) {
    panelFlight = placePanelMessages(channel, botId, options.env).finally(() => {
      panelFlight = null;
    });
  }
  return panelFlight;
}

async function refreshBoard(client) {
  if (!state.publicChannelId || !state.boardMessageId) return false;
  const channel = await client.channels.fetch(state.publicChannelId);
  if (!channel?.isTextBased?.()) return false;
  const message = await channel.messages.fetch(state.boardMessageId);
  await message.edit({ embeds: [boardEmbed()], allowedMentions: { parse: [] } });
  return true;
}

function messagePayload(message) {
  return {
    content: message?.content,
    embeds: (message?.embeds || []).map((embed) => (embed?.toJSON ? embed.toJSON() : embed))
  };
}

async function rawMessagePayload(client, message) {
  // Gateway deliveries omit content and embeds when Message Content is off.
  // Webhook history and a single REST read still include the embed.
  try {
    return await client.rest.get(Routes.channelMessage(String(message.channelId), String(message.id)));
  } catch (error) {
    console.warn(`[Nexus Sentinal] ARN message read failed; using gateway payload: ${cleanLog(error)}`);
    return messagePayload(message);
  }
}

const SETUP_DELAY_MS = 105_000;
const SETUP_TIMEOUT_MS = 20_000;

function cleanLog(error) {
  return String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 350);
}

function sanitizeStep(value) {
  const step = String(value || '').trim().toLowerCase();
  return /^[a-z0-9+][a-z0-9+-]{0,59}$/.test(step) ? step : 'setup';
}

function liveBoardReason(error) {
  const status = Number(error?.status || error?.httpStatus || error?.statusCode || 0);
  const name = String(error?.name || '');
  const code = String(error?.code || error?.reasonCode || '');
  if (code === 'timeout' || name === 'AbortError') return 'timeout';
  if (status === 429 || name === 'RateLimitError' || code === '429' || code === 'rate-limited') return 'rate-limited';
  if (status === 403 || code === '50013' || code === 'missing-access') return 'missing-access';
  if (status === 404 || code === '10003' || code === 'unknown-channel') return 'unknown-channel';
  if (code === '10004' || code === 'unknown-guild') return 'unknown-guild';
  if (code === 'category-not-found') return 'category-not-found';
  const message = String(error?.message || '');
  if (/rate limit/i.test(message)) return 'rate-limited';
  if (/timed out|timeout/i.test(message)) return 'timeout';
  if (/missing permissions|missing access/i.test(message)) return 'missing-access';
  return 'failed';
}

function warnLiveBoardStep(logger, error, fallbackStep, late = false) {
  const step = sanitizeStep(error?.step || fallbackStep);
  const reason = liveBoardReason(error);
  const label = late ? 'unavailable (late)' : 'step failed';
  logger.warn?.(`[Nexus Sentinal] ARN live board ${label}: step=${step} reason=${reason}`);
}

async function runArnLiveBoardSetup(client, options = {}) {
  const logger = options.logger || console;
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : SETUP_TIMEOUT_MS;
  const inflight = new Set();
  let step = 'setup';
  const hooks = {
    noteStep(name) {
      inflight.add(sanitizeStep(name));
      step = [...inflight].join('+') || step;
    },
    doneStep(name) {
      inflight.delete(sanitizeStep(name));
      step = [...inflight].join('+') || step;
    }
  };
  const reconcile = options.reconcile
    || ((active, hook) => reconcileArnLiveBoard(active, options.config || loadConfig(), { ...options, ...hook }));
  let timer;
  const pending = Promise.resolve()
    .then(() => reconcile(client, hooks))
    .then((result) => ({ result }))
    .catch((error) => ({ error }));
  state.setupWork = pending;
  pending.finally(() => {
    if (state.setupWork === pending) state.setupWork = null;
  });
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timeout: true }), timeoutMs);
  });
  const outcome = await Promise.race([pending, timeout]);
  clearTimeout(timer);
  function finishLate(late) {
    if (!late) return;
    if (late.error) {
      warnLiveBoardStep(logger, late.error, step, true);
      return;
    }
    const result = late.result || {};
    if (result.skipped) {
      logger.warn(`[Nexus Sentinal] ARN live board skipped: ${result.skipped}`);
      return;
    }
    logger.log(`[Nexus Sentinal] ARN live board ready (late): publicChannel=${result.publicChannelId} intakeChannel=${result.intakeChannelId} tracked=${result.tracked}`);
    if (typeof options.onReady === 'function') options.onReady(result);
  }
  if (outcome.timeout) {
    logger.warn(`[Nexus Sentinal] ARN live board unavailable: setup-timeout step=${sanitizeStep(step)}`);
    pending.then(finishLate).catch((error) => warnLiveBoardStep(logger, error, step, true));
    return { unavailable: 'setup-timeout', step: sanitizeStep(step) };
  }
  if (outcome.error) {
    warnLiveBoardStep(logger, outcome.error, step, false);
    return { unavailable: liveBoardReason(outcome.error), step: sanitizeStep(outcome.error.step || step) };
  }
  const result = outcome.result || {};
  if (result.skipped) {
    logger.warn(`[Nexus Sentinal] ARN live board skipped: ${result.skipped}`);
    return result;
  }
  logger.log(`[Nexus Sentinal] ARN live board ready: publicChannel=${result.publicChannelId} intakeChannel=${result.intakeChannelId} tracked=${result.tracked}`);
  if (typeof options.onReady === 'function') options.onReady(result);
  return result;
}

function setupRetryDelay(attempt, options = {}) {
  if (Array.isArray(options.retryDelays) && options.retryDelays.length) {
    const index = Math.min(Math.max(0, attempt), options.retryDelays.length - 1);
    return Number(options.retryDelays[index]);
  }
  return Math.min(SETUP_RETRY_CAP_MS, SETUP_RETRY_BASE_MS * (2 ** Math.min(attempt, 4)));
}

function armArnLiveBoard(client, options = {}) {
  const logger = options.logger || console;
  const delayMs = Number.isFinite(Number(options.delayMs)) ? Number(options.delayMs) : SETUP_DELAY_MS;
  let attempt = 0;
  let ready = false;
  const run = (wait) => {
    const timer = setTimeout(() => {
      if (ready) return;
      if (state.setupWork) {
        const waitMs = setupRetryDelay(Math.max(0, attempt - 1), options);
        logger.warn?.(`[Nexus Sentinal] ARN live board retry: attempt=${Math.max(attempt, 1)} waitMs=${waitMs} pending`);
        state.retryTimer = run(waitMs);
        return;
      }
      void runArnLiveBoardSetup(client, {
        ...options,
        onReady(result) {
          ready = true;
          if (state.retryTimer) clearTimeout(state.retryTimer);
          if (typeof options.onReady === 'function') options.onReady(result);
        }
      }).then((result) => {
        if (ready || result?.unavailable !== 'setup-timeout') return;
        const waitMs = setupRetryDelay(attempt, options);
        attempt += 1;
        logger.warn?.(`[Nexus Sentinal] ARN live board retry: attempt=${attempt} waitMs=${waitMs}`);
        state.retryTimer = run(waitMs);
      }).catch((error) => warnLiveBoardStep(logger, error, 'setup'));
    }, wait);
    timer.unref?.();
    state.retryTimer = timer;
    return timer;
  };
  return run(delayMs);
}

function oldestMessageId(messages) {
  let oldest = '';
  for (const message of messages.values()) {
    const id = String(message?.id || '');
    if (!/^\d+$/.test(id)) continue;
    if (!oldest || BigInt(id) < BigInt(oldest)) oldest = id;
  }
  return oldest;
}

function applyReplayEvent(event, occurredAt) {
  const current = state.anomalies.get(anomalyKey(event));
  if (current && Number(current.updatedAt || 0) > Number(occurredAt || 0)) return false;
  applyEvent(event, occurredAt);
  return true;
}

async function replayIntake(client, channel, options = {}) {
  const pageSize = Number.isFinite(Number(options.pageSize)) ? Number(options.pageSize) : REPLAY_PAGE_SIZE;
  const maxPages = Number.isFinite(Number(options.maxPages)) ? Number(options.maxPages) : REPLAY_MAX_PAGES;
  const registry = getArnWebhookRegistry();
  const ordered = [];
  let before = '';
  for (let page = 0; page < maxPages; page += 1) {
    const query = { limit: pageSize };
    if (before) query.before = before;
    const batch = await channel.messages.fetch(query);
    const values = [...batch.values()];
    if (!values.length) break;
    ordered.push(...values);
    before = oldestMessageId(batch);
    if (values.length < pageSize || !before) break;
  }
  ordered.sort((a, b) => Number(a.createdTimestamp || 0) - Number(b.createdTimestamp || 0));
  let accepted = 0;
  for (const message of ordered) {
    if (!message.webhookId) continue;
    const authoritativeMap = registry.get(String(message.webhookId));
    if (!authoritativeMap) continue;
    // History fetch is REST, so embeds are present without the Message Content intent.
    const payload = messagePayload(message);
    const event = parseShinyDiscordPayload(payload, authoritativeMap);
    if (!event) continue;
    if (applyReplayEvent(event, Number(message.createdTimestamp || Date.now()))) accepted += 1;
  }
  pruneResolved();
  options.logger?.log?.(`[Nexus Sentinal] ARN live board replayed: count=${accepted}`);
  return accepted;
}

async function trackLiveBoardStep(name, work, options = {}) {
  const step = sanitizeStep(name);
  options.noteStep?.(step);
  try {
    return await work();
  } catch (error) {
    if (error && typeof error === 'object' && !error.step) error.step = step;
    throw error;
  } finally {
    options.doneStep?.(step);
  }
}

async function reconcileArnLiveBoard(client, config = loadConfig(), options = {}) {
  const logger = options.logger || console;
  const guildId = String(config?.discord?.guildId || process.env.NEXUS_DISCORD_GUILD_ID || '').trim();
  if (!guildId) return { skipped: 'guild-not-configured' };
  const guild = await trackLiveBoardStep('guild-fetch', () => client.guilds.fetch(guildId), options);
  const channels = await trackLiveBoardStep('channel-list', () => guild.channels.fetch(), options);
  const intake = [...channels.values()].find((item) => item?.type === ChannelType.GuildText && String(item.name || '').toLowerCase() === ARN_INTAKE_CHANNEL_NAME);
  if (!intake) return { skipped: 'arn-intake-not-found' };
  state.guildId = guildId;
  state.intakeChannelId = String(intake.id);

  // Webhook names and the public channel lookup share the channel list. Channel
  // parent/topic edits, history replay, and panel writes wait on Discord's
  // rate-limit queue, which is not covered by the 15s HTTP timeout, so they
  // must not block ready.
  const [discovery, placed] = await Promise.all([
    trackLiveBoardStep('webhook-discovery', () => discoverNamedWebhooks(intake, logger), options)
      .then((value) => ({ ok: true, value }))
      .catch((error) => ({ ok: false, error })),
    trackLiveBoardStep('public-channel', () => ensurePublicChannel(guild, channels), options)
      .then((value) => ({ ok: true, value }))
      .catch((error) => ({ ok: false, error }))
  ]);
  if (!discovery.ok) warnLiveBoardStep(logger, discovery.error, 'webhook-discovery');
  if (placed.ok) state.publicChannelId = String(placed.value.channel.id);
  else warnLiveBoardStep(logger, placed.error, 'public-channel');

  const placedChannel = placed.ok ? placed.value : null;
  const botId = String(client.user?.id || '');
  void (async () => {
    if (placedChannel?.channel && placedChannel?.category) {
      await trackLiveBoardStep('public-organize', () => organizePublicChannel(placedChannel.channel, placedChannel.category), options)
        .catch((error) => warnLiveBoardStep(logger, error, 'public-organize'));
    }
    await trackLiveBoardStep('replay', () => replayIntake(client, intake, { logger }), options)
      .catch((error) => warnLiveBoardStep(logger, error, 'replay'));
    if (!placedChannel?.channel) return;
    await trackLiveBoardStep('panel', () => ensurePanelMessages(placedChannel.channel, botId, { env: options.env }), options)
      .catch((error) => warnLiveBoardStep(logger, error, 'panel'));
  })();

  return {
    guildId,
    intakeChannelId: state.intakeChannelId,
    publicChannelId: state.publicChannelId,
    tracked: state.anomalies.size
  };
}

async function handleIntakeMessage(client, message) {
  if (!message?.webhookId || String(message.channelId || '') !== state.intakeChannelId) return false;
  const registry = getArnWebhookRegistry();
  let authoritativeMap = registry.get(String(message.webhookId));
  if (!authoritativeMap) {
    const channel = await client.channels.fetch(state.intakeChannelId);
    await discoverNamedWebhooks(channel, console);
    authoritativeMap = getArnWebhookRegistry().get(String(message.webhookId));
  }
  if (!authoritativeMap) {
    console.warn('[Nexus Sentinal] ARN ignored message from unrecognized intake webhook.');
    return false;
  }
  const payload = await rawMessagePayload(client, message);
  try {
    await observeFromDiscordMessage({
      message,
      payload,
      authoritativeMap,
      now: Date.now()
    });
  } catch (error) {
    console.warn(`[Nexus Sentinal] ARN token observe failed: ${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 250)}`);
  }
  const event = parseShinyDiscordPayload(payload, authoritativeMap);
  if (!event) {
    const shape = payloadText(payload).replace(/[\r\n]+/g, ' | ').slice(0, 500);
    console.warn(`[Nexus Sentinal] ARN recognized webhook but could not parse Shiny event: map=${normalizeMapName(authoritativeMap)} payload=${shape}`);
    return false;
  }
  applyEvent(event, Number(message.createdTimestamp || Date.now()));
  await refreshBoard(client);
  console.log(`[Nexus Sentinal] ARN event accepted: map=${event.mapName} lifecycle=${event.lifecycle} dino=${event.dinoName} threat=${classifyThreat(event.dinoName).level}`);
  return true;
}

function ensureArnGuildMessages() {
  const discord = require('discord.js');
  if (discord[GUILD_MESSAGES]) return discord.Client;
  discord[GUILD_MESSAGES] = true;
  const BaseClient = discord.Client;
  const { GatewayIntentBits, IntentsBitField } = discord;
  class NexusArnMessagesClient extends BaseClient {
    constructor(clientOptions = {}) {
      const intents = new IntentsBitField(clientOptions.intents || []);
      intents.add(GatewayIntentBits.GuildMessages);
      super({ ...clientOptions, intents });
    }
  }
  discord.Client = NexusArnMessagesClient;
  console.log('[Nexus Sentinal] ARN intake declares Guild Messages. Message Content stays off; embeds are read with one REST GET.');
  return NexusArnMessagesClient;
}

function installArnLiveBoardExtension() {
  // Call this after the last discord.Client swap and before bot.cjs loads.
  // A Docker preload only requires this file; it must not install the hook.
  const ActiveClient = require('discord.js').Client;
  if (Object.prototype.hasOwnProperty.call(ActiveClient.prototype, INSTALLED)) return;
  ActiveClient.prototype[INSTALLED] = true;
  const config = loadConfig();
  const originalLogin = ActiveClient.prototype.login;

  ActiveClient.prototype.login = function nexusArnLiveBoardLogin(...args) {
    const client = this;
    if (!boundClients.has(client)) {
      boundClients.add(client);
      client.once(Events.ClientReady, function nexusArnLiveBoardReady() {
        armArnLiveBoard(client, {
          config,
          onReady() {
            clearInterval(state.refreshTimer);
            state.refreshTimer = setInterval(() => void refreshBoard(client).catch((error) => console.warn(`[Nexus Sentinal] ARN board refresh failed: ${String(error?.message || error).slice(0, 250)}`)), BOARD_REFRESH_MS);
            state.refreshTimer.unref?.();
          }
        });
      });
      client.on(Events.MessageCreate, function nexusArnLiveBoardMessage(message) {
        void handleIntakeMessage(client, message).catch((error) => console.warn(`[Nexus Sentinal] ARN intake event failed: ${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 350)}`));
      });
    }
    return originalLogin.apply(client, args);
  };
}

function resetArnStateForTest() {
  state.anomalies.clear();
  state.guildId = '';
  state.publicChannelId = '';
  state.intakeChannelId = '';
  state.infoMessageId = '';
  state.boardMessageId = '';
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  state.refreshTimer = null;
  if (state.retryTimer) clearTimeout(state.retryTimer);
  state.retryTimer = null;
  state.setupWork = null;
  publicChannelFlight = null;
  panelFlight = null;
  knownPublic = null;
}

module.exports = {
  ARN_PUBLIC_CHANNEL_NAME,
  ARN_PUBLIC_TOPIC,
  INFO_MARKER,
  BOARD_MARKER,
  RESOLVED_LINGER_MS,
  cleanDinoName,
  normalizeMapName,
  payloadText,
  mapFromFooter,
  lifecycleFromText,
  coordinatesFromText,
  parseShinyDiscordPayload,
  classifyThreat,
  anomalyKey,
  applyEvent,
  pruneResolved,
  sortedAnomalies,
  infoEmbed,
  boardEmbed,
  findArkCategory,
  ensurePublicChannel,
  ensurePanelMessages,
  replayIntake,
  reconcileArnLiveBoard,
  handleIntakeMessage,
  rawMessagePayload,
  runArnLiveBoardSetup,
  armArnLiveBoard,
  SETUP_DELAY_MS,
  SETUP_TIMEOUT_MS,
  ensureArnGuildMessages,
  installArnLiveBoardExtension,
  resetArnStateForTest
};