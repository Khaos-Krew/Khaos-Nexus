'use strict';

const { envSecret } = require('../shared/config.cjs');

class BackendClient {
  constructor(config) {
    this.baseUrl = String(config.backend?.publicBaseUrl || `http://${config.backend?.host || '127.0.0.1'}:${config.backend?.port || 3210}`).replace(/\/$/, '');
    this.token = envSecret(config.backend?.serviceTokenEnv);
  }

  async request(path, options = {}) {
    const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const response = await fetch(`${this.baseUrl}${path}`, { ...options, headers });
    const body = await response.json().catch(() => ({ ok: false, message: `Backend returned HTTP ${response.status}.` }));
    return { status: response.status, ...body };
  }

  modules() { return this.request('/v1/modules'); }
  health() { return this.request('/health'); }
  accounts() { return this.request('/v1/accounts'); }
  accountByDiscord(discordId) { return this.request(`/v1/accounts/discord/${encodeURIComponent(discordId)}`); }
  createPairingCode(role) { return this.request('/v1/accounts/pairing-codes', { method: 'POST', body: JSON.stringify({ role }) }); }
  linkAccount(code, discord) { return this.request('/v1/accounts/link', { method: 'POST', body: JSON.stringify({ code, discord }) }); }
  removeAccount(accountId) { return this.request(`/v1/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' }); }
  configureModules(enabled) { return this.request('/v1/admin/modules', { method: 'POST', body: JSON.stringify({ enabled: enabled || {} }) }); }
  validateProviders(moduleId = '') { return this.request('/v1/providers/validate', { method: 'POST', body: JSON.stringify({ moduleId }) }); }
  invoke(moduleId, actionId, payload, context = {}) {
    return this.request(`/v1/modules/${encodeURIComponent(moduleId)}/actions/${encodeURIComponent(actionId)}`, {
      method: 'POST',
      headers: {
        'x-nexus-role': context.role || 'viewer',
        'x-nexus-actor': context.actorId || '',
        'x-nexus-confirmed': context.confirmed === true ? 'true' : 'false'
      },
      body: JSON.stringify({ payload: payload || {} })
    });
  }
}

module.exports = { BackendClient };
