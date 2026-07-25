'use strict';

const {
  normalizePanelUrl,
  normalizePowerSignal,
  normalizePterodactylServer,
  normalizePterodactylResources
} = require('../../shared/hosted-server-control.cjs');

class PterodactylApiError extends Error {
  constructor(message, { status = null, code = 'PTERODACTYL_API_ERROR', endpoint = '', cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PterodactylApiError';
    this.status = status;
    this.code = code;
    this.endpoint = endpoint;
  }
}

function errorDetail(payload) {
  if (typeof payload === 'string') return payload.slice(0, 300);
  const first = Array.isArray(payload?.errors) ? payload.errors[0] : null;
  return String(first?.detail || first?.code || payload?.message || '').trim().slice(0, 300);
}

class PterodactylClient {
  constructor(provider = {}, token = '', { fetchImpl = global.fetch } = {}) {
    this.baseUrl = normalizePanelUrl(provider.baseUrl, provider.allowInsecureHttp);
    this.token = String(token || '').trim();
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Math.max(3000, Number(provider.requestTimeoutSeconds || 12) * 1000);
    if (!this.token) throw new PterodactylApiError('The Pterodactyl Client API key is missing.', { code: 'MISSING_TOKEN' });
    if (typeof fetchImpl !== 'function') throw new PterodactylApiError('HTTP networking is unavailable.', { code: 'NETWORK_UNAVAILABLE' });
  }

  endpoint(pathname, query = '') {
    const path = String(pathname || '').replace(/^\/+/, '');
    return `${this.baseUrl}/api/client${path ? `/${path}` : ''}${query || ''}`;
  }

  async request(method, pathname, body, query = '') {
    const endpoint = this.endpoint(pathname, query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(endpoint, {
        method,
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          Accept: 'Application/vnd.pterodactyl.v1+json',
          Authorization: `Bearer ${this.token}`,
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
        const detail = errorDetail(payload);
        if (response.status === 401) throw new PterodactylApiError('Pterodactyl rejected the Client API key.', { status: 401, code: 'AUTH_FAILED', endpoint });
        if (response.status === 403) throw new PterodactylApiError(`The Pterodactyl account does not have permission for this action${detail ? `: ${detail}` : '.'}`, { status: 403, code: 'FORBIDDEN', endpoint });
        if (response.status === 404) throw new PterodactylApiError('The Pterodactyl panel or server endpoint was not found.', { status: 404, code: 'NOT_FOUND', endpoint });
        if (response.status === 429) throw new PterodactylApiError('The Pterodactyl Client API rate limit was reached. Wait before refreshing again.', { status: 429, code: 'RATE_LIMITED', endpoint });
        throw new PterodactylApiError(`Pterodactyl request failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}.`, { status: response.status, code: 'HTTP_ERROR', endpoint });
      }
      return payload ?? { ok: true };
    } catch (error) {
      if (error instanceof PterodactylApiError) throw error;
      if (error?.name === 'AbortError') throw new PterodactylApiError(`Pterodactyl request timed out after ${Math.round(this.timeoutMs / 1000)} seconds.`, { code: 'TIMEOUT', endpoint, cause: error });
      throw new PterodactylApiError(`Pterodactyl connection failed: ${error?.message || error}`, { code: 'CONNECTION_FAILED', endpoint, cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  async listServers() {
    const servers = [];
    let page = 1;
    let totalPages = 1;
    do {
      const payload = await this.request('GET', '', undefined, `?page=${page}&per_page=100`);
      const data = Array.isArray(payload?.data) ? payload.data : [];
      servers.push(...data.map(normalizePterodactylServer).filter((server) => server.identifier));
      totalPages = Math.max(1, Number(payload?.meta?.pagination?.total_pages) || 1);
      page += 1;
    } while (page <= totalPages && page <= 20);
    return servers;
  }

  async resources(identifier) {
    const id = String(identifier || '').trim();
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new PterodactylApiError('Invalid Pterodactyl server identifier.', { code: 'INVALID_IDENTIFIER' });
    return normalizePterodactylResources(await this.request('GET', `servers/${id}/resources`));
  }

  async power(identifier, signalInput) {
    const id = String(identifier || '').trim();
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new PterodactylApiError('Invalid Pterodactyl server identifier.', { code: 'INVALID_IDENTIFIER' });
    const signal = normalizePowerSignal(signalInput);
    await this.request('POST', `servers/${id}/power`, { signal });
    return { accepted: true, signal };
  }
}

module.exports = { PterodactylClient, PterodactylApiError, errorDetail };
