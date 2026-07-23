'use strict';

const { REST, Routes } = require('discord.js');
const { ServerConnection } = require('../../bot/server-client.cjs');
const {
  normalizeDiscordStudioConfig,
  normalizeTemplate,
  renderTemplate,
  statusContext,
  templateById
} = require('../../shared/discord-studio.cjs');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function discordError(error) {
  const code = Number(error?.code);
  const status = Number(error?.status);
  if (code === 50001 || code === 50013 || status === 403) return new Error('The Discord bot cannot access that channel. Check View Channel, Send Messages, Embed Links, and Read Message History permissions.');
  if (code === 10003 || status === 404) return new Error('The selected Discord channel no longer exists or is not visible to the bot.');
  if (code === 10008) return new Error('The published Discord message no longer exists. Publish the panel again.');
  if (status === 401) return new Error('Discord rejected the stored bot token. Update the token in Discord Setup.');
  return error instanceof Error ? error : new Error(String(error || 'Discord request failed.'));
}

function publicServerError(server, error) {
  let message = String(error?.message || error || 'Unknown connection error.');
  for (const secret of [server?.password, server?.host, server?.username]) {
    const value = String(secret || '').trim();
    if (value) message = message.split(value).join(value === String(server?.host || '') ? 'server endpoint' : '[protected]');
  }
  return new Error(message.slice(0, 700));
}

class DiscordStudioService {
  constructor({ configStore, logger, restFactory, connectionFactory, now } = {}) {
    this.configStore = configStore;
    this.logger = logger;
    this.restFactory = restFactory || ((token) => new REST({ version: '10' }).setToken(token));
    this.connectionFactory = connectionFactory || ((server) => new ServerConnection(server));
    this.now = now || (() => new Date());
    this.runtime = new Map();
    this.inFlight = new Set();
    this.timer = setInterval(() => this.refreshDuePanels().catch((error) => {
      this.logger?.warn?.('Discord status-panel scheduler failed.', { message: error.message });
    }), 15000);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
  }

  bootstrap() {
    return this.configStore.getRuntimeBootstrap();
  }

  studio() {
    return normalizeDiscordStudioConfig(this.configStore.getDiscordStudio?.() || this.configStore.getConfig().discordStudio || {});
  }

  rest() {
    const token = this.bootstrap().discordToken;
    if (!token) throw new Error('Save the Discord bot token before using Embed Studio.');
    return this.restFactory(token);
  }

  configuredGuildId(override = '') {
    const guildId = String(override || this.bootstrap().config.discord?.guildId || '').trim();
    if (!/^\d{5,25}$/.test(guildId)) throw new Error('Configure the Discord server ID before loading channels.');
    return guildId;
  }

  getState() {
    return {
      panels: Object.fromEntries([...this.runtime.entries()].map(([id, value]) => [id, clone(value)])),
      schedulerActive: Boolean(this.timer)
    };
  }

  async listChannels(guildId = '') {
    const id = this.configuredGuildId(guildId);
    try {
      const channels = await this.rest().get(Routes.guildChannels(id));
      return (Array.isArray(channels) ? channels : [])
        .filter((channel) => [0, 5].includes(Number(channel.type)))
        .sort((a, b) => Number(a.position || 0) - Number(b.position || 0) || String(a.name).localeCompare(String(b.name)))
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

  async sendMessage(channelId, payload) {
    try {
      return await this.rest().post(Routes.channelMessages(channelId), { body: payload });
    } catch (error) {
      throw discordError(error);
    }
  }

  async editMessage(channelId, messageId, payload) {
    try {
      return await this.rest().patch(Routes.channelMessage(channelId, messageId), { body: payload });
    } catch (error) {
      throw discordError(error);
    }
  }

  async deleteMessage(channelId, messageId) {
    try {
      await this.rest().delete(Routes.channelMessage(channelId, messageId));
      return { deleted: true };
    } catch (error) {
      if (Number(error?.code) === 10008 || Number(error?.status) === 404) return { deleted: false, alreadyMissing: true };
      throw discordError(error);
    }
  }

  async previewTemplate(channelId, templateInput) {
    if (!/^\d{5,25}$/.test(String(channelId || ''))) throw new Error('Select a Discord text channel for the preview.');
    const template = normalizeTemplate(templateInput);
    const context = statusContext({ name: 'Preview Server', game: 'preview', connectionType: 'rest' }, {
      info: { version: 'Preview' },
      metrics: { currentplayernum: 7, maxplayernum: 32, serverfps: 60, serverframetime: 16.7, uptime: 7322 }
    }, { players: [{ name: 'Khaos Kirito' }, { name: 'Khaos Asuna' }] }, null, this.now());
    const payload = renderTemplate(template, context);
    const message = await this.sendMessage(String(channelId), payload);
    this.logger?.info?.('Embed Studio preview published.', { channelId: String(channelId), templateId: template.id, messageId: String(message.id) });
    return { channelId: String(channelId), messageId: String(message.id), template };
  }

  findPanel(panelId) {
    const panel = this.studio().panels.find((item) => item.id === panelId);
    if (!panel) throw new Error('The selected status panel was not found.');
    return panel;
  }

  findServer(serverId) {
    const server = this.bootstrap().config.servers.find((item) => item.id === serverId);
    if (!server) throw new Error('The status panel server is no longer configured.');
    if (server.enabled === false) throw new Error('The status panel server is disabled.');
    if (!server.password) throw new Error('The status panel server is missing its protected management password.');
    return server;
  }

  async queryServer(server, panel) {
    const connection = this.connectionFactory(server);
    const status = await connection.action('status');
    let players = null;
    if (panel.includePlayers) {
      try { players = await connection.action('players'); }
      catch (error) { this.logger?.warn?.('Status panel could not load the public player list.', { panelId: panel.id, serverId: server.id, message: error.message }); }
    }
    return { status, players };
  }

  setRuntime(panelId, patch) {
    const current = this.runtime.get(panelId) || {};
    const next = { ...current, ...patch };
    this.runtime.set(panelId, next);
    return clone(next);
  }

  async writePanelMessage(panel, payload) {
    if (panel.messageId) {
      try {
        const message = await this.editMessage(panel.channelId, panel.messageId, payload);
        return { message, replaced: false };
      } catch (error) {
        if (!/no longer exists|not found/i.test(error.message)) throw error;
      }
    }
    const message = await this.sendMessage(panel.channelId, payload);
    return { message, replaced: true };
  }

  async refreshPanel(panelId, options = {}) {
    const panel = this.findPanel(panelId);
    if (!panel.channelId) throw new Error('Select a Discord channel before publishing this status panel.');
    if (this.inFlight.has(panelId)) throw new Error('This status panel is already refreshing.');
    this.inFlight.add(panelId);
    const attemptedAt = this.now();
    this.setRuntime(panelId, { status: 'refreshing', lastAttemptAt: attemptedAt.toISOString(), error: null });
    try {
      const server = this.findServer(panel.serverId);
      let context;
      try {
        const result = await this.queryServer(server, panel);
        context = statusContext(server, result.status, result.players, null, this.now());
      } catch (serverError) {
        context = statusContext(server, null, null, publicServerError(server, serverError), this.now());
      }
      const template = templateById(this.studio(), panel.templateId);
      const payload = renderTemplate(template, context);
      const written = await this.writePanelMessage(panel, payload);
      const messageId = String(written.message.id || panel.messageId || '');
      if (messageId && (messageId !== panel.messageId || !panel.publishedAt)) {
        this.configStore.setDiscordPanelPublication(panel.id, {
          guildId: panel.guildId || this.configuredGuildId(),
          channelId: panel.channelId,
          messageId,
          publishedAt: this.now().toISOString()
        });
      }
      const runtime = this.setRuntime(panelId, {
        status: context.online ? 'online' : 'offline',
        online: context.online,
        messageId,
        channelId: panel.channelId,
        lastSuccessAt: this.now().toISOString(),
        nextRefreshAt: new Date(this.now().getTime() + panel.refreshSeconds * 1000).toISOString(),
        error: context.online ? null : context.status.summary
      });
      this.logger?.info?.('Discord server status panel refreshed.', { panelId, serverId: server.id, online: context.online, replaced: written.replaced, automatic: Boolean(options.automatic) });
      return { panel: this.findPanel(panelId), runtime, context };
    } catch (error) {
      this.setRuntime(panelId, { status: 'error', online: false, error: error.message, nextRefreshAt: new Date(this.now().getTime() + panel.refreshSeconds * 1000).toISOString() });
      this.logger?.error?.('Discord status panel refresh failed.', { panelId, message: error.message });
      throw error;
    } finally {
      this.inFlight.delete(panelId);
    }
  }

  async deletePublishedPanel(panelId) {
    const panel = this.findPanel(panelId);
    if (panel.channelId && panel.messageId) await this.deleteMessage(panel.channelId, panel.messageId);
    this.configStore.setDiscordPanelPublication(panelId, { messageId: '', publishedAt: null });
    this.runtime.delete(panelId);
    this.logger?.warn?.('Published Discord status panel removed.', { panelId, channelId: panel.channelId, messageId: panel.messageId });
    return { removed: true };
  }

  async refreshAll(options = {}) {
    const panels = this.studio().panels.filter((panel) => panel.enabled && panel.channelId);
    const results = [];
    for (const panel of panels) {
      try { results.push({ panelId: panel.id, ok: true, result: await this.refreshPanel(panel.id, options) }); }
      catch (error) { results.push({ panelId: panel.id, ok: false, error: error.message }); }
    }
    return results;
  }

  async refreshDuePanels() {
    const now = this.now().getTime();
    const panels = this.studio().panels.filter((panel) => panel.enabled && panel.channelId && panel.messageId);
    for (const panel of panels) {
      const runtime = this.runtime.get(panel.id);
      const last = runtime?.lastAttemptAt ? new Date(runtime.lastAttemptAt).getTime() : (panel.publishedAt ? new Date(panel.publishedAt).getTime() : 0);
      if (this.inFlight.has(panel.id) || now - last < panel.refreshSeconds * 1000) continue;
      this.refreshPanel(panel.id, { automatic: true }).catch(() => {});
    }
  }
}

module.exports = { DiscordStudioService, discordError, publicServerError };
