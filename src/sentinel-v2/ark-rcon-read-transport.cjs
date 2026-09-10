'use strict';

const { ArkRconClient } = require('../sentinel/ark-rcon.cjs');
const { resolveRconServer, normalizePrefix } = require('../sentinel/ark-rcon-config-store.cjs');

const ALLOWED_COMMAND = 'ListPlayers';

class ArkRconReadTransport {
  constructor({ env = process.env, resolveServer = resolveRconServer, clientFactory, logger } = {}) {
    if (typeof resolveServer !== 'function') throw new TypeError('RCON credential resolver is required');
    this.env = env;
    this.resolveServer = resolveServer;
    this.clientFactory = clientFactory || ((options) => new ArkRconClient(options));
    this.logger = logger;
  }

  async request({ serverId, envPrefix, command } = {}) {
    const id = String(serverId || '').trim();
    const prefix = normalizePrefix(envPrefix);
    if (!id) throw new TypeError('ARK RCON server id is required');
    if (command !== ALLOWED_COMMAND) throw new Error('ARK RCON read transport only permits ListPlayers');

    const resolved = this.resolveServer(prefix, this.env);
    const credentials = normalizeResolvedServer(resolved, prefix);
    const client = this.clientFactory({
      host: credentials.host,
      port: credentials.port,
      password: credentials.password,
      timeoutMs: credentials.timeoutMs,
    });
    if (!client || typeof client.execute !== 'function') {
      throw new TypeError('ARK RCON client must expose execute()');
    }

    this.logger?.info?.('sentinel.ark.rcon.transport_request', {
      serverId: id,
      envPrefix: prefix,
      operation: 'players.list',
      credentialSource: credentials.source,
    });

    return client.execute(ALLOWED_COMMAND);
  }
}

function normalizeResolvedServer(server = {}, prefix = '') {
  const host = String(server.host || '').trim();
  const port = Number(server.port);
  const password = String(server.password || '');
  const timeoutMs = Math.max(1000, Math.min(30000, Number(server.timeoutMs) || 8000));
  if (server.enabled === false) throw new Error(`ARK RCON target is disabled: ${prefix}`);
  if (!host) throw new Error(`ARK RCON host is missing: ${prefix}`);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`ARK RCON port is invalid: ${prefix}`);
  if (!password) throw new Error(`ARK RCON password is missing: ${prefix}`);
  return Object.freeze({
    host,
    port,
    password,
    timeoutMs,
    source: String(server.source || 'configured').slice(0, 40),
  });
}

module.exports = {
  ArkRconReadTransport,
  ALLOWED_COMMAND,
  normalizeResolvedServer,
};
