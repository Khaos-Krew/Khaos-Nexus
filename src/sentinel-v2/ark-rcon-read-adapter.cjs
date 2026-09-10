'use strict';

const READ_COMMANDS = Object.freeze({
  listPlayers: 'ListPlayers',
});

class ArkRconReadAdapter {
  constructor({ transport, resilience, logger } = {}) {
    if (!transport || typeof transport.request !== 'function') {
      throw new TypeError('read-only RCON transport with request() is required');
    }
    this.transport = transport;
    this.resilience = resilience;
    this.logger = logger;
  }

  async listPlayers(server, { correlationId } = {}) {
    const target = normalizeTarget(server);
    const execute = async () => {
      const raw = await this.transport.request({
        serverId: target.serverId,
        envPrefix: target.envPrefix,
        command: READ_COMMANDS.listPlayers,
      });
      return normalizeListPlayers(raw, target);
    };

    if (!this.resilience?.execute) {
      const result = await execute();
      this.#observed(result);
      return { ok: true, blocked: false, serverId: target.serverId, result };
    }

    const outcome = await this.resilience.execute({
      provider: `ark-rcon:${target.serverId}`,
      operation: 'players.list',
      subject: target.serverId,
      correlationId,
      payload: { serverId: target.serverId, envPrefix: target.envPrefix, command: READ_COMMANDS.listPlayers },
      run: execute,
    });
    const identifiedOutcome = { ...outcome, serverId: target.serverId };
    if (outcome.ok) this.#observed(outcome.result);
    else this.logger?.warn?.('sentinel.ark.rcon.read_failed', {
      serverId: target.serverId,
      operation: 'players.list',
      blocked: outcome.blocked === true,
      reason: outcome.reason,
      error: outcome.error ? String(outcome.error.message || outcome.error) : undefined,
    });
    return identifiedOutcome;
  }

  #observed(result) {
    this.logger?.info?.('sentinel.ark.rcon.players_observed', {
      serverId: result.serverId,
      playerCount: result.playerCount,
    });
  }
}

function normalizeTarget(server = {}) {
  const serverId = String(server.id || server.serverId || '').trim();
  const envPrefix = String(server.envPrefix || '').trim();
  if (!serverId) throw new TypeError('ARK RCON server id is required');
  if (!envPrefix) throw new TypeError('ARK RCON envPrefix is required');
  if (server.enabled === false) throw new Error(`ARK server is disabled: ${serverId}`);
  if (server.connections?.rcon === false) throw new Error(`ARK RCON is disabled for server: ${serverId}`);
  return Object.freeze({ serverId, envPrefix });
}

function normalizeListPlayers(raw, target) {
  const text = raw == null ? '' : String(raw).trim();
  if (!text || /^no players connected\.?$/i.test(text)) {
    return Object.freeze({
      serverId: target.serverId,
      envPrefix: target.envPrefix,
      playerCount: 0,
      players: Object.freeze([]),
      observedAt: new Date().toISOString(),
    });
  }

  const players = [];
  for (const line of text.split(/\r?\n/)) {
    const cleaned = line.trim();
    if (!cleaned) continue;
    const match = cleaned.match(/^\s*\d+\.\s*(.+?)(?:,\s*([A-Za-z0-9:_-]{4,}))?\s*$/);
    if (!match) continue;
    const name = String(match[1] || '').trim().slice(0, 80);
    const platformId = String(match[2] || '').trim().slice(0, 120);
    if (!name && !platformId) continue;
    players.push(Object.freeze({ name, platformId: platformId || undefined }));
    if (players.length >= 200) break;
  }

  return Object.freeze({
    serverId: target.serverId,
    envPrefix: target.envPrefix,
    playerCount: players.length,
    players: Object.freeze(players),
    observedAt: new Date().toISOString(),
  });
}

function registerArkRconPlayersJob(scheduler, { adapter, servers, intervalMs = 300000, jitterMs = 30000, onResult } = {}) {
  if (!scheduler?.register) throw new TypeError('scheduler is required');
  if (!adapter?.listPlayers) throw new TypeError('read-only ARK RCON adapter is required');
  const getServers = typeof servers === 'function' ? servers : () => (Array.isArray(servers) ? servers : []);

  scheduler.register({
    name: 'ark.rcon.players.read',
    owner: 'ark',
    trigger: { type: 'interval', intervalMs, jitterMs },
    timeoutMs: 60000,
    retry: { attempts: 2, baseDelayMs: 2000, maxDelayMs: 10000, factor: 2, jitterMs: 1000 },
    run: async ({ correlationId } = {}) => {
      const outcomes = [];
      for (const server of getServers().filter((item) => item?.enabled !== false && item?.connections?.rcon !== false)) {
        outcomes.push(await adapter.listPlayers(server, { correlationId }));
      }
      const summary = {
        servers: outcomes.length,
        succeeded: outcomes.filter((item) => item?.ok === true).length,
        blocked: outcomes.filter((item) => item?.blocked === true).length,
        failed: outcomes.filter((item) => item?.ok === false && item?.blocked !== true).length,
        players: outcomes.reduce((total, item) => total + (item?.ok ? Number(item.result?.playerCount || 0) : 0), 0),
      };
      await onResult?.(summary, outcomes, { correlationId });
      return summary;
    },
  });
}

module.exports = {
  ArkRconReadAdapter,
  READ_COMMANDS,
  normalizeTarget,
  normalizeListPlayers,
  registerArkRconPlayersJob,
};
