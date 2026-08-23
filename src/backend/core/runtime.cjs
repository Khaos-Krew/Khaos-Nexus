'use strict';

const { getModule, MODULES, publicManifest } = require('../modules/catalog.cjs');

const ROLE_RANK = { viewer: 1, operator: 2, owner: 3 };

class BackendRuntime {
  constructor({ config, providers = {}, services = {} }) {
    this.config = config;
    this.providers = { ...providers };
    this.services = { ...services };
    this.startedAt = Date.now();
  }

  capabilityAvailable(module, capability, provider) {
    if (capability.service) {
      const service = this.services[capability.service];
      return Boolean(service && typeof service.invoke === 'function');
    }
    if (!provider) return false;
    return !Array.isArray(provider.supportedActions) || provider.supportedActions.includes(capability.id);
  }

  manifests() {
    return MODULES.map((module) => {
      const provider = this.providers[module.id];
      const providerCapabilityIds = module.capabilities.filter((capability) => !capability.service).map((capability) => capability.id);
      const serviceCapabilityIds = module.capabilities.filter((capability) => capability.service).map((capability) => capability.id);
      const availableActions = module.capabilities
        .filter((capability) => this.capabilityAvailable(module, capability, provider))
        .map((capability) => capability.id);
      const providerAvailableActions = availableActions.filter((id) => providerCapabilityIds.includes(id));
      const serviceAvailableActions = availableActions.filter((id) => serviceCapabilityIds.includes(id));
      return {
        ...publicManifest(module),
        enabled: this.config.modules?.[module.id]?.enabled !== false,
        configured: Boolean(provider),
        connected: provider?.connected === true,
        providerKind: provider?.providerKind || (provider ? 'provider' : 'none'),
        availableActions,
        providerAvailableActions,
        serviceAvailableActions
      };
    });
  }

  health() {
    return {
      ok: true,
      version: '0.1.0',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      services: Object.keys(this.services).filter((name) => typeof this.services[name]?.invoke === 'function'),
      modules: this.manifests().map(({ id, enabled, configured, connected, providerKind, availableActions, providerAvailableActions, serviceAvailableActions }) => ({
        id, enabled, configured, connected, providerKind, availableActions, providerAvailableActions, serviceAvailableActions
      }))
    };
  }

  registerProvider(moduleId, provider) {
    if (!getModule(moduleId)) throw new Error(`Unknown module: ${moduleId}`);
    this.providers[moduleId] = provider;
  }

  registerService(name, service) {
    if (!name || !service || typeof service.invoke !== 'function') throw new Error('Backend service must expose invoke().');
    this.services[name] = service;
  }

  async invoke(moduleId, actionId, payload = {}, context = {}) {
    const module = getModule(moduleId);
    if (!module) return { ok: false, code: 'MODULE_UNKNOWN', message: 'Unknown game module.' };
    if (this.config.modules?.[moduleId]?.enabled === false) return { ok: false, code: 'MODULE_DISABLED', message: `${module.name} is disabled.` };
    const capability = module.capabilities.find((cap) => cap.id === actionId);
    if (!capability) return { ok: false, code: 'CAPABILITY_UNKNOWN', message: `${module.name} does not expose ${actionId}.` };
    const role = context.role || 'viewer';
    if ((ROLE_RANK[role] || 0) < (ROLE_RANK[capability.requiredRole] || 0)) return { ok: false, code: 'ACCESS_DENIED', message: `${capability.label} requires ${capability.requiredRole} access.` };
    if (capability.destructive && context.confirmed !== true) {
      return { ok: false, code: 'CONFIRMATION_REQUIRED', message: `${capability.label} requires explicit confirmation.`, moduleId, actionId };
    }

    if (capability.service) {
      const service = this.services[capability.service];
      if (!service || typeof service.invoke !== 'function') {
        return { ok: false, code: 'CAPABILITY_UNAVAILABLE', message: `${capability.label} is not available because the ${capability.service} service is offline.`, moduleId, actionId };
      }
      try {
        const data = await service.invoke(moduleId, actionId, payload, { ...context, capability, module });
        return { ok: true, moduleId, actionId, data };
      } catch (error) {
        return { ok: false, code: 'PROVIDER_ERROR', message: String(error?.message || error || 'Backend service request failed.'), moduleId, actionId };
      }
    }

    const provider = this.providers[moduleId];
    if (!provider || typeof provider.invoke !== 'function') {
      return { ok: false, code: 'PROVIDER_NOT_CONFIGURED', message: `${module.name} is not available from Nexus Backend yet.`, moduleId, actionId };
    }
    if (Array.isArray(provider.supportedActions) && !provider.supportedActions.includes(actionId)) {
      return { ok: false, code: 'CAPABILITY_UNAVAILABLE', message: `${capability.label} is not available on this ${module.name} connection yet.`, moduleId, actionId };
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
