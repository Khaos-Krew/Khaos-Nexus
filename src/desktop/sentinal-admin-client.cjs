'use strict';

const { envSecret } = require('../shared/config.cjs');

function cleanBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

class SentinalAdminClient {
  constructor(config = {}, options = {}) {
    this.baseUrl = cleanBaseUrl(config.discord?.sentinalAdminUrl || '');
    this.token = envSecret(config.discord?.sentinalAdminTokenEnv || 'NEXUS_SENTINAL_ADMIN_TOKEN');
    this.fetchImpl = options.fetchImpl || global.fetch;
  }

  configured() {
    return Boolean(this.baseUrl);
  }

  async request(path, options = {}) {
    if (!this.baseUrl) return { ok: false, code: 'SENTINAL_ADMIN_NOT_CONFIGURED', message: 'Configure the Nexus Sentinal admin URL first.' };
    const headers = { accept: 'application/json', ...(options.headers || {}) };
    if (options.body) headers['content-type'] = 'application/json';
    if (path !== '/health' && this.token) headers.authorization = `Bearer ${this.token}`;
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...options,
        headers,
        signal: options.signal || AbortSignal.timeout(options.timeoutMs || 15000)
      });
      const payload = await response.json().catch(() => ({ ok: false, message: `Sentinal admin returned HTTP ${response.status}.` }));
      return { status: response.status, ...payload };
    } catch (error) {
      return { ok: false, code: 'SENTINAL_ADMIN_UNREACHABLE', message: String(error?.message || error).slice(0, 240) };
    }
  }

  health() { return this.request('/health', { timeoutMs: 5000 }); }
  status() { return this.request('/v1/status'); }
  permissions() { return this.request('/v1/permissions'); }
  commands() { return this.request('/v1/commands'); }
  channels(moduleId = '') { return this.request(`/v1/channels${moduleId ? `?module=${encodeURIComponent(moduleId)}` : ''}`); }
  roles() { return this.request('/v1/roles'); }
  scan() { return this.request('/v1/scan'); }
  syncCommands() { return this.request('/v1/commands/sync', { method: 'POST' }); }
  reconcileChannels(moduleId = '') { return this.request('/v1/channels/reconcile', { method: 'POST', body: JSON.stringify({ moduleId }) }); }
  refreshConsoles(moduleId = '') { return this.request('/v1/consoles/refresh', { method: 'POST', body: JSON.stringify({ moduleId }) }); }
  reconcileRoles() { return this.request('/v1/roles/reconcile', { method: 'POST' }); }
  repair() { return this.request('/v1/repair', { method: 'POST' }); }
}

module.exports = { SentinalAdminClient, cleanBaseUrl };
