'use strict';

const { REST, Routes } = require('discord.js');
const { isPalworldRest, isRustWebRcon, isSatisfactoryApi } = require('../../bot/server-client.cjs');
const { createCurrentServerAdapter } = require('../../bot/game-adapters/current-server-adapter.cjs');
const { executeAdapterOperation } = require('../../shared/game-adapter-sdk.cjs');
const { moduleForServer, connectionLabel: policyConnectionLabel } = require('../../shared/game-module-policy.cjs');
const { discordValidationDetail } = require('../../shared/discord-message-payload.cjs');
const {
  normalizeStatusPanel,
  normalizeStatusSnapshot,
  validateStatusPanelPayload,
  renderStatusPanel,
  safePlayerNames
} = require('../../shared/status-panels.cjs');

function discordError(error) {
  if (error?.code === 'STATUS_PANEL_PAYLOAD_INVALID') return error;
  const code = Number(error?.code);
  const status = Number(error?.status);
  if (code === 50013 || status === 403) return new Error('The Discord bot is missing View Channel, Send Messages, Embed Links, Read Message History, or Use External Emojis permission for that channel.');
  if (code === 50001) return new Error('The Discord bot cannot access the selected server or channel.');
  if ([10003, 10004, 10008].includes(code) || status === 404) return new Error('The selected Discord server, channel, or status message no longer exists.');
  if (status === 401) return new Error('Discord rejected the stored bot token. Update it in Discord Setup.');
  if (code === 50035 || status === 400) {
    const detail = discordValidationDetail(error);
    const mapped = new Error(detail
      ? `Discord rejected the status panel payload at ${detail.path}: ${detail.message}`
      : 'Discord rejected the status panel payload. Review the panel content and button configuration.');
    mapped.code = 'STATUS_PANEL_PAYLOAD_REJECTED';
    mapped.discordCode = code || undefined;
    mapped.status = status || undefined;
    if (detail) mapped.field = detail.path;
    return mapped;
  }
  return error instanceof Error ? error : new Error(String(error || 'Discord request failed.'));
}

function parseRconPlayers(value) {
  const text = String(value || '').trim();
  if (!text || /no players? (are )?(currently )?connected|no players connected/i.test(text)) return [];
  const names = [];
  for (const source of text.split(/\r?\n/)) {
    const line = source.trim();
    if (!line || /^(name|playername|connected players|players?)\s*[:,-]?$/i.test(line)) continue;
    const withoutIndex = line.replace(/^\d+[.)-]\s*/, '');
    const candidate = withoutIndex.split(/[|,\t]/)[0].trim();
    if (!candidate || /^\d+$/.test(candidate) || /^(name|playername|steamid|userid)$/i.test(candidate)) continue;
    names.push(candidate);
  }
  return safePlayerNames(names);
}

function requiredGameModule(server = {}) {
  return moduleForServer(server);
}

function connectionLabel(server = {}) {
  if (isPalworldRest(server)) return 'Palworld REST';
  if (isRustWebRcon(server)) return 'Rust WebRCON';
  if (isSatisfactoryApi(server)) return 'Satisfactory HTTPS API';
  return policyConnectionLabel(server);
}

class StatusPanelService {
  constructor({ configStore, logger, restFactory, connectionFactory, adapterFactory, now } = {}) {
    this.configStore = configStore;
    this.logger = logger;
    this.restFactory = restFactory || ((token) => new REST({ version: '10' }).setToken(token));
    this.now = now || (() => new Date());
    this.connectionFactory = connectionFactory || null;
    this.adapterFactory = adapterFactory || ((server) => createCurrentServerAdapter(server, {
      connectionFactory: this.connectionFactory || undefined,
      logger: this.logger,
      now: () => this.now().getTime()
    }));
  }

  bootstrap() {
    return this.configStore.getRuntimeBootstrap();
  }

  rest() {
    const token = this.bootstrap().discordToken;
    if (!token) throw new Error('Save the Discord bot token before publishing server status panels.');
    return this.restFactory(token);
  }

  guildId(override = '') {
    const value = String(override || this.bootstrap().config.discord?.guildId || '').trim();
    if (!/^\d{5,25}$/.test(value)) throw new Error('Configure the Discord server ID before using status panels.');
    return value;
  }

  server(serverId) {
    const bootstrap = this.bootstrap();
    const server = bootstrap.config.servers.find((item) => String(item.id) === String(serverId));
    if (!server || server.enabled === false) throw new Error('The selected game server is not configured or enabled.');
    const moduleId = requiredGameModule(server);
    if (moduleId && bootstrap.config.moduleRuntime?.[moduleId]?.effectiveEnabled === false) {
      throw new Error(`${connectionLabel(server)} operations are disabled by the Khaos Nexus owner.`);
    }
    if (!server.password) throw new Error('The selected server is missing its protected AdminPassword, application token, or RCON password.');
    return server;
  }

  async resources(guildOverride = '') {
    const guildId = this.guildId(guildOverride);
    try {
      const channels = await this.rest().get(Routes.guildChannels(guildId));
      return {
        guildId,
        channels: (Array.isArray(channels) ? channels : [])
          .filter((channel) => [0, 5].includes(Number(channel.type)))
          .sort((a, b) => Number(a.position || 0) - Number(b.position || 0) || String(a.name).localeCompare(String(b.name)))
          .map((channel) => ({ id: String(channel.id), name: String(channel.name || 'unnamed'), type: Number(channel.type), parentId: channel.parent_id ? String(channel.parent_id) : '' }))
      };
    } catch (error) {
      throw discordError(error);
    }
  }

  async snapshotSatisfactory(server, adapter, context) {
    try {
      const status = (await executeAdapterOperation(adapter, 'status', {}, context)).data || {};
      const loading = String(status.state || '').toLowerCase() === 'loading';
      return normalizeStatusSnapshot({
        status: loading ? 'degraded' : 'online',
        serverName: status.serverName || server.name,
        game: 'satisfactory',
        connectionLabel: 'Satisfactory HTTPS API',
        version: status.serverNetCl ? `CL ${status.serverNetCl}` : '',
        players: Number(status.players || 0),
        maxPlayers: Number(status.maxPlayers || 0),
        map: status.sessionName || status.gamePhase || status.state,
        playerNames: [],
        checkedAt: this.now().toISOString(),
        error: loading ? 'The server is loading a save or changing maps; HTTPS operations are temporarily unavailable.' : ''
      });
    } catch {
      return normalizeStatusSnapshot({
        status: 'offline',
        serverName: server.name,
        game: 'satisfactory',
        connectionLabel: 'Satisfactory HTTPS API',
        checkedAt: this.now().toISOString(),
        error: 'The Satisfactory HTTPS and lightweight query APIs did not respond.'
      });
    }
  }

  async snapshot(panelInput) {
    const panel = normalizeStatusPanel(panelInput);
    const server = this.server(panel.serverId);
    const adapter = this.adapterFactory(server);
    const context = { role: 'viewer', explicitSecrets: [server.password] };

    // QueryServerState already contains Satisfactory player counts. Avoid a redundant second API call.
    if (isSatisfactoryApi(server)) return this.snapshotSatisfactory(server, adapter, context);

    let statusResult = null;
    let playerResult = null;
    let statusError = null;
    let playerError = null;

    try { statusResult = (await executeAdapterOperation(adapter, 'status', {}, context)).data; } catch (error) { statusError = error; }
    try { playerResult = (await executeAdapterOperation(adapter, 'players', {}, context)).data; } catch (error) { playerError = error; }

    if (statusError && playerError) {
      return normalizeStatusSnapshot({
        status: 'offline',
        serverName: server.name,
        game: server.game,
        connectionLabel: connectionLabel(server),
        checkedAt: this.now().toISOString(),
        error: 'The server did not respond to its status or player check.'
      });
    }

    if (isPalworldRest(server)) {
      const info = statusResult?.info || {};
      const metrics = statusResult?.metrics || {};
      const players = Array.isArray(playerResult?.players) ? playerResult.players : [];
      return normalizeStatusSnapshot({
        status: statusError || playerError ? 'degraded' : 'online',
        serverName: info.servername || server.name,
        game: server.game,
        connectionLabel: 'Palworld REST',
        version: info.version,
        players: metrics.currentplayernum ?? players.length,
        maxPlayers: metrics.maxplayernum,
        fps: metrics.serverfps,
        frameTime: metrics.serverframetime,
        uptimeSeconds: metrics.uptime,
        worldDay: metrics.days,
        playerNames: players,
        checkedAt: this.now().toISOString(),
        error: statusError || playerError ? 'One server health source did not respond; the remaining live data is shown.' : ''
      });
    }

    if (isRustWebRcon(server)) {
      const players = Array.isArray(playerResult?.players) ? playerResult.players : [];
      const playerNames = safePlayerNames(players.map((player) => player?.name || player?.DisplayName));
      return normalizeStatusSnapshot({
        status: statusError || playerError ? 'degraded' : 'online',
        serverName: statusResult?.serverName || server.name,
        game: 'rust',
        connectionLabel: 'Rust WebRCON',
        version: statusResult?.version,
        players: statusResult?.players ?? players.length,
        maxPlayers: statusResult?.maxPlayers,
        queued: statusResult?.queued,
        joining: statusResult?.joining,
        entityCount: statusResult?.entityCount,
        map: statusResult?.map,
        fps: statusResult?.fps,
        uptimeSeconds: statusResult?.uptimeSeconds,
        playerNames,
        checkedAt: this.now().toISOString(),
        error: statusError || playerError ? 'One Rust WebRCON health source did not respond; the remaining live data is shown.' : ''
      });
    }

    const playerNames = parseRconPlayers(playerResult);
    return normalizeStatusSnapshot({
      status: statusError || playerError ? 'degraded' : 'online',
      serverName: server.name,
      game: server.game,
      connectionLabel: connectionLabel(server),
      players: playerNames.length,
      playerNames,
      checkedAt: this.now().toISOString(),
      error: statusError || playerError ? 'One RCON health check did not respond; the remaining live data is shown.' : ''
    });
  }

  async sendMessage(channelId, payload) {
    try {
      const validated = validateStatusPanelPayload(payload);
      return await this.rest().post(Routes.channelMessages(channelId), { body: validated });
    } catch (error) { throw discordError(error); }
  }

  async editMessage(channelId, messageId, payload) {
    try {
      const validated = validateStatusPanelPayload(payload);
      return await this.rest().patch(Routes.channelMessage(channelId, messageId), { body: validated });
    } catch (error) { throw discordError(error); }
  }

  async deleteMessage(channelId, messageId) {
    try { await this.rest().delete(Routes.channelMessage(channelId, messageId)); return { deleted: true }; }
    catch (error) {
      if (Number(error?.code) === 10008 || Number(error?.status) === 404) return { deleted: false, alreadyMissing: true };
      throw discordError(error);
    }
  }

  async publish(panelInput) {
    const panel = normalizeStatusPanel(panelInput);
    if (!panel.serverId) throw new Error('Select a configured game server before publishing.');
    if (!panel.channelId) throw new Error('Select a Discord text channel before publishing.');
    await this.resources(panel.guildId);
    const snapshot = await this.snapshot(panel);
    const payload = renderStatusPanel(panel, snapshot);
    let message = null;
    let replaced = false;
    if (panel.messageId) {
      try { message = await this.editMessage(panel.channelId, panel.messageId, payload); }
      catch (error) {
        if (!/no longer exists/i.test(error.message)) throw error;
      }
    }
    if (!message) {
      message = await this.sendMessage(panel.channelId, payload);
      replaced = true;
    }
    return {
      panel,
      snapshot,
      guildId: this.guildId(panel.guildId),
      channelId: panel.channelId,
      messageId: String(message.id),
      publishedAt: panel.publishedAt || this.now().toISOString(),
      refreshedAt: this.now().toISOString(),
      replaced
    };
  }

  async refresh(panelInput) {
    const panel = normalizeStatusPanel(panelInput);
    if (!panel.channelId || !panel.messageId) throw new Error('Publish this status panel before refreshing it.');
    const snapshot = await this.snapshot(panel);
    const message = await this.editMessage(panel.channelId, panel.messageId, renderStatusPanel(panel, snapshot));
    return { panel, snapshot, messageId: String(message.id), refreshedAt: this.now().toISOString() };
  }

  async removePublished(panelInput) {
    const panel = normalizeStatusPanel(panelInput);
    if (panel.channelId && panel.messageId) await this.deleteMessage(panel.channelId, panel.messageId);
    return { removed: true };
  }
}

module.exports = { StatusPanelService, discordError, parseRconPlayers, requiredGameModule, connectionLabel };
