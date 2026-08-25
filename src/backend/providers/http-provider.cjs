'use strict';

const { envSecret } = require('../../shared/config.cjs');

class HttpProvider {
  constructor(moduleId, config = {}) {
    this.moduleId = moduleId;
    this.baseUrl = String(config.baseUrl || '').replace(/\/$/, '');
    this.token = envSecret(config.tokenEnv);
    this.connected = true;
    this.providerKind = 'external-http';
    this.fetchImpl = config.fetchImpl || fetch;
    this.timeoutMs = Math.max(1000, Math.min(30000, Number(config.timeoutMs || 10000)));
    this.maxResponseBytes = Math.max(1024, Math.min(5 * 1024 * 1024, Number(config.maxResponseBytes || 1024 * 1024)));
    this.supportedActions = Array.isArray(config.actions)
      ? [...new Set(config.actions.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))]
      : undefined;
    if (!this.baseUrl) throw new Error(`${moduleId}: HTTP provider requires baseUrl.`);
  }

  async invoke(actionId, payload = {}, context = {}) {
    const headers = {
      'content-type': 'application/json',
      'x-nexus-role': context.role || 'viewer',
      'x-nexus-actor': context.actorId || '',
      'x-nexus-confirmed': context.confirmed === true ? 'true' : 'false'
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const response = await this.fetchImpl(`${this.baseUrl}/actions/${encodeURIComponent(actionId)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ payload }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    const text = await response.text();
    if (Buffer.byteLength(text) > this.maxResponseBytes) throw new Error('Provider response exceeded the configured safety limit.');
    let body;
    try { body = text ? JSON.parse(text) : {}; } catch { body = { message: `Provider returned HTTP ${response.status}.` }; }
    if (!response.ok) throw new Error(body.message || body.code || `Provider returned HTTP ${response.status}.`);
    return body.data ?? body;
  }
}

class VeyraDndProvider extends HttpProvider {
  constructor(config = {}) {
    super('dnd', config);
    this.providerKind = 'veyra-dnd-gateway';
    this.authoritativeOwner = 'veyra';
  }

  async invoke(actionId, payload = {}, context = {}) {
    const actorId = String(context.actorId || '').trim();
    if (!actorId) throw new Error('Veyra D&D actions require a linked actor identity.');
    return super.invoke(actionId, payload, { ...context, actorId });
  }
}

function providersFromConfig(config = {}) {
  const providers = {};
  for (const [moduleId, moduleConfig] of Object.entries(config.modules || {})) {
    const provider = moduleConfig?.provider || {};
    if (moduleId === 'dnd' && provider.type === 'veyra' && provider.baseUrl) providers[moduleId] = new VeyraDndProvider(provider);
    else if (provider.type === 'http' && provider.baseUrl) providers[moduleId] = new HttpProvider(moduleId, provider);
  }
  return providers;
}

module.exports = { HttpProvider, VeyraDndProvider, providersFromConfig };
