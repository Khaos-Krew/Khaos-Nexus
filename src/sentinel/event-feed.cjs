'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { formatActionResult } = require('./action-formatters.cjs');

const DEFAULT_POLL_MS = 10 * 60 * 1000;
const FEEDS = Object.freeze([
  { moduleId:'pokemongo', channelName:'pokemon-go-events', actions:['events'], pollMs:15 * 60 * 1000 },
  { moduleId:'warframe', channelName:'warframe-world-state', actions:['news','events','alerts','sortie','arbitration','nightwave','void-trader','steel-path'], pollMs:10 * 60 * 1000 },
  { moduleId:'division2', channelName:'division-weekly', actions:['news'], pollMs:30 * 60 * 1000 },
  { moduleId:'ark', channelName:'ark-schedules', actions:['schedule-list'], pollMs:10 * 60 * 1000 },
  { moduleId:'palworld', channelName:'palworld-server-status', actions:['schedule-list'], pollMs:10 * 60 * 1000 },
  { moduleId:'minecraft', channelName:'minecraft-server-status', actions:['schedule-list'], pollMs:10 * 60 * 1000 },
  { moduleId:'rust', channelName:'rust-server-status', actions:['schedule-list'], pollMs:10 * 60 * 1000 },
  { moduleId:'satisfactory', channelName:'satisfactory-server-status', actions:['schedule-list'], pollMs:10 * 60 * 1000 }
]);

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
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
  const rendered = formatActionResult(moduleId, actionId, result);
  if (!rendered.embeds?.[0]) return null;
  const now = Math.floor(Date.now() / 1000);
  return {
    content: `📡 **Nexus Sentinal Live Feed** • ${actionId}\nUpdated <t:${now}:R>`,
    embeds: [rendered.embeds[0]],
    components: [],
    allowed_mentions: { parse:[] }
  };
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
  }

  async publishAction(definition, channel, actionId) {
    const key = `${definition.moduleId}:${definition.channelName}:${actionId}`;
    if (this.running.has(key)) return;
    this.running.add(key);
    try {
      const result = await this.backend.invoke(definition.moduleId, actionId, {}, {
        role:'viewer', actorId:'sentinal-event-feed', confirmed:false
      }).catch((error) => ({ ok:false, code:'FEED_ERROR', message:String(error?.message || error) }));
      const payload = feedPayload(definition.moduleId, actionId, result);
      if (!payload) return;
      const fingerprint = digest({ actionId, ok:result.ok, data:result.data, code:result.code });
      const saved = this.feedState.get(key);
      if (saved?.fingerprint === fingerprint && saved.channelId === String(channel.id)) return;

      let message = null;
      if (saved?.messageId && saved.channelId === String(channel.id)) {
        try {
          message = await channel.messages.fetch(String(saved.messageId));
          await message.edit(payload);
        } catch { message = null; }
      }
      if (!message) message = await channel.send(payload);
      this.feedState.set(key, {
        moduleId:definition.moduleId,
        actionId,
        channelName:definition.channelName,
        channelId:String(channel.id),
        messageId:String(message.id),
        fingerprint,
        updatedAt:new Date().toISOString()
      });
    } catch (error) {
      this.logger.error?.(`[Nexus Sentinal Feed] ${key}:`, String(error?.message || error));
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

module.exports = { FEEDS, FeedState, EventFeedPublisher, feedPayload, setupChannelId, digest };
