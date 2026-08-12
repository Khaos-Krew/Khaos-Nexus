'use strict';

const DEFAULT_BASE_URL = 'https://api.nitrado.net';

class NitradoApiError extends Error {
  constructor(message, { status = null, code = 'NITRADO_API_ERROR', endpoint = '', cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'NitradoApiError';
    this.status = status;
    this.code = code;
    this.endpoint = endpoint;
  }
}

function cleanServiceId(value) {
  const id = String(value || '').trim();
  if (!/^\d{1,20}$/.test(id)) throw new NitradoApiError('A numeric Nitrado Service ID is required.', { code: 'INVALID_SERVICE_ID' });
  return id;
}

function cleanToken(value) {
  const token = String(value || '').trim();
  if (!token) throw new NitradoApiError('A Nitrado API token is required.', { code: 'MISSING_TOKEN' });
  return token;
}

function errorDetail(payload) {
  if (typeof payload === 'string') return payload.slice(0, 300);
  return String(payload?.message || payload?.error || payload?.status || '').trim().slice(0, 300);
}

function gameServerFrom(payload = {}) {
  return payload?.data?.gameserver || payload?.data?.server || payload?.gameserver || payload?.server || payload?.data || {};
}

function firstText(values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text.slice(0, 160);
  }
  return '';
}

function normalizeNitradoStatus(payload = {}) {
  const server = gameServerFrom(payload);
  const status = firstText([
    server.status,
    server.state,
    server.query?.status,
    server.query?.server_status
  ]).toLowerCase() || 'unknown';
  const version = firstText([
    server.query?.version,
    server.query?.server_version,
    server.version,
    server.game_version,
    server.details?.version
  ]);
  return {
    serviceId: firstText([server.service_id, server.serviceId]),
    status,
    version,
    game: firstText([server.game, server.game_human, server.gameHuman]),
    ip: firstText([server.ip]),
    port: Number(server.port || 0) || 0,
    queryPort: Number(server.query_port || server.queryPort || 0) || 0,
    rawStatus: status
  };
}

function onlineLike(status) {
  const value = String(status || '').toLowerCase();
  return ['started', 'running', 'online', 'ready'].includes(value);
}

function offlineLike(status) {
  const value = String(status || '').toLowerCase();
  return ['stopped', 'stopping', 'restarting', 'restart', 'offline', 'installing', 'updating'].includes(value);
}

class NitradoClient {
  constructor({ serviceId, token, requestTimeoutSeconds = 15, baseUrl = DEFAULT_BASE_URL, fetchImpl = global.fetch } = {}) {
    this.serviceId = cleanServiceId(serviceId);
    this.token = cleanToken(token);
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Math.max(3000, Math.min(60000, Number(requestTimeoutSeconds || 15) * 1000));
    const url = new URL(String(baseUrl || DEFAULT_BASE_URL));
    if (url.protocol !== 'https:') throw new NitradoApiError('Nitrado API connections must use HTTPS.', { code: 'INSECURE_ENDPOINT' });
    this.baseUrl = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
    if (typeof fetchImpl !== 'function') throw new NitradoApiError('HTTP networking is unavailable.', { code: 'NETWORK_UNAVAILABLE' });
  }

  endpoint(pathname = '') {
    const path = String(pathname || '').replace(/^\/+/, '');
    return `${this.baseUrl}/services/${this.serviceId}/gameservers${path ? `/${path}` : ''}`;
  }

  async request(method, pathname = '') {
    const endpoint = this.endpoint(pathname);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(endpoint, {
        method,
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.token}`,
          'User-Agent': 'Khaos-Nexus/Palworld-Nitrado'
        }
      });
      const text = await response.text();
      let payload = null;
      if (text) {
        try { payload = JSON.parse(text); }
        catch { payload = text; }
      }
      if (!response.ok) {
        const detail = errorDetail(payload);
        if (response.status === 401) throw new NitradoApiError('Nitrado rejected the API token.', { status: 401, code: 'AUTH_FAILED', endpoint });
        if (response.status === 403) throw new NitradoApiError(`The Nitrado token is not authorized for this service${detail ? `: ${detail}` : '.'}`, { status: 403, code: 'FORBIDDEN', endpoint });
        if (response.status === 404) throw new NitradoApiError('The Nitrado Service ID or gameserver endpoint was not found.', { status: 404, code: 'NOT_FOUND', endpoint });
        if (response.status === 429) throw new NitradoApiError('The Nitrado API rate limit was reached. The next scheduler check will retry.', { status: 429, code: 'RATE_LIMITED', endpoint });
        throw new NitradoApiError(`Nitrado request failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}.`, { status: response.status, code: 'HTTP_ERROR', endpoint });
      }
      return payload ?? { status: 'success' };
    } catch (error) {
      if (error instanceof NitradoApiError) throw error;
      if (error?.name === 'AbortError') throw new NitradoApiError(`Nitrado request timed out after ${Math.round(this.timeoutMs / 1000)} seconds.`, { code: 'TIMEOUT', endpoint, cause: error });
      throw new NitradoApiError(`Nitrado connection failed: ${error?.message || error}`, { code: 'CONNECTION_FAILED', endpoint, cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  async status() {
    return normalizeNitradoStatus(await this.request('GET'));
  }

  async restart() {
    const payload = await this.request('POST', 'restart');
    return { accepted: true, serviceId: this.serviceId, action: 'restart', responseStatus: firstText([payload?.status, payload?.message]) };
  }

  async start() {
    const payload = await this.request('POST', 'start');
    return { accepted: true, serviceId: this.serviceId, action: 'start', responseStatus: firstText([payload?.status, payload?.message]) };
  }

  async stop() {
    const payload = await this.request('POST', 'stop');
    return { accepted: true, serviceId: this.serviceId, action: 'stop', responseStatus: firstText([payload?.status, payload?.message]) };
  }
}

module.exports = {
  DEFAULT_BASE_URL,
  NitradoApiError,
  NitradoClient,
  cleanServiceId,
  normalizeNitradoStatus,
  onlineLike,
  offlineLike,
  errorDetail
};
