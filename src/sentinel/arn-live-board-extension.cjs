'use strict';

const discord = require('discord.js');
const { ChannelType, Client, Events, PermissionFlagsBits, Routes } = discord;
const { loadConfig } = require('../shared/config.cjs');
const { getArnWebhookRegistry, discoverNamedWebhooks, ARN_INTAKE_CHANNEL_NAME } = require('./arn-intake-extension.cjs');
const { pruneStaleActive, resolveLifecyclePolicy } = require('./arn-lifecycle-policy.cjs');

const INSTALLED = Symbol.for('khaos.nexus.arnLiveBoard.extension');
const ARN_PUBLIC_CHANNEL_NAME = 'arn';
const ARN_PUBLIC_TOPIC = 'Anomaly Response Network — live Shiny! Dinos detections and lifecycle tracking across the Khaos Nexus ARK cluster.';
const INFO_MARKER = 'ARN • NETWORK BRIEFING';
const BOARD_MARKER = 'ARN • LIVE BOUNTY BOARD';
const RESOLVED_LINGER_MS = 15 * 60 * 1000;
const REPLAY_LIMIT = 100;
const BOARD_REFRESH_MS = 60 * 1000;

const state = {
  guildId: '',
  publicChannelId: '',
  intakeChannelId: '',
  infoMessageId: '',
  boardMessageId: '',
  anomalies: new Map(),
  refreshTimer: null
};

const clean = (value, max = 180) => String(value || '')
  .replace(/[\r\n\0]+/g, ' ')
  .replace(/[@`]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

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
  if (/anomaly\s+detected|detected\s+on/i.test(joined)) return 'ACTIVE';
  return '';
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
  const lost = description.match(/^(.+?)\s+is\s+no\s+longer\s+detectable(?:\s+on\s+(?:the\s+network|(.+?)))?\.?$/i);
  const resolved = description.match(/^(.+?)(?:\s+on\s+(.+?))?\s+(?:was|has been|is)\s+(?:captured|tamed|defeated|killed|slain)/i);

  if (detected) {
    dinoName = clean(detected[1]);
    if (!mapName) mapName = normalizeMapName(detected[2]);
    lat = Number(detected[3]);
    lon = Number(detected[4]);
  } else if (lost) {
    dinoName = clean(lost[1]);
    if (!mapName && lost[2]) mapName = normalizeMapName(lost[2]);
  } else if (resolved) {
    dinoName = clean(resolved[1]);
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
  return `${normalizeMapName(event.mapName).toLowerCase()}|${clean(event.dinoName).toLowerCase()}`;
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

async function ensurePublicChannel(guild) {
  const channels = await guild.channels.fetch();
  const category = findArkCategory(channels);
  if (!category) throw new Error('ARK Discord category was not found; ARN public channel cannot be safely auto-placed.');
  let channel = [...channels.values()].find((item) => item?.type === ChannelType.GuildText && String(item.name || '').toLowerCase() === ARN_PUBLIC_CHANNEL_NAME);
  if (!channel) {
    channel = await guild.channels.create({
      name: ARN_PUBLIC_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: String(category.id),
      topic: ARN_PUBLIC_TOPIC,
      reason: 'Nexus Sentinel ARN public live board'
    });
  } else {
    if (String(channel.parentId || '') !== String(category.id)) await channel.setParent(String(category.id), { lockPermissions: false, reason: 'Nexus Sentinel ARN channel organization' });
    if (String(channel.topic || '') !== ARN_PUBLIC_TOPIC) await channel.setTopic(ARN_PUBLIC_TOPIC, 'Nexus Sentinel ARN topic reconciliation');
  }
  return channel;
}

function isManagedMessage(message, marker) {
  if (!message?.author?.bot) return false;
  return (message.embeds || []).some((embed) => String(embed?.footer?.text || '').includes(marker));
}

async function ensurePanelMessages(channel) {
  const recent = await channel.messages.fetch({ limit: 50 });
  let info = recent.find((message) => isManagedMessage(message, INFO_MARKER));
  let board = recent.find((message) => isManagedMessage(message, BOARD_MARKER));
  if (!info) info = await channel.send({ embeds: [infoEmbed()], allowedMentions: { parse: [] } });
  else await info.edit({ embeds: [infoEmbed()], allowedMentions: { parse: [] } });
  if (!board) board = await channel.send({ embeds: [boardEmbed()], allowedMentions: { parse: [] } });
  else await board.edit({ embeds: [boardEmbed()], allowedMentions: { parse: [] } });
  state.infoMessageId = String(info.id);
  state.boardMessageId = String(board.id);
  return { info, board };
}

async function refreshBoard(client) {
  if (!state.publicChannelId || !state.boardMessageId) return false;
  const channel = await client.channels.fetch(state.publicChannelId);
  if (!channel?.isTextBased?.()) return false;
  const message = await channel.messages.fetch(state.boardMessageId);
  await message.edit({ embeds: [boardEmbed()], allowedMentions: { parse: [] } });
  return true;
}

async function rawMessagePayload(client, message) {
  try {
    return await client.rest.get(Routes.channelMessage(String(message.channelId), String(message.id)));
  } catch {
    return {
      content: message.content,
      embeds: (message.embeds || []).map((embed) => embed.toJSON ? embed.toJSON() : embed)
    };
  }
}

async function replayIntake(client, channel) {
  state.anomalies.clear();
  const registry = getArnWebhookRegistry();
  const messages = await channel.messages.fetch({ limit: REPLAY_LIMIT });
  const ordered = [...messages.values()].sort((a, b) => Number(a.createdTimestamp || 0) - Number(b.createdTimestamp || 0));
  let accepted = 0;
  for (const message of ordered) {
    if (!message.webhookId) continue;
    const authoritativeMap = registry.get(String(message.webhookId));
    if (!authoritativeMap) continue;
    const payload = await rawMessagePayload(client, message);
    const event = parseShinyDiscordPayload(payload, authoritativeMap);
    if (!event) continue;
    applyEvent(event, Number(message.createdTimestamp || Date.now()));
    accepted += 1;
  }
  pruneResolved();
  return accepted;
}

async function reconcileArnLiveBoard(client, config = loadConfig(), options = {}) {
  const guildId = String(config?.discord?.guildId || process.env.NEXUS_DISCORD_GUILD_ID || '').trim();
  if (!guildId) return { skipped: 'guild-not-configured' };
  const guild = await client.guilds.fetch(guildId);
  const channels = await guild.channels.fetch();
  const intake = [...channels.values()].find((item) => item?.type === ChannelType.GuildText && String(item.name || '').toLowerCase() === ARN_INTAKE_CHANNEL_NAME);
  if (!intake) return { skipped: 'arn-intake-not-found' };
  await discoverNamedWebhooks(intake, options.logger || console);
  const publicChannel = await ensurePublicChannel(guild);
  state.guildId = guildId;
  state.intakeChannelId = String(intake.id);
  state.publicChannelId = String(publicChannel.id);
  const replayed = await replayIntake(client, intake);
  await ensurePanelMessages(publicChannel);
  return { guildId, intakeChannelId: state.intakeChannelId, publicChannelId: state.publicChannelId, replayed, tracked: state.anomalies.size };
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
    console.warn(`[Nexus Sentinal] ARN ignored unrecognized intake webhook id=${String(message.webhookId)}`);
    return false;
  }
  const payload = await rawMessagePayload(client, message);
  const event = parseShinyDiscordPayload(payload, authoritativeMap);
  if (!event) return false;
  applyEvent(event, Number(message.createdTimestamp || Date.now()));
  await refreshBoard(client);
  console.log(`[Nexus Sentinal] ARN event accepted: map=${event.mapName} lifecycle=${event.lifecycle} dino=${event.dinoName} threat=${classifyThreat(event.dinoName).level}`);
  return true;
}

function installArnLiveBoardExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusArnLiveBoardLogin(...args) {
    const client = this;
    client.once(Events.ClientReady, () => {
      const start = async () => {
        try {
          const result = await reconcileArnLiveBoard(client, config);
          if (result.skipped) {
            console.warn(`[Nexus Sentinal] ARN live board skipped: ${result.skipped}`);
            return;
          }
          console.log(`[Nexus Sentinal] ARN live board ready: publicChannel=${result.publicChannelId} intakeChannel=${result.intakeChannelId} replayed=${result.replayed} tracked=${result.tracked}`);
          clearInterval(state.refreshTimer);
          state.refreshTimer = setInterval(() => void refreshBoard(client).catch((error) => console.warn(`[Nexus Sentinal] ARN board refresh failed: ${String(error?.message || error).slice(0, 250)}`)), BOARD_REFRESH_MS);
          state.refreshTimer.unref?.();
        } catch (error) {
          console.warn(`[Nexus Sentinal] ARN live board unavailable: ${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 350)}`);
        }
      };
      const timer = setTimeout(() => void start(), 105_000);
      timer.unref?.();
    });

    client.on(Events.MessageCreate, (message) => {
      void handleIntakeMessage(client, message).catch((error) => console.warn(`[Nexus Sentinal] ARN intake event failed: ${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 350)}`));
    });
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
}

module.exports = {
  ARN_PUBLIC_CHANNEL_NAME,
  ARN_PUBLIC_TOPIC,
  INFO_MARKER,
  BOARD_MARKER,
  RESOLVED_LINGER_MS,
  normalizeMapName,
  payloadText,
  mapFromFooter,
  lifecycleFromText,
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
  installArnLiveBoardExtension,
  resetArnStateForTest
};