'use strict';

const { envSecret } = require('../../shared/config.cjs');

class HttpProvider {
  constructor(moduleId, config = {}) {
    this.moduleId = moduleId;
    this.baseUrl = String(config.baseUrl || '').replace(/\/$/, '');
    this.token = envSecret(config.tokenEnv);
    this.connected = true;
    this.providerKind = 'external-http';
    if (!this.baseUrl) throw new Error(`${moduleId}: HTTP provider requires baseUrl.`);
  }

  async invoke(actionId, payload = {}, context = {}) {
    const headers = { 'content-type': 'application/json', 'x-nexus-role': context.role || 'viewer', 'x-nexus-actor': context.actorId || '' };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const response = await fetch(`${this.baseUrl}/actions/${encodeURIComponent(actionId)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ payload })
    });
    const body = await response.json().catch(() => ({ message: `Provider returned HTTP ${response.status}.` }));
    if (!response.ok) throw new Error(body.message || body.code || `Provider returned HTTP ${response.status}.`);
    return body.data ?? body;
  }
}

function providersFromConfig(config = {}) {
  const providers = {};
  for (const [moduleId, moduleConfig] of Object.entries(config.modules || {})) {
    const provider = moduleConfig?.provider || {};
    if (provider.type === 'http' && provider.baseUrl) providers[moduleId] = new HttpProvider(moduleId, provider);
  }
  return providers;
}

module.exports = { HttpProvider, providersFromConfig };
