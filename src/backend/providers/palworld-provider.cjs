'use strict';

const DEFAULT_API_PATH = '/v1/api';
const DEFAULT_USERNAME = 'admin';
const PALWORLD_ACTIONS = Object.freeze(['status', 'players', 'save', 'broadcast']);

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
  return { ...server, host, port, protocol, apiPath, username: String(server.username || DEFAULT_USERNAME).trim() || DEFAULT_USERNAME };
}

class PalworldRestClient {
  constructor(server = {}, options = {}) {
    const normalized = normalizeServerAddress(server);
    if (!normalized.host) throw new Error('Palworld REST host is missing.');
    if (!Number.isInteger(normalized.port) || normalized.port < 1 || normalized.port > 65535) throw new Error('Palworld REST port must be between 1 and 65535.');
    if (!server.password) throw new Error('Palworld AdminPassword is missing.');
    this.server = { ...normalized, password: String(server.password) };
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.timeoutMs = Math.max(1000, Number(options.timeoutMs || 10000));
    if (typeof this.fetchImpl !== 'function') throw new Error('HTTP networking is unavailable.');
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
        try { payload = JSON.parse(text); }
        catch { payload = text; }
      }
      if (!response.ok) {
        if (response.status === 401) throw new Error('Palworld REST authentication failed. Verify the API username and AdminPassword.');
        if (response.status === 404) throw new Error('Palworld REST endpoint was not found. Verify RESTAPIEnabled, RESTAPIPort, and the API path.');
        throw new Error(`Palworld REST request failed with HTTP ${response.status}.`);
      }
      return payload ?? { ok: true };
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`Palworld REST request timed out after ${this.timeoutMs}ms.`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  info() { return this.request('GET', 'info'); }
  players() { return this.request('GET', 'players'); }
  metrics() { return this.request('GET', 'metrics'); }
  announce(message) { return this.request('POST', 'announce', { message: String(message || '').trim() }); }
  save() { return this.request('POST', 'save'); }
}

class PalworldProvider {
  constructor(connection = {}, options = {}) {
    this.client = options.client || new PalworldRestClient(connection, options);
    this.connected = true;
    this.providerKind = 'palworld-rest';
    this.supportedActions = [...PALWORLD_ACTIONS];
  }

  async invoke(actionId, payload = {}) {
    if (!this.supportedActions.includes(actionId)) throw new Error(`Palworld REST does not support ${actionId} through this Nexus capability.`);
    if (actionId === 'status') return { info: await this.client.info(), metrics: await this.client.metrics() };
    if (actionId === 'players') return this.client.players();
    if (actionId === 'save') return this.client.save();
    if (actionId === 'broadcast') {
      const message = String(payload.message || payload.input || '').replace(/[\r\n\u0000]+/g, ' ').trim().slice(0, 500);
      if (!message) return { usage: 'Use /nexus run module:palworld action:broadcast input:<message>.' };
      return this.client.announce(message);
    }
    throw new Error(`Unsupported Palworld action: ${actionId}`);
  }
}

module.exports = {
  PalworldProvider,
  PalworldRestClient,
  PALWORLD_ACTIONS,
  normalizeServerAddress,
  cleanApiPath
};
