'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { ServerConnection, isPalworldRest, isSatisfactoryApi } = require('../../bot/server-client.cjs');
const { serverModuleEnabled } = require('../../shared/game-module-policy.cjs');
const {
  playerToken,
  parseRconPlayers,
  normalizeRestPlayers,
  normalizeModerationHistory,
  safeReason
} = require('../../shared/player-console.cjs');

function gameModuleEnabled(runtime, server) {
  return serverModuleEnabled(runtime, server);
}

class PlayerConsoleService extends EventEmitter {
  constructor({ dataDirectory, configStore, logger, connectionFactory, now = () => Date.now() } = {}) {
    super();
    this.configStore = configStore;
    this.logger = logger;
    this.connectionFactory = connectionFactory || ((server) => new ServerConnection(server));
    this.now = now;
    this.historyPath = path.join(dataDirectory, 'player-moderation-history.json');
    this.history = this.loadHistory();
    this.tokens = new Map();
    this.lastSnapshot = { refreshedAt: null, players: [], servers: [], errors: [] };
  }

  loadHistory() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.historyPath, 'utf8'));
      return Array.isArray(parsed) ? parsed.map(normalizeModerationHistory) : [];
    } catch (error) {
      if (error.code !== 'ENOENT') {
        try { fs.renameSync(this.historyPath, `${this.historyPath}.corrupt-${Date.now()}`); } catch {}
      }
      return [];
    }
  }

  saveHistory() {
    const limit = this.configStore.getPlayerConsoleConfig().settings.historyLimit;
    this.history = this.history.slice(0, limit);
    fs.mkdirSync(path.dirname(this.historyPath), { recursive: true });
    const temporary = `${this.historyPath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.history, null, 2), 'utf8');
    fs.renameSync(temporary, this.historyPath);
  }

  runtimeServers(serverIds) {
    const filtered = Array.isArray(serverIds);
    const wanted = new Set(filtered ? serverIds : []);
    const runtime = this.configStore.getRuntimeBootstrap();
    return runtime.config.servers.filter((server) => server.enabled !== false && gameModuleEnabled(runtime, server) && (!filtered || wanted.has(server.id)));
  }

  pruneTokens() {
    const now = this.now();
    for (const [token, value] of this.tokens) if (value.expiresAt <= now) this.tokens.delete(token);
  }

  issueToken(server, player) {
    this.pruneTokens();
    const token = playerToken();
    const ttl = this.configStore.getPlayerConsoleConfig().settings.tokenLifetimeMinutes * 60 * 1000;
    this.tokens.set(token, {
      serverId: server.id,
      playerName: player.name,
      identifier: player.identifier,
      expiresAt: this.now() + ttl
    });
    return token;
  }

  async refresh(serverIds) {
    this.tokens.clear();
    const servers = this.runtimeServers(serverIds);
    const players = [];
    const summaries = [];
    const errors = [];

    for (const server of servers) {
      if (!server.password) {
        errors.push({ serverId: server.id, serverName: server.name, message: 'Protected server credentials are missing.' });
        summaries.push({ id: server.id, name: server.name, game: server.game, status: 'unavailable', playerCount: 0 });
        continue;
      }
      try {
        const payload = await this.connectionFactory(server).action('players');
        const countOnly = isSatisfactoryApi(server);
        const normalized = countOnly ? [] : isPalworldRest(server) ? normalizeRestPlayers(payload) : parseRconPlayers(server.game, payload);
        for (const player of normalized) {
          players.push({
            token: this.issueToken(server, player),
            name: player.name,
            serverId: server.id,
            serverName: server.name,
            game: server.game || 'generic',
            accountType: player.accountType || 'Server account',
            level: player.level,
            ping: player.ping
          });
        }
        const playerCount = countOnly ? Math.max(0, Number(payload?.count) || 0) : normalized.length;
        summaries.push({
          id: server.id,
          name: server.name,
          game: server.game,
          status: 'online',
          playerCount,
          namesUnavailable: countOnly && playerCount > 0
        });
      } catch (error) {
        errors.push({ serverId: server.id, serverName: server.name, message: String(error.message || error).slice(0, 300) });
        summaries.push({ id: server.id, name: server.name, game: server.game, status: 'error', playerCount: 0 });
      }
    }

    this.lastSnapshot = {
      refreshedAt: new Date(this.now()).toISOString(),
      players,
      servers: summaries,
      errors
    };
    this.emit('state', this.getState());
    return this.getState();
  }

  getState() {
    return {
      config: this.configStore.getPlayerConsoleConfig(),
      snapshot: JSON.parse(JSON.stringify(this.lastSnapshot)),
      history: this.history.slice(0, this.configStore.getPlayerConsoleConfig().settings.historyLimit)
    };
  }

  resolveToken(token) {
    this.pruneTokens();
    const value = this.tokens.get(String(token || ''));
    if (!value) throw new Error('This player entry expired. Refresh the player list and try again.');
    return value;
  }

  record(entry) {
    const normalized = normalizeModerationHistory(entry);
    this.history.unshift(normalized);
    this.saveHistory();
    this.emit('state', this.getState());
    return normalized;
  }

  async moderate({ token, action, reason, actor = {} } = {}) {
    if (!['kick', 'ban'].includes(action)) throw new Error('Unsupported moderation action.');
    const safeModerationReason = safeReason(reason);
    const target = this.resolveToken(token);
    const server = this.runtimeServers([target.serverId])[0];
    if (!server) throw new Error('The selected server is no longer available or its game module is disabled.');

    let outcome = 'failed';
    let message = '';
    try {
      const result = await this.connectionFactory(server).action(action, {
        userid: target.identifier,
        player: target.identifier,
        playerName: target.playerName,
        message: safeModerationReason
      });
      outcome = 'success';
      message = typeof result === 'string' ? result : `${action} command completed.`;
      this.tokens.delete(token);
      return this.record({
        id: `moderation-${crypto.randomUUID()}`,
        action,
        playerName: target.playerName,
        serverId: server.id,
        serverName: server.name,
        game: server.game,
        reason: safeModerationReason,
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        outcome,
        message,
        time: new Date(this.now()).toISOString()
      });
    } catch (error) {
      message = String(error.message || error).slice(0, 500);
      this.record({
        id: `moderation-${crypto.randomUUID()}`,
        action,
        playerName: target.playerName,
        serverId: server.id,
        serverName: server.name,
        game: server.game,
        reason: safeModerationReason,
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        outcome,
        message,
        time: new Date(this.now()).toISOString()
      });
      throw error;
    }
  }

  clearHistory() {
    this.history = [];
    this.saveHistory();
    this.emit('state', this.getState());
    return [];
  }
}

module.exports = { PlayerConsoleService, gameModuleEnabled };