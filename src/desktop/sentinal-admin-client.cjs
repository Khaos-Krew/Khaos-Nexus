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
    this.adminSettings = {
      rankRoles: { ...(config.discord?.rankRoles || {}) },
      rankSkus: Object.fromEntries(Object.entries(config.discord?.rankSkus || {}).map(([key, items]) => [key, Array.isArray(items) ? [...items] : []])),
      moduleEnabled: Object.fromEntries(Object.entries(config.modules || {}).map(([id, moduleConfig]) => [id, moduleConfig?.enabled !== false]))
    };
  }

  configured() { return Boolean(this.baseUrl); }

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
  config() { return this.request('/v1/config'); }
  configure(settings = this.adminSettings) { return this.request('/v1/config', { method: 'POST', body: JSON.stringify(settings || {}) }); }
  providerConfig() { return this.request('/v1/providers/config'); }
  configureProviders(modules = {}, secrets = {}, clearSecrets = []) {
    return this.request('/v1/providers/config', {
      method: 'POST',
      body: JSON.stringify({ modules: modules || {}, secrets: secrets || {}, clearSecrets: Array.isArray(clearSecrets) ? clearSecrets : [] }),
      timeoutMs: 30000
    });
  }
  validateHostedProvider(moduleId = '') {
    return this.request('/v1/providers/validate', {
      method: 'POST',
      body: JSON.stringify({ moduleId: String(moduleId || '') }),
      timeoutMs: 30000
    });
  }
  async syncAdminSettings() {
    if (!this.configured()) return { ok: false, code: 'SENTINAL_ADMIN_NOT_CONFIGURED' };
    return this.configure(this.adminSettings);
  }
  permissions() { return this.request('/v1/permissions'); }
  commands() { return this.request('/v1/commands'); }
  async channels(moduleId = '') { await this.syncAdminSettings(); return this.request(`/v1/channels${moduleId ? `?module=${encodeURIComponent(moduleId)}` : ''}`); }
  async roles() { await this.syncAdminSettings(); return this.request('/v1/roles'); }
  async scan() {
    const synced = await this.syncAdminSettings();
    if (synced?.ok === false && synced?.code !== 'SENTINAL_ADMIN_NOT_CONFIGURED') return synced;
    return this.request('/v1/scan');
  }
  syncCommands() { return this.request('/v1/commands/sync', { method: 'POST' }); }
  async reconcileChannels(moduleId = '') { await this.syncAdminSettings(); return this.request('/v1/channels/reconcile', { method: 'POST', body: JSON.stringify({ moduleId }) }); }
  async refreshConsoles(moduleId = '') { await this.syncAdminSettings(); return this.request('/v1/consoles/refresh', { method: 'POST', body: JSON.stringify({ moduleId }) }); }
  async reconcileRoles() { await this.syncAdminSettings(); return this.request('/v1/roles/reconcile', { method: 'POST' }); }
  async repair() { await this.syncAdminSettings(); return this.request('/v1/repair', { method: 'POST' }); }
}

module.exports = { SentinalAdminClient, cleanBaseUrl };
