'use strict';

const { getModule } = require('../modules/catalog.cjs');

const DEFAULT_PROBES = Object.freeze({
  ark: 'status',
  palworld: 'status',
  minecraft: 'status',
  warframe: 'news',
  division2: 'news',
  rust: 'status',
  satisfactory: 'status',
  idleon: 'profile',
  dnd: 'campaigns'
});

function cleanMessage(value, max = 240) {
  return String(value ?? '').replace(/[\r\n\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

class ProviderValidator {
  constructor({ runtime, now = () => Date.now(), probes = DEFAULT_PROBES } = {}) {
    if (!runtime || typeof runtime.invoke !== 'function' || typeof runtime.manifests !== 'function') throw new Error('ProviderValidator requires a Nexus Backend runtime.');
    this.runtime = runtime;
    this.now = now;
    this.probes = { ...probes };
  }

  async validateOne(moduleId) {
    const started = this.now();
    const module = getModule(moduleId);
    if (!module) return { moduleId, ok: false, code: 'MODULE_UNKNOWN', latencyMs: 0, message: 'Unknown game module.' };
    const manifest = this.runtime.manifests().find((item) => item.id === moduleId);
    if (!manifest?.enabled) return { moduleId, name: module.name, ok: false, skipped: true, code: 'MODULE_DISABLED', latencyMs: 0, message: 'Module is disabled.' };
    if (!manifest?.configured) return { moduleId, name: module.name, ok: false, skipped: true, code: 'PROVIDER_NOT_CONFIGURED', latencyMs: 0, message: 'Provider is not configured.' };

    const actionId = this.probes[moduleId];
    if (!actionId) return { moduleId, name: module.name, ok: false, skipped: true, code: 'NO_SAFE_PROBE', latencyMs: 0, message: 'No read-only live probe is defined.' };
    const capability = module.capabilities.find((item) => item.id === actionId);
    if (!capability || capability.destructive || capability.requiredRole !== 'viewer') {
      return { moduleId, name: module.name, ok: false, skipped: true, code: 'UNSAFE_PROBE', latencyMs: 0, message: 'Configured validation probe is not read-only viewer access.' };
    }
    if (!(manifest.availableActions || []).includes(actionId)) {
      return { moduleId, name: module.name, ok: false, skipped: true, code: 'PROBE_UNAVAILABLE', actionId, latencyMs: 0, message: 'The configured provider does not expose the safe validation action.' };
    }

    const result = await this.runtime.invoke(moduleId, actionId, {}, { role: 'viewer', actorId: 'provider-validator', confirmed: false });
    const latencyMs = Math.max(0, this.now() - started);
    return {
      moduleId,
      name: module.name,
      providerKind: manifest.providerKind,
      actionId,
      ok: result.ok === true,
      skipped: false,
      code: result.ok ? 'LIVE_VALIDATED' : result.code || 'PROVIDER_ERROR',
      latencyMs,
      message: result.ok ? 'Read-only provider probe completed successfully.' : cleanMessage(result.message || 'Provider probe failed.')
    };
  }

  async validate(moduleId = '') {
    const requested = String(moduleId || '').trim().toLowerCase();
    const ids = requested ? [requested] : this.runtime.manifests().filter((item) => item.enabled).map((item) => item.id);
    const results = [];
    for (const id of ids) results.push(await this.validateOne(id));
    const passed = results.filter((item) => item.ok).length;
    const skipped = results.filter((item) => item.skipped).length;
    return {
      ok: results.length > 0 && results.every((item) => item.ok || item.skipped),
      generatedAt: new Date(this.now()).toISOString(),
      summary: { total: results.length, passed, failed: results.length - passed - skipped, skipped },
      results
    };
  }
}

module.exports = { DEFAULT_PROBES, ProviderValidator, cleanMessage };
