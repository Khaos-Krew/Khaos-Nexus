'use strict';

const crypto = require('node:crypto');
const { REST, Routes } = require('discord.js');
const {
  ROUTE_TYPES,
  normalizeDiscordObservability,
  routeReady,
  severityAtLeast,
  payloadFor
} = require('../../shared/discord-observability.cjs');
const { discordError } = require('./discord-studio-service.cjs');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function semverParts(value) {
  const match = String(value || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : [0, 0, 0];
}

function isNewerVersion(candidate, current) {
  const a = semverParts(candidate);
  const b = semverParts(current);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return true;
    if (a[index] < b[index]) return false;
  }
  return false;
}

function ageText(timestamp, now = Date.now()) {
  if (!timestamp) return 'Unknown';
  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) return 'Unknown';
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes`;
  return `${Math.round(minutes / 60)} hours`;
}

class DiscordObservabilityService {
  constructor({ configStore, logger, stateProvider, restFactory, now, schedulerIntervalMs = 30000 } = {}) {
    this.configStore = configStore;
    this.logger = logger;
    this.stateProvider = stateProvider || (() => ({}));
    this.restFactory = restFactory || ((token) => new REST({ version: '10' }).setToken(token));
    this.now = now || (() => new Date());
    this.inFlight = new Set();
    this.previousBotStatus = null;
    this.previousUpdateKey = null;
    this.previousErrorKey = null;
    this.lastEventByKey = new Map();
    this.runtime = Object.fromEntries(ROUTE_TYPES.map((type) => [type, { status: 'idle', lastAttemptAt: null, lastSuccessAt: null, lastError: null }]));
    this.timer = setInterval(() => this.tick().catch((error) => {
      this.logger?.warn?.('Discord observability scheduler failed.', { message: error.message });
    }), schedulerIntervalMs);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
  }

  bootstrap() {
    return this.configStore.getRuntimeBootstrap();
  }

  config() {
    const stored = this.configStore.getDiscordObservability?.()
      || this.configStore.getConfig().discordObservability
      || {};
    return normalizeDiscordObservability(stored);
  }

  rest() {
    const token = this.bootstrap().discordToken;
    if (!token) throw new Error('Save the Discord bot token before configuring Discord observability.');
    return this.restFactory(token);
  }

  guildId(override = '') {
    const value = String(override || this.bootstrap().config.discord?.guildId || '').trim();
    if (!/^\d{5,25}$/.test(value)) throw new Error('Configure the Discord server ID before loading observability channels.');
    return value;
  }

  getState() {
    return {
      config: this.config(),
      runtime: clone(this.runtime),
      schedulerActive: Boolean(this.timer)
    };
  }

  async listChannels(guildId = '') {
    try {
      const channels = await this.rest().get(Routes.guildChannels(this.guildId(guildId)));
      return (Array.isArray(channels) ? channels : [])
        .filter((channel) => [0, 5].includes(Number(channel.type)))
        .sort((a, b) => Number(a.position || 0) - Number(b.position || 0) || String(a.name || '').localeCompare(String(b.name || '')))
        .map((channel) => ({
          id: String(channel.id),
          name: String(channel.name || 'unnamed-channel'),
          type: Number(channel.type) === 5 ? 'announcement' : 'text',
          parentId: channel.parent_id ? String(channel.parent_id) : '',
          position: Number(channel.position || 0)
        }));
    } catch (error) {
      throw discordError(error);
    }
  }

  setRuntime(type, patch) {
    this.runtime[type] = { ...this.runtime[type], ...patch };
    return clone(this.runtime[type]);
  }

  saveConfig(input) {
    const normalized = normalizeDiscordObservability(input);
    normalized.updatedAt = this.now().toISOString();
    this.configStore.setDiscordObservability(normalized);
    return normalized;
  }

  clearHistory() {
    const config = this.config();
    config.deliveryHistory = [];
    this.configStore.setDiscordObservability(config);
    return this.getState();
  }

  updateConfig(mutator) {
    const config = this.config();
    const next = mutator(config) || config;
    this.configStore.setDiscordObservability(next);
    return next;
  }

  recordDelivery(type, status, details = {}) {
    const createdAt = this.now().toISOString();
    this.updateConfig((config) => {
      config.deliveryHistory.push({
        id: crypto.randomUUID(),
        type,
        status,
        channelId: details.channelId || config.routes[type]?.channelId || '',
        messageId: details.messageId || '',
        summary: String(details.summary || '').slice(0, 500),
        error: details.error ? String(details.error).slice(0, 800) : null,
        createdAt
      });
      config.deliveryHistory = config.deliveryHistory.slice(-250);
      if (config.routes[type]) {
        config.routes[type].lastDeliveredAt = ['sent', 'edited', 'tested'].includes(status) ? createdAt : config.routes[type].lastDeliveredAt;
        config.routes[type].lastDeliveryError = status === 'failed' ? String(details.error || 'Discord delivery failed.').slice(0, 800) : null;
        if (details.messageId && type === 'heartbeat') config.routes[type].messageId = String(details.messageId);
      }
      if (type === 'heartbeat' && ['sent', 'edited', 'tested'].includes(status)) config.lastHeartbeatAt = createdAt;
      return config;
    });
  }

  eventDedupKey(type, event) {
    if (type === 'releases') return `release:${event.version || event.latestVersion || event.status || 'unknown'}`;
    if (type === 'errors') return `error:${event.id || event.fingerprint || event.message || 'unknown'}`;
    if (type === 'health') return `health:${event.component || 'desktop'}:${event.previous || 'unknown'}:${event.current || 'unknown'}`;
    return `heartbeat:${Math.floor(this.now().getTime() / 60000)}`;
  }

  shouldDeliver(type, route, event, force = false) {
    if (force) return true;
    if (!routeReady(this.config(), type)) return false;
    if (!severityAtLeast(event.severity || 'info', route.minimumSeverity || 'info')) return false;
    const key = this.eventDedupKey(type, event);
    const previous = this.lastEventByKey.get(key) || 0;
    if (this.now().getTime() - previous < Number(route.cooldownSeconds || 0) * 1000) return false;
    return true;
  }

  async post(channelId, payload) {
    try {
      return await this.rest().post(Routes.channelMessages(channelId), { body: payload });
    } catch (error) {
      throw discordError(error);
    }
  }

  async patch(channelId, messageId, payload) {
    try {
      return await this.rest().patch(Routes.channelMessage(channelId, messageId), { body: payload });
    } catch (error) {
      throw discordError(error);
    }
  }

  async deliver(type, event = {}, options = {}) {
    if (!ROUTE_TYPES.includes(type)) throw new Error('Unknown Discord observability route.');
    const config = this.config();
    const route = config.routes[type];
    if (!options.force && !routeReady(config, type)) return { skipped: true, reason: 'route-disabled' };
    if (!route.channelId) throw new Error(`Choose a Discord channel for ${type} before testing or enabling it.`);
    if (!this.shouldDeliver(type, route, event, Boolean(options.force))) return { skipped: true, reason: 'cooldown-or-severity' };
    if (this.inFlight.has(type)) return { skipped: true, reason: 'already-delivering' };

    this.inFlight.add(type);
    const attemptedAt = this.now().toISOString();
    this.setRuntime(type, { status: 'sending', lastAttemptAt: attemptedAt, lastError: null });
    try {
      const payload = payloadFor(type, route, event);
      let message;
      let status = options.test ? 'tested' : 'sent';
      if (type === 'heartbeat' && route.messageId && !options.recreate) {
        try {
          message = await this.patch(route.channelId, route.messageId, payload);
          status = options.test ? 'tested' : 'edited';
        } catch (error) {
          if (!/no longer exists|not found|selected Discord channel no longer exists/i.test(error.message)) throw error;
          message = await this.post(route.channelId, payload);
        }
      } else {
        message = await this.post(route.channelId, payload);
      }
      const messageId = String(message?.id || route.messageId || '');
      this.lastEventByKey.set(this.eventDedupKey(type, event), this.now().getTime());
      this.recordDelivery(type, status, {
        channelId: route.channelId,
        messageId,
        summary: event.title || event.summary || `${type} delivery completed`
      });
      this.setRuntime(type, { status: 'ready', lastSuccessAt: this.now().toISOString(), lastError: null, messageId });
      this.logger?.info?.('Discord observability delivery completed.', { type, channelId: route.channelId, messageId, status });
      return { sent: true, status, channelId: route.channelId, messageId };
    } catch (error) {
      this.recordDelivery(type, 'failed', { channelId: route.channelId, summary: event.title || event.summary || type, error: error.message });
      this.setRuntime(type, { status: 'error', lastError: error.message });
      this.logger?.error?.('Discord observability delivery failed.', { type, channelId: route.channelId, message: error.message });
      throw error;
    } finally {
      this.inFlight.delete(type);
    }
  }

  sampleEvent(type) {
    if (type === 'releases') return {
      version: '0.14.0-test', installedVersion: this.stateProvider().app?.version || 'Unknown', status: 'test',
      notes: 'This is a test release notification from the Khaos Nexus Discord Observability Center.',
      releaseUrl: 'https://github.com/Khaos-Krew/Khaos-Nexus/releases', time: this.now().toISOString()
    };
    if (type === 'errors') return {
      id: 'test-error', source: 'manual-observability-test', severity: 'error',
      title: 'Khaos Nexus error-feed test', summary: 'This is a redacted test. No real error or protected value was included.', time: this.now().toISOString()
    };
    if (type === 'heartbeat') return this.buildHeartbeatSnapshot({ test: true });
    return {
      title: 'Khaos Nexus health-event test', component: 'Discord Observability', previous: 'unknown', current: 'healthy',
      severity: 'warning', summary: 'This is a manual test of the configured health-events channel.', time: this.now().toISOString()
    };
  }

  testRoute(type) {
    return this.deliver(type, this.sampleEvent(type), { force: true, test: true, recreate: type === 'heartbeat' });
  }

  buildHeartbeatSnapshot(extra = {}) {
    const state = this.stateProvider() || {};
    const publicConfig = state.config || {};
    const servers = (Array.isArray(publicConfig.servers) ? publicConfig.servers : []).map((server) => ({
      name: server.name,
      online: state.serverHealth?.[server.id]?.online ?? null
    }));
    const bot = state.bot || {};
    const heartbeatTime = bot.heartbeat?.time || bot.lastHeartbeatAt || bot.ready?.readyAt;
    return {
      appVersion: state.app?.version,
      desktopStatus: 'Online',
      bot,
      servers,
      includeServerNames: this.config().includeServerNames,
      enabledModules: Object.values(publicConfig.general?.modules || {}).filter(Boolean).length,
      accessRole: state.autonomy?.access?.role || 'local-admin',
      updateStatus: state.update?.status || 'Idle',
      heartbeatAge: ageText(heartbeatTime, this.now().getTime()),
      lastErrorId: bot.lastError?.id || null,
      degraded: ['error', 'degraded'].includes(bot.status) || Boolean(bot.lastError),
      time: this.now().toISOString(),
      ...extra
    };
  }

  refreshHeartbeat(options = {}) {
    return this.deliver('heartbeat', this.buildHeartbeatSnapshot(), { force: Boolean(options.force), recreate: Boolean(options.recreate) });
  }

  async handleSupervisorState(state = {}) {
    const status = String(state.status || 'unknown');
    if (this.previousBotStatus === null) {
      this.previousBotStatus = status;
    } else if (status !== this.previousBotStatus) {
      const previous = this.previousBotStatus;
      this.previousBotStatus = status;
      const severity = status === 'error' ? 'error' : status === 'online' ? 'info' : 'warning';
      await this.deliver('health', {
        title: `Discord bot is ${status}`,
        component: 'Discord Runtime', previous, current: status, severity,
        summary: status === 'online' ? 'The supervised Discord runtime is online.' : `The supervised Discord runtime changed from ${previous} to ${status}.`,
        time: this.now().toISOString()
      }).catch(() => {});
    }

    const error = state.lastError;
    const key = error?.id && error?.time ? `${error.id}:${error.time}` : null;
    if (key && key !== this.previousErrorKey) {
      this.previousErrorKey = key;
      await this.deliver('errors', {
        id: error.id,
        source: 'supervised-runtime',
        severity: 'error',
        title: 'Khaos Nexus runtime error',
        summary: String(error.message || 'The supervised runtime reported an error.').slice(0, 1200),
        time: error.time
      }).catch(() => {});
    }
  }

  async handleUpdateState(update = {}) {
    const latest = String(update.latestVersion || update.version || '').trim();
    const current = String(update.currentVersion || this.stateProvider().app?.version || '').trim();
    const available = Boolean(update.available || update.status === 'available' || (latest && current && isNewerVersion(latest, current)));
    const key = `${latest}:${update.status || ''}:${available}`;
    if (!latest || key === this.previousUpdateKey) return;
    this.previousUpdateKey = key;
    const config = this.config();
    if (!available || config.announcedVersions.includes(latest)) return;
    const result = await this.deliver('releases', {
      version: latest,
      installedVersion: current,
      status: 'available',
      notes: update.releaseNotes || update.notes || 'A stable Khaos Nexus update is available.',
      releaseUrl: update.releaseUrl,
      time: this.now().toISOString()
    }).catch(() => null);
    if (result?.sent) {
      this.updateConfig((next) => {
        next.announcedVersions = [...new Set([...next.announcedVersions, latest])].slice(-50);
        return next;
      });
    }
  }

  async publishError(event) {
    return this.deliver('errors', event);
  }

  async tick() {
    const config = this.config();
    if (!routeReady(config, 'heartbeat')) return;
    const last = config.lastHeartbeatAt ? new Date(config.lastHeartbeatAt).getTime() : 0;
    if (this.now().getTime() - last < config.heartbeatIntervalMinutes * 60 * 1000) return;
    await this.refreshHeartbeat();
  }
}

module.exports = { DiscordObservabilityService, isNewerVersion, ageText };
