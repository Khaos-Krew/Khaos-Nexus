'use strict';

const { envSecret } = require('../shared/config.cjs');

const ADMIN_REQUEST_TIMEOUTS = Object.freeze({
  default: 15000,
  health: 5000,
  provider: 30000,
  scan: 60000,
  commandSync: 45000,
  channelReconcile: 90000,
  consoleRefresh: 90000,
  roleReconcile: 60000,
  repair: 120000
});

function cleanBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function timeoutFailure(path, timeoutMs) {
  const seconds = Math.max(1, Math.round(Number(timeoutMs || ADMIN_REQUEST_TIMEOUTS.default) / 1000));
  const operation = path === '/v1/scan' ? 'Discord scan' : path === '/v1/repair' ? 'Discord repair' : 'Sentinal request';
  return {
    ok: false,
    code: 'SENTINAL_ADMIN_TIMEOUT',
    message: `${operation} did not finish within ${seconds} seconds. No repair was assumed complete; retry the operation or check Diagnostics if it repeats.`
  };
}

function isTimeoutError(error) {
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return name === 'timeouterror' || (name === 'aborterror' && message.includes('timeout')) || message.includes('aborted due to timeout');
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
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || ADMIN_REQUEST_TIMEOUTS.default));
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...options,
        headers,
        signal: options.signal || AbortSignal.timeout(timeoutMs)
      });
      const payload = await response.json().catch(() => ({ ok: false, message: `Sentinal admin returned HTTP ${response.status}.` }));
      return { status: response.status, ...payload };
    } catch (error) {
      if (isTimeoutError(error)) return timeoutFailure(path, timeoutMs);
      return { ok: false, code: 'SENTINAL_ADMIN_UNREACHABLE', message: String(error?.message || error).slice(0, 240) };
    }
  }

  health() { return this.request('/health', { timeoutMs: ADMIN_REQUEST_TIMEOUTS.health }); }
  status() { return this.request('/v1/status'); }
  config() { return this.request('/v1/config'); }
  configure(settings = this.adminSettings) { return this.request('/v1/config', { method: 'POST', body: JSON.stringify(settings || {}) }); }
  providerConfig() { return this.request('/v1/providers/config'); }
  configureProviders(modules = {}, secrets = {}, clearSecrets = []) {
    return this.request('/v1/providers/config', {
      method: 'POST',
      body: JSON.stringify({ modules: modules || {}, secrets: secrets || {}, clearSecrets: Array.isArray(clearSecrets) ? clearSecrets : [] }),
      timeoutMs: ADMIN_REQUEST_TIMEOUTS.provider
    });
  }
  validateHostedProvider(moduleId = '') {
    return this.request('/v1/providers/validate', {
      method: 'POST',
      body: JSON.stringify({ moduleId: String(moduleId || '') }),
      timeoutMs: ADMIN_REQUEST_TIMEOUTS.provider
    });
  }
  async syncAdminSettings() {
    if (!this.configured()) return { ok: false, code: 'SENTINAL_ADMIN_NOT_CONFIGURED' };
    return this.configure(this.adminSettings);
  }
  permissions() { return this.request('/v1/permissions'); }
  commands() { return this.request('/v1/commands'); }
  async channels(moduleId = '') { await this.syncAdminSettings(); return this.request(`/v1/channels${moduleId ? `?module=${encodeURIComponent(moduleId)}` : ''}`); }
  async roles() { await this.syncAdminSettings(); return this.request('/v1/roles', { timeoutMs: ADMIN_REQUEST_TIMEOUTS.roleReconcile }); }
  async scan() {
    const synced = await this.syncAdminSettings();
    if (synced?.ok === false && synced?.code !== 'SENTINAL_ADMIN_NOT_CONFIGURED') return synced;
    return this.request('/v1/scan', { timeoutMs: ADMIN_REQUEST_TIMEOUTS.scan });
  }
  syncCommands() { return this.request('/v1/commands/sync', { method: 'POST', timeoutMs: ADMIN_REQUEST_TIMEOUTS.commandSync }); }
  async reconcileChannels(moduleId = '') { await this.syncAdminSettings(); return this.request('/v1/channels/reconcile', { method: 'POST', body: JSON.stringify({ moduleId }), timeoutMs: ADMIN_REQUEST_TIMEOUTS.channelReconcile }); }
  async refreshConsoles(moduleId = '') { await this.syncAdminSettings(); return this.request('/v1/consoles/refresh', { method: 'POST', body: JSON.stringify({ moduleId }), timeoutMs: ADMIN_REQUEST_TIMEOUTS.consoleRefresh }); }
  async reconcileRoles() { await this.syncAdminSettings(); return this.request('/v1/roles/reconcile', { method: 'POST', timeoutMs: ADMIN_REQUEST_TIMEOUTS.roleReconcile }); }
  async repair() { await this.syncAdminSettings(); return this.request('/v1/repair', { method: 'POST', timeoutMs: ADMIN_REQUEST_TIMEOUTS.repair }); }
}

module.exports = { ADMIN_REQUEST_TIMEOUTS, SentinalAdminClient, cleanBaseUrl, isTimeoutError, timeoutFailure };
