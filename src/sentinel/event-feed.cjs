'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { formatActionResult } = require('./action-formatters.cjs');
const { pokemonGoEventPayload } = require('./pokemon-go-event-ui.cjs');

const DEFAULT_POLL_MS = 10 * 60 * 1000;
const FEED_RENDER_VERSION = 3;
const FEED_MARKER_PREFIX = 'Nexus Sentinal • Live Feed • ';
const FEEDS = Object.freeze([
  { moduleId:'pokemongo', channelName:'pokemon-go-events', actions:['events'], pollMs:15 * 60 * 1000 },
  { moduleId:'warframe', channelName:'warframe-world-state', actions:['news','events','alerts','sortie','arbitration','nightwave','void-trader','steel-path'], pollMs:10 * 60 * 1000 },
  { moduleId:'division2', channelName:'division-weekly', actions:['news'], pollMs:30 * 60 * 1000 },
  { moduleId:'oncehuman', channelName:'once-human-news', actions:['news'], pollMs:20 * 60 * 1000 },
  { moduleId:'diablo4', channelName:'diablo-news', actions:['news'], pollMs:30 * 60 * 1000 },
  { moduleId:'callofduty', channelName:'cod-news', actions:['news'], pollMs:30 * 60 * 1000 },
  { moduleId:'ark', channelName:'ark-schedules', actions:['schedule-list'], pollMs:10 * 60 * 1000 },
  { moduleId:'palworld', channelName:'palworld-server-status', actions:['schedule-list'], pollMs:10 * 60 * 1000 },
  { moduleId:'minecraft', channelName:'minecraft-server-status', actions:['schedule-list'], pollMs:10 * 60 * 1000 },
  { moduleId:'rust', channelName:'rust-server-status', actions:['schedule-list'], pollMs:10 * 60 * 1000 },
  { moduleId:'satisfactory', channelName:'satisfactory-server-status', actions:['schedule-list'], pollMs:10 * 60 * 1000 }
]);

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function feedMarker(moduleId, actionId) {
  return `${FEED_MARKER_PREFIX}${String(moduleId || '').toLowerCase()}:${String(actionId || '').toLowerCase()}:v${FEED_RENDER_VERSION}`;
}

function feedTitle(moduleId, actionId, original = '') {
  if (moduleId === 'pokemongo' && actionId === 'events') return '📅 POKÉMON GO • EVENTS & COMMUNITY DAYS';
  if (moduleId === 'warframe' && actionId === 'news') return '📰 WARFRAME • NEWS';
  if (moduleId === 'warframe' && actionId === 'events') return '📅 WARFRAME • EVENTS';
  if (moduleId === 'division2' && actionId === 'news') return '📰 THE DIVISION 2 • NEWS';
  if (moduleId === 'oncehuman' && actionId === 'news') return '📰 ONCE HUMAN • OFFICIAL UPDATES';
  if (moduleId === 'diablo4' && actionId === 'news') return '📰 DIABLO IV • NEWS';
  if (moduleId === 'callofduty' && actionId === 'news') return '📰 CALL OF DUTY • PATCH NOTES';
  return String(original || '').slice(0, 256);
}

function markFeedPayload(payload = {}, moduleId, actionId) {
  const embeds = Array.isArray(payload.embeds) ? payload.embeds.map((embed, index) => index === 0 ? {
    ...embed,
    title: feedTitle(moduleId, actionId, embed?.title) || embed?.title,
    color: Number.isFinite(embed?.color) ? embed.color : 0xE3264F,
    footer: { text: feedMarker(moduleId, actionId) }
  } : embed) : [];
  return {
    ...payload,
    embeds,
    components: Array.isArray(payload.components) ? payload.components : [],
    allowed_mentions: { parse:[] }
  };
}

class FeedState {
  constructor(root = process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..')) {
    const dir = process.env.NEXUS_DATA_DIR ? path.resolve(root) : path.join(root, 'data');
    this.file = path.join(dir, 'sentinal-event-feeds.json');
  }
  read() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch { return { feeds:{} }; }
  }
  get(key) { return this.read().feeds?.[key] || null; }
  set(key, value) {
    const state = this.read();
    state.feeds ||= {};
    state.feeds[key] = value;
    fs.mkdirSync(path.dirname(this.file), { recursive:true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, this.file);
    return value;
  }
}

function setupChannelId(setup, channelName) {
  const found = (setup?.textChannels || []).find((item) => item.name === channelName);
  return found?.id || setup?.consoleChannelId || '';
}

function feedPayload(moduleId, actionId, result) {
  if (!result?.ok) return null;
  const now = Math.floor(Date.now() / 1000);
  let payload;

  if (moduleId === 'pokemongo' && actionId === 'events') {
    payload = pokemonGoEventPayload(result.data || {});
    payload.content = `📡 **Nexus Sentinal Live Feed** • Pokémon GO Events\nUpdated <t:${now}:R>`;
  } else {
    const rendered = formatActionResult(moduleId, actionId, result);
    if (!rendered.embeds?.[0]) return null;
    payload = {
      content: `📡 **Nexus Sentinal Live Feed** • ${actionId}\nUpdated <t:${now}:R>`,
      embeds: [rendered.embeds[0]],
      components: [],
      allowed_mentions: { parse:[] }
    };
  }
  return markFeedPayload(payload, moduleId, actionId);
}

function messageMatchesFeed(message, moduleId, actionId, botId = '') {
  if (!message) return false;
  if (botId && String(message?.author?.id || '') !== String(botId)) return false;
  const footer = String(message?.embeds?.[0]?.footer?.text || '');
  if (footer === feedMarker(moduleId, actionId)) return true;
  const content = String(message?.content || '');
  const legacyLabels = [String(actionId || '')];
  if (moduleId === 'pokemongo' && actionId === 'events') legacyLabels.push('Pokémon GO Events');
  return content.includes('Nexus Sentinal Live Feed') && legacyLabels.some((label) => content.includes(`• ${label}`));
}

function newestMessage(messages = []) {
  return [...messages].sort((left, right) => Number(right?.createdTimestamp || 0) - Number(left?.createdTimestamp || 0))[0] || null;
}

async function discoverFeedMessages(channel, moduleId, actionId, botId = '') {
  if (!channel?.messages?.fetch) return [];
  try {
    const messages = await channel.messages.fetch({ limit:100 });
    return valuesOf(messages).filter((message) => messageMatchesFeed(message, moduleId, actionId, botId));
  } catch {
    return [];
  }
}

async function deleteFeedDuplicates(messages, canonical, logger = console) {
  let removed = 0;
  for (const message of messages) {
    if (!message || String(message.id) === String(canonical?.id || '')) continue;
    try {
      await message.delete('Nexus Sentinal duplicate persistent feed cleanup');
      removed += 1;
    } catch (error) {
      logger.warn?.(`[Nexus Sentinal Feed] duplicate message ${message.id} could not be removed: ${String(error?.message || error)}`);
    }
  }
  return removed;
}

class EventFeedPublisher {
  constructor({ client, guild, backend, state, feeds = FEEDS, logger = console } = {}) {
    this.client = client;
    this.guild = guild;
    this.backend = backend;
    this.state = state;
    this.feeds = feeds;
    this.logger = logger;
    this.feedState = new FeedState();
    this.timers = [];
    this.running = new Set();
    this.recovered = new Set();
  }

  async publishAction(definition, channel, actionId) {
    const key = `${definition.moduleId}:${definition.channelName}:${actionId}`;
    if (this.running.has(key)) return null;
    this.running.add(key);
    const firstRecovery = !this.recovered.has(key);
    try {
      const result = await this.backend.invoke(definition.moduleId, actionId, {}, {
        role:'viewer', actorId:'sentinal-event-feed', confirmed:false
      }).catch((error) => ({ ok:false, code:'FEED_ERROR', message:String(error?.message || error) }));
      const payload = feedPayload(definition.moduleId, actionId, result);
      if (!payload) {
        if (firstRecovery) this.logger.warn?.(`[Nexus Sentinal Feed] reconcile ${key}: unavailable code=${String(result?.code || 'NOT_OK')} message=${String(result?.message || '').slice(0, 240)}`);
        return { key, status:'unavailable', messageId:'', source:'none', duplicatesRemoved:0 };
      }
      const fingerprint = digest({ renderVersion:FEED_RENDER_VERSION, actionId, ok:result.ok, data:result.data, code:result.code });
      const saved = this.feedState.get(key);
      let message = null;
      let source = 'none';

      if (saved?.messageId && saved.channelId === String(channel.id)) {
        try {
          message = await channel.messages.fetch(String(saved.messageId));
          if (message) source = 'state';
        } catch { message = null; }
      }

      let duplicatesRemoved = 0;
      if (firstRecovery) {
        const candidates = await discoverFeedMessages(channel, definition.moduleId, actionId, this.client?.user?.id);
        const canonical = newestMessage(candidates);
        if (canonical) {
          message = canonical;
          source = 'discord';
        }
        if (message) duplicatesRemoved = await deleteFeedDuplicates(candidates, message, this.logger);
        this.recovered.add(key);
      }

      const unchanged = Boolean(
        message
        && saved?.fingerprint === fingerprint
        && saved?.renderVersion === FEED_RENDER_VERSION
        && saved?.channelId === String(channel.id)
        && saved?.messageId === String(message.id)
      );
      if (unchanged && !duplicatesRemoved) {
        if (firstRecovery) this.logger.log?.(`[Nexus Sentinal Feed] reconcile ${key}: status=reused source=${source} message=${message.id} duplicatesRemoved=0`);
        return { key, status:'reused', messageId:String(message.id), source, duplicatesRemoved:0 };
      }

      let status;
      if (message) {
        await message.edit(payload);
        status = 'updated';
      } else {
        message = await channel.send(payload);
        source = 'new';
        status = 'created';
      }

      this.feedState.set(key, {
        moduleId:definition.moduleId,
        actionId,
        channelName:definition.channelName,
        channelId:String(channel.id),
        messageId:String(message.id),
        fingerprint,
        renderVersion:FEED_RENDER_VERSION,
        updatedAt:new Date().toISOString()
      });
      if (firstRecovery) this.logger.log?.(`[Nexus Sentinal Feed] reconcile ${key}: status=${status} source=${source} message=${message.id} duplicatesRemoved=${duplicatesRemoved}`);
      return { key, status, messageId:String(message.id), source, duplicatesRemoved };
    } catch (error) {
      this.logger.error?.(`[Nexus Sentinal Feed] ${key}:`, String(error?.message || error));
      return { key, status:'error', messageId:'', source:'none', duplicatesRemoved:0, error:String(error?.message || error) };
    } finally { this.running.delete(key); }
  }

  async publish(definition) {
    try {
      const setup = this.state.getModuleSetup(definition.moduleId);
      const channelId = setupChannelId(setup, definition.channelName);
      if (!channelId) return;
      const channel = await this.client.channels.fetch(String(channelId)).catch(() => null);
      if (!channel?.isTextBased?.()) return;
      for (const actionId of definition.actions) await this.publishAction(definition, channel, actionId);
    } catch (error) {
      this.logger.error?.(`[Nexus Sentinal Feed] ${definition.moduleId}:`, String(error?.message || error));
    }
  }

  start() {
    if (this.timers.length) return;
    for (const definition of this.feeds) {
      const initial = setTimeout(() => this.publish(definition), 5000);
      initial.unref?.();
      const timer = setInterval(() => this.publish(definition), Math.max(60_000, Number(definition.pollMs || DEFAULT_POLL_MS)));
      timer.unref?.();
      this.timers.push(initial, timer);
    }
  }

  stop() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }
}

module.exports = {
  FEEDS,
  FEED_RENDER_VERSION,
  FEED_MARKER_PREFIX,
  FeedState,
  EventFeedPublisher,
  feedMarker,
  feedTitle,
  markFeedPayload,
  feedPayload,
  messageMatchesFeed,
  discoverFeedMessages,
  deleteFeedDuplicates,
  setupChannelId,
  digest
};
