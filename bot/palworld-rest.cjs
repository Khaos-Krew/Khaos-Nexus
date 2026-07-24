'use strict';

const DEFAULT_API_PATH = '/v1/api';
const DEFAULT_USERNAME = 'admin';

function cleanApiPath(value) {
  const path = String(value || DEFAULT_API_PATH).trim() || DEFAULT_API_PATH;
  return `/${path.replace(/^\/+|\/+$/g, '')}`;
}

function normalizeServerAddress(server = {}) {
  let host = String(server.host || '').trim();
  let port = Number(server.port || 0);
  let protocol = String(server.protocol || 'http').toLowerCase() === 'https' ? 'https' : 'http';
  let apiPath = cleanApiPath(server.apiPath);

  if (/^https?:\/\//i.test(host)) {
    const parsed = new URL(host);
    protocol = parsed.protocol === 'https:' ? 'https' : 'http';
    host = parsed.hostname;
    if (!port && parsed.port) port = Number(parsed.port);
    if (parsed.pathname && parsed.pathname !== '/') apiPath = cleanApiPath(parsed.pathname);
  } else {
    const ipv6 = host.match(/^\[([^\]]+)\](?::(\d+))?$/);
    const hostPort = !ipv6 && host.match(/^([^:]+):(\d+)$/);
    if (ipv6) {
      host = ipv6[1];
      if (!port && ipv6[2]) port = Number(ipv6[2]);
    } else if (hostPort) {
      host = hostPort[1];
      if (!port) port = Number(hostPort[2]);
    }
  }

  return {
    ...server,
    host,
    port,
    protocol,
    apiPath,
    username: String(server.username || DEFAULT_USERNAME).trim() || DEFAULT_USERNAME
  };
}

class PalworldRestError extends Error {
  constructor(message, { status = null, code = 'PALWORLD_REST_ERROR', endpoint = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PalworldRestError';
    this.status = status;
    this.code = code;
    this.endpoint = endpoint;
  }
}

class PalworldRestClient {
  constructor(server = {}, { fetchImpl = global.fetch, timeoutMs = 10000 } = {}) {
    const normalized = normalizeServerAddress(server);
    if (!normalized.host) throw new PalworldRestError('Palworld REST host is missing.', { code: 'INVALID_CONFIG' });
    if (!Number.isInteger(normalized.port) || normalized.port < 1 || normalized.port > 65535) {
      throw new PalworldRestError('Palworld REST port must be between 1 and 65535.', { code: 'INVALID_CONFIG' });
    }
    if (!server.password) throw new PalworldRestError('Palworld AdminPassword is missing.', { code: 'MISSING_PASSWORD' });
    if (typeof fetchImpl !== 'function') throw new PalworldRestError('HTTP networking is unavailable.', { code: 'NETWORK_UNAVAILABLE' });

    this.server = { ...normalized, password: String(server.password) };
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || 10000);
    const hostForUrl = normalized.host.includes(':') && !normalized.host.startsWith('[') ? `[${normalized.host}]` : normalized.host;
    this.baseUrl = `${normalized.protocol}://${hostForUrl}:${normalized.port}${normalized.apiPath}`;
  }

  endpoint(pathname) {
    return `${this.baseUrl}/${String(pathname || '').replace(/^\/+/, '')}`;
  }

  async request(method, pathname, body) {
    const endpoint = this.endpoint(pathname);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();
    const auth = Buffer.from(`${this.server.username}:${this.server.password}`, 'utf8').toString('base64');

    try {
      const response = await this.fetchImpl(endpoint, {
        method,
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          Authorization: `Basic ${auth}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });

      const text = await response.text();
      let payload = null;
      if (text) {
        try { payload = JSON.parse(text); } catch { payload = text; }
      }

      if (!response.ok) {
        if (response.status === 401) {
          throw new PalworldRestError('Palworld REST authentication failed. Verify the API username and AdminPassword.', { status: 401, code: 'AUTH_FAILED', endpoint });
        }
        if (response.status === 404) {
          throw new PalworldRestError('Palworld REST endpoint was not found. Verify RESTAPIEnabled, RESTAPIPort, and the API path.', { status: 404, code: 'ENDPOINT_NOT_FOUND', endpoint });
        }
        const detail = typeof payload === 'string' ? payload : payload?.message;
        throw new PalworldRestError(`Palworld REST request failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}.`, { status: response.status, code: 'HTTP_ERROR', endpoint });
      }

      return payload ?? { ok: true };
    } catch (error) {
      if (error instanceof PalworldRestError) throw error;
      if (error?.name === 'AbortError') {
        throw new PalworldRestError(`Palworld REST request timed out after ${this.timeoutMs}ms.`, { code: 'TIMEOUT', endpoint, cause: error });
      }
      throw new PalworldRestError(`Palworld REST connection failed: ${error?.message || error}`, { code: 'CONNECTION_FAILED', endpoint, cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  info() { return this.request('GET', 'info'); }
  players() { return this.request('GET', 'players'); }
  settings() { return this.request('GET', 'settings'); }
  metrics() { return this.request('GET', 'metrics'); }
  gameData() { return this.request('GET', 'game-data'); }
  announce(message) { return this.request('POST', 'announce', { message: String(message || '').trim() }); }
  save() { return this.request('POST', 'save'); }
  kick(userid, message = '') { return this.request('POST', 'kick', { userid: String(userid), ...(message ? { message: String(message) } : {}) }); }
  ban(userid, message = '') { return this.request('POST', 'ban', { userid: String(userid), ...(message ? { message: String(message) } : {}) }); }
  unban(userid) { return this.request('POST', 'unban', { userid: String(userid) }); }
  shutdown(waittime, message = '') { return this.request('POST', 'shutdown', { waittime: Math.max(0, Math.round(Number(waittime) || 0)), ...(message ? { message: String(message) } : {}) }); }
  stop() { return this.request('POST', 'stop'); }
}

function summarizeGameData(snapshot) {
  const actors = Array.isArray(snapshot?.ActorData) ? snapshot.ActorData : [];
  const types = {};
  for (const actor of actors) {
    const key = String(actor?.UnitType || actor?.Type || 'Unknown');
    types[key] = (types[key] || 0) + 1;
  }
  return {
    time: snapshot?.Time || null,
    fps: snapshot?.FPS ?? null,
    averageFps: snapshot?.AverageFPS ?? null,
    actorCount: actors.length,
    actorTypes: types
  };
}

module.exports = {
  PalworldRestClient,
  PalworldRestError,
  normalizeServerAddress,
  summarizeGameData,
  DEFAULT_API_PATH,
  DEFAULT_USERNAME
};
