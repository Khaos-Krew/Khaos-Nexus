'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { PterodactylClient } = require('./pterodactyl-client.cjs');
const {
  actionToken,
  normalizePowerSignal,
  normalizeHostedHistory,
  formatBytes,
  formatUptime
} = require('../../shared/hosted-server-control.cjs');

class HostedServerService extends EventEmitter {
  constructor({ dataDirectory, configStore, logger, clientFactory, now = () => Date.now() } = {}) {
    super();
    this.configStore = configStore;
    this.logger = logger;
    this.clientFactory = clientFactory || ((provider, token) => new PterodactylClient(provider, token));
    this.now = now;
    this.historyPath = path.join(dataDirectory, 'hosted-server-history.json');
    this.history = this.loadHistory();
    this.tokens = new Map();
    this.snapshot = { refreshedAt: null, providers: [], servers: [], errors: [] };
  }

  loadHistory() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.historyPath, 'utf8'));
      return Array.isArray(parsed) ? parsed.map(normalizeHostedHistory) : [];
    } catch (error) {
      if (error.code !== 'ENOENT') {
        try { fs.renameSync(this.historyPath, `${this.historyPath}.corrupt-${Date.now()}`); } catch {}
      }
      return [];
    }
  }

  saveHistory() {
    const limit = this.configStore.getHostedControlConfig().settings.historyLimit;
    this.history = this.history.slice(0, limit);
    fs.mkdirSync(path.dirname(this.historyPath), { recursive: true });
    const temporary = `${this.historyPath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.history, null, 2), 'utf8');
    fs.renameSync(temporary, this.historyPath);
  }

  record(entry) {
    const normalized = normalizeHostedHistory(entry);
    this.history.unshift(normalized);
    this.saveHistory();
    this.emit('state', this.getState());
    return normalized;
  }

  pruneTokens() {
    const now = this.now();
    for (const [token, value] of this.tokens) if (value.expiresAt <= now) this.tokens.delete(token);
  }

  issueToken(provider, server) {
    this.pruneTokens();
    const token = actionToken();
    const ttl = this.configStore.getHostedControlConfig().settings.actionTokenMinutes * 60 * 1000;
    this.tokens.set(token, {
      providerId: provider.id,
      identifier: server.identifier,
      serverName: server.name,
      expiresAt: this.now() + ttl
    });
    return token;
  }

  providerRuntime(providerId) {
    const value = this.configStore.getHostedProviderRuntime(providerId);
    if (!value?.provider) throw new Error('The selected hosted provider was not found.');
    if (value.provider.enabled === false) throw new Error('The selected hosted provider is disabled.');
    if (!value.token) throw new Error('Save a Pterodactyl Client API key before connecting.');
    return value;
  }

  client(providerId) {
    const runtime = this.providerRuntime(providerId);
    return { ...runtime, client: this.clientFactory(runtime.provider, runtime.token) };
  }

  async refresh(providerIds) {
    this.tokens.clear();
    const config = this.configStore.getHostedControlConfig();
    const filtered = Array.isArray(providerIds);
    const wanted = new Set(filtered ? providerIds : []);
    const providers = config.providers.filter((provider) => provider.enabled !== false && (!filtered || wanted.has(provider.id)));
    const providerSummaries = [];
    const servers = [];
    const errors = [];

    for (const provider of providers) {
      const hasToken = this.configStore.hasHostedProviderToken(provider.id);
      if (!hasToken) {
        providerSummaries.push({ id: provider.id, name: provider.name, type: provider.type, status: 'unconfigured', serverCount: 0 });
        errors.push({ providerId: provider.id, providerName: provider.name, message: 'Client API key is missing.' });
        continue;
      }
      try {
        const { client } = this.client(provider.id);
        const discovered = await client.listServers();
        for (const server of discovered) {
          let resources = null;
          let resourceError = '';
          try { resources = await client.resources(server.identifier); }
          catch (error) { resourceError = String(error.message || error).slice(0, 300); }
          servers.push({
            token: this.issueToken(provider, server),
            providerId: provider.id,
            providerName: provider.name,
            name: server.name,
            description: server.description,
            node: server.node,
            panelStatus: server.status,
            suspended: server.suspended,
            installing: server.installing,
            transferring: server.transferring,
            serverOwner: server.serverOwner,
            limits: server.limits,
            resources,
            resourceError,
            display: resources ? {
              memory: formatBytes(resources.memoryBytes),
              disk: formatBytes(resources.diskBytes),
              networkRx: formatBytes(resources.networkRxBytes),
              networkTx: formatBytes(resources.networkTxBytes),
              uptime: formatUptime(resources.uptimeMs)
            } : null
          });
        }
        providerSummaries.push({ id: provider.id, name: provider.name, type: provider.type, status: 'online', serverCount: discovered.length });
        this.configStore.patchHostedProvider(provider.id, { lastConnectedAt: new Date(this.now()).toISOString(), lastError: '' });
      } catch (error) {
        const message = String(error.message || error).slice(0, 500);
        providerSummaries.push({ id: provider.id, name: provider.name, type: provider.type, status: 'error', serverCount: 0 });
        errors.push({ providerId: provider.id, providerName: provider.name, message });
        this.configStore.patchHostedProvider(provider.id, { lastError: message });
      }
    }

    this.snapshot = {
      refreshedAt: new Date(this.now()).toISOString(),
      providers: providerSummaries,
      servers,
      errors
    };
    this.emit('state', this.getState());
    return this.getState();
  }

  getState() {
    return {
      config: this.configStore.getHostedControlPublicConfig(),
      snapshot: JSON.parse(JSON.stringify(this.snapshot)),
      history: this.history.slice(0, this.configStore.getHostedControlConfig().settings.historyLimit)
    };
  }

  resolveToken(token) {
    this.pruneTokens();
    const value = this.tokens.get(String(token || ''));
    if (!value) throw new Error('This hosted-server entry expired. Refresh the provider and try again.');
    return value;
  }

  async power({ token, signal: signalInput, actor = {} } = {}) {
    const signal = normalizePowerSignal(signalInput);
    const target = this.resolveToken(token);
    const { provider, client } = this.client(target.providerId);
    try {
      await client.power(target.identifier, signal);
      this.tokens.delete(token);
      return this.record({
        id: `hosted-action-${crypto.randomUUID()}`,
        providerId: provider.id,
        providerName: provider.name,
        serverName: target.serverName,
        signal,
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        time: new Date(this.now()).toISOString(),
        outcome: 'success',
        message: `${signal} signal accepted by the Pterodactyl Client API.`
      });
    } catch (error) {
      this.record({
        id: `hosted-action-${crypto.randomUUID()}`,
        providerId: provider.id,
        providerName: provider.name,
        serverName: target.serverName,
        signal,
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        time: new Date(this.now()).toISOString(),
        outcome: 'failed',
        message: String(error.message || error).slice(0, 500)
      });
      throw error;
    }
  }

  async testProvider(providerId) {
    const { provider, client } = this.client(providerId);
    const servers = await client.listServers();
    this.configStore.patchHostedProvider(provider.id, { lastConnectedAt: new Date(this.now()).toISOString(), lastError: '' });
    return { connected: true, providerId: provider.id, serverCount: servers.length };
  }

  clearHistory() {
    this.history = [];
    this.saveHistory();
    this.emit('state', this.getState());
    return [];
  }
}

module.exports = { HostedServerService };
