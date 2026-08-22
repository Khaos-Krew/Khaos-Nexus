'use strict';

const { getModule, MODULES, publicManifest } = require('../modules/catalog.cjs');

const ROLE_RANK = { viewer: 1, operator: 2, owner: 3 };

class BackendRuntime {
  constructor({ config, providers = {} }) {
    this.config = config;
    this.providers = { ...providers };
    this.startedAt = Date.now();
  }

  manifests() {
    return MODULES.map((module) => ({ ...publicManifest(module), enabled: this.config.modules?.[module.id]?.enabled !== false, configured: Boolean(this.providers[module.id]) }));
  }

  health() {
    return {
      ok: true,
      version: '0.1.0',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      modules: this.manifests().map(({ id, enabled, configured }) => ({ id, enabled, configured }))
    };
  }

  registerProvider(moduleId, provider) {
    if (!getModule(moduleId)) throw new Error(`Unknown module: ${moduleId}`);
    this.providers[moduleId] = provider;
  }

  async invoke(moduleId, actionId, payload = {}, context = {}) {
    const module = getModule(moduleId);
    if (!module) return { ok: false, code: 'MODULE_UNKNOWN', message: 'Unknown game module.' };
    if (this.config.modules?.[moduleId]?.enabled === false) return { ok: false, code: 'MODULE_DISABLED', message: `${module.name} is disabled.` };
    const capability = module.capabilities.find((cap) => cap.id === actionId);
    if (!capability) return { ok: false, code: 'CAPABILITY_UNKNOWN', message: `${module.name} does not expose ${actionId}.` };
    const role = context.role || 'viewer';
    if ((ROLE_RANK[role] || 0) < (ROLE_RANK[capability.requiredRole] || 0)) return { ok: false, code: 'ACCESS_DENIED', message: `${capability.label} requires ${capability.requiredRole} access.` };
    const provider = this.providers[moduleId];
    if (!provider || typeof provider.invoke !== 'function') {
      return { ok: false, code: 'PROVIDER_NOT_CONFIGURED', message: `${module.name} is wired to Nexus Backend, but its provider transport has not been configured yet.`, moduleId, actionId };
    }
    try {
      const data = await provider.invoke(actionId, payload, { ...context, capability, module });
      return { ok: true, moduleId, actionId, data };
    } catch (error) {
      return { ok: false, code: 'PROVIDER_ERROR', message: String(error?.message || error || 'Provider request failed.'), moduleId, actionId };
    }
  }
}

module.exports = { BackendRuntime, ROLE_RANK };
