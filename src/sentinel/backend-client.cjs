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
  trackedServers() { return this.request('/v1/tracked-servers'); }
  communityLevel(userId) { return this.request(`/v1/community-xp/users/${encodeURIComponent(userId)}`); }
  communityLeaderboard(limit = 10) { return this.request(`/v1/community-xp/leaderboard?limit=${encodeURIComponent(limit)}`); }
  communityLevelSettings() { return this.request('/v1/community-xp/settings'); }
  communityLevelAudit(limit = 50) { return this.request(`/v1/community-xp/audit?limit=${encodeURIComponent(limit)}`); }
  communityAward(input) { return this.request('/v1/community-xp/award', { method: 'POST', body: JSON.stringify(input || {}) }); }
  communityRemoveXp(input) { return this.request('/v1/community-xp/remove', { method: 'POST', body: JSON.stringify(input || {}) }); }
  communitySetXp(input) { return this.request('/v1/community-xp/set', { method: 'POST', body: JSON.stringify(input || {}) }); }
  communityResetXp(input) { return this.request('/v1/community-xp/reset', { method: 'POST', body: JSON.stringify(input || {}) }); }
  communityUpdateSettings(input) { return this.request('/v1/community-xp/settings', { method: 'POST', body: JSON.stringify(input || {}) }); }
  accounts() { return this.request('/v1/accounts'); }
  accountByDiscord(discordId) { return this.request(`/v1/accounts/discord/${encodeURIComponent(discordId)}`); }
  createPairingCode(role) { return this.request('/v1/accounts/pairing-codes', { method: 'POST', body: JSON.stringify({ role }) }); }
  linkAccount(code, discord) { return this.request('/v1/accounts/link', { method: 'POST', body: JSON.stringify({ code, discord }) }); }
  removeAccount(accountId) { return this.request(`/v1/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' }); }
  configureModules(enabled) { return this.request('/v1/admin/modules', { method: 'POST', body: JSON.stringify({ enabled: enabled || {} }) }); }
  configureProviders(modules) { return this.request('/v1/admin/providers', { method: 'POST', body: JSON.stringify({ modules: modules || {} }) }); }
  validateProviders(moduleId = '') { return this.request('/v1/providers/validate', { method: 'POST', body: JSON.stringify({ moduleId }) }); }
  arkTamingSpecies() { return this.request('/v1/ark/taming/species'); }
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
