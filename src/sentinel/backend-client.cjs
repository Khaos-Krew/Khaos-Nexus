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
  hostedServers() { return this.request('/v1/admin/hosted-servers'); }
  addHostedServer(input) { return this.request('/v1/admin/hosted-servers', { method: 'POST', body: JSON.stringify(input || {}) }); }
  updateHostedServer(id, input) { return this.request(`/v1/admin/hosted-servers/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input || {}) }); }
  removeHostedServer(id) { return this.request(`/v1/admin/hosted-servers/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  serverApplications({ applicant = '', status = '' } = {}) {
    const query = new URLSearchParams(); if (applicant) query.set('applicant', applicant); if (status) query.set('status', status);
    return this.request(`/v1/admin/server-applications${query.size ? `?${query}` : ''}`);
  }
  submitServerApplication(input) { return this.request('/v1/admin/server-applications', { method:'POST', body:JSON.stringify(input || {}) }); }
  reviewServerApplication(id, input) { return this.request(`/v1/admin/server-applications/${encodeURIComponent(id)}/review`, { method:'POST', body:JSON.stringify(input || {}) }); }
  financeSummary() { return this.request('/v1/admin/finance/summary'); }
  financeAccounts() { return this.request('/v1/admin/finance/accounts'); }
  financeAddAccount(input, actorId = '') { return this.request('/v1/admin/finance/accounts', { method:'POST', headers:{ 'x-nexus-actor':actorId }, body:JSON.stringify(input || {}) }); }
  financeTransactions(filters = {}) {
    const query = new URLSearchParams();
    if (filters.limit) query.set('limit', filters.limit);
    if (filters.account) query.set('account', filters.account);
    if (filters.type) query.set('type', filters.type);
    if (filters.status) query.set('status', filters.status);
    return this.request(`/v1/admin/finance/transactions${query.size ? `?${query}` : ''}`);
  }
  financeAddTransaction(input, actorId = '') { return this.request('/v1/admin/finance/transactions', { method:'POST', headers:{ 'x-nexus-actor':actorId }, body:JSON.stringify(input || {}) }); }
  financeBills({ enabledOnly = false } = {}) { return this.request(`/v1/admin/finance/bills${enabledOnly ? '?enabled=true' : ''}`); }
  financeAddBill(input, actorId = '') { return this.request('/v1/admin/finance/bills', { method:'POST', headers:{ 'x-nexus-actor':actorId }, body:JSON.stringify(input || {}) }); }
  financeMarkBillPaid(id, input = {}, actorId = '') { return this.request(`/v1/admin/finance/bills/${encodeURIComponent(id)}/paid`, { method:'POST', headers:{ 'x-nexus-actor':actorId }, body:JSON.stringify(input || {}) }); }
  financeDisableBill(id, actorId = '') { return this.request(`/v1/admin/finance/bills/${encodeURIComponent(id)}/disable`, { method:'POST', headers:{ 'x-nexus-actor':actorId }, body:'{}' }); }
  financeDueAlerts() { return this.request('/v1/admin/finance/alerts/due'); }
  financeAlerts({ activeOnly = false, limit = 100 } = {}) {
    const query = new URLSearchParams({ limit:String(limit) }); if (activeOnly) query.set('active', 'true');
    return this.request(`/v1/admin/finance/alerts?${query}`);
  }
  financeRecordAlert(input, actorId = '') { return this.request('/v1/admin/finance/alerts/dispatch', { method:'POST', headers:{ 'x-nexus-actor':actorId }, body:JSON.stringify(input || {}) }); }
  financeAcknowledgeAlert(input, actorId = '') { return this.request('/v1/admin/finance/alerts/ack', { method:'POST', headers:{ 'x-nexus-actor':actorId }, body:JSON.stringify(input || {}) }); }
  financeAudit(limit = 100) { return this.request(`/v1/admin/finance/audit?limit=${encodeURIComponent(limit)}`); }
  communityLevel(userId) { return this.request(`/v1/community-xp/users/${encodeURIComponent(userId)}`); }
  communityAchievements(userId) { return this.request(`/v1/community-xp/users/${encodeURIComponent(userId)}/achievements`); }
  communityAchievementCatalog() { return this.request('/v1/community-xp/achievements'); }
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
      method:'POST', headers:{ 'x-nexus-role':context.role || 'viewer', 'x-nexus-actor':context.actorId || '', 'x-nexus-confirmed':context.confirmed === true ? 'true' : 'false' }, body:JSON.stringify({ payload:payload || {} })
    });
  }
}

module.exports = { BackendClient };
