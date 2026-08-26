'use strict';

const NITRADO_API_BASE = 'https://api.nitrado.net';
const ONLINE_STATES = new Set(['started', 'running', 'online']);
const MAINTENANCE_STATES = new Set(['starting', 'restarting', 'stopping', 'installing', 'updating', 'maintenance']);
const RETRYABLE_HTTP_STATES = new Set([408, 425, 429, 500, 502, 503, 504]);

function clean(value, max = 160) {
  return String(value ?? '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function normalizeState(value) {
  const state = clean(value, 48).toLowerCase();
  if (ONLINE_STATES.has(state)) return 'online';
  if (MAINTENANCE_STATES.has(state)) return 'maintenance';
  if (['stopped', 'offline', 'shutdown'].includes(state)) return 'offline';
  return state || 'unknown';
}
function gameserverFromPayload(payload = {}) {
  return payload?.data?.gameserver || payload?.gameserver || payload?.data || payload || {};
}
function checkedAt() { return new Date().toISOString(); }
function safeFailure(trackingState, statusMessage) {
  return { providerConnected: false, trackingState, lastCheckedAt: checkedAt(), statusMessage };
}
function statusFromNitradoPayload(payload = {}) {
  const server = gameserverFromPayload(payload);
  const rawState = server.status || server.status_code || server.state || server.gameserver_status || '';
  const trackingState = normalizeState(rawState);
  const playerCount = Number(server.player_current ?? server.players_current ?? server.current_players ?? server.players?.current);
  const playerMax = Number(server.player_max ?? server.players_max ?? server.max_players ?? server.players?.max);
  return {
    providerConnected: trackingState === 'online' || trackingState === 'maintenance' || Boolean(rawState),
    trackingState,
    playerCount: Number.isFinite(playerCount) ? playerCount : null,
    playerMax: Number.isFinite(playerMax) ? playerMax : null,
    lastCheckedAt: checkedAt(),
    statusMessage: rawState ? `Nitrado reports ${clean(rawState, 80)}.` : 'Nitrado responded without a recognizable server state.'
  };
}

class HostedServerStatusService {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.baseUrl = String(options.baseUrl || NITRADO_API_BASE).replace(/\/$/, '');
    this.timeoutMs = Math.max(1000, Number(options.timeoutMs || 10000));
    this.maxAttempts = Math.min(5, Math.max(1, Number(options.maxAttempts || 3)));
    this.baseDelayMs = Math.max(0, Number(options.baseDelayMs ?? 250));
    this.circuitFailureThreshold = Math.max(1, Number(options.circuitFailureThreshold || 3));
    this.circuitOpenMs = Math.max(1000, Number(options.circuitOpenMs || 60000));
    this.now = options.now || (() => Date.now());
    this.sleepImpl = options.sleepImpl || ((ms) => new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
    }));
    this.circuits = new Map();
  }

  circuitFor(serviceId) {
    if (!this.circuits.has(serviceId)) this.circuits.set(serviceId, { failures: 0, openUntil: 0 });
    return this.circuits.get(serviceId);
  }

  circuitOpen(serviceId) {
    const state = this.circuitFor(serviceId);
    if (state.openUntil > this.now()) return true;
    if (state.openUntil) {
      state.openUntil = 0;
      state.failures = 0;
    }
    return false;
  }

  recordSuccess(serviceId) {
    this.circuits.set(serviceId, { failures: 0, openUntil: 0 });
  }

  recordTransientFailure(serviceId) {
    const state = this.circuitFor(serviceId);
    state.failures += 1;
    if (state.failures >= this.circuitFailureThreshold) state.openUntil = this.now() + this.circuitOpenMs;
  }

  async requestNitrado(serviceId, token) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();
    try {
      return await this.fetchImpl(`${this.baseUrl}/services/${encodeURIComponent(serviceId)}/gameservers`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async nitradoStatus(server = {}) {
    if (server.moduleId !== 'palworld' || server.providerType !== 'nitrado-palworld') return null;
    const serviceId = clean(server.providerRef, 80);
    const token = server.credentialEnv ? String(process.env[server.credentialEnv] || '').trim() : '';
    if (!serviceId) return safeFailure('not-configured', 'Nitrado service ID is not configured.');
    if (!token) return safeFailure('not-configured', 'Nitrado API credential is not configured.');
    if (this.circuitOpen(serviceId)) return safeFailure('offline', 'Nitrado status checks are temporarily paused after repeated provider failures.');

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await this.requestNitrado(serviceId, token);
        if (response.ok) {
          this.recordSuccess(serviceId);
          return statusFromNitradoPayload(await response.json());
        }

        const status = Number(response.status || 0);
        const retryable = RETRYABLE_HTTP_STATES.has(status);
        if (!retryable) {
          this.recordSuccess(serviceId);
          if (status === 401 || status === 403) return safeFailure('not-configured', 'Nitrado rejected the configured API credential.');
          if (status === 404) return safeFailure('not-configured', 'Nitrado could not find the configured service ID.');
          return safeFailure('offline', `Nitrado status request returned HTTP ${status || 'error'}.`);
        }

        this.recordTransientFailure(serviceId);
        if (this.circuitOpen(serviceId)) return safeFailure('offline', 'Nitrado status checks are temporarily paused after repeated provider failures.');
        if (attempt < this.maxAttempts) await this.sleepImpl(this.baseDelayMs * (2 ** (attempt - 1)));
        else return safeFailure('offline', `Nitrado status request returned HTTP ${status || 'error'} after ${attempt} attempts.`);
      } catch (error) {
        const timedOut = error?.name === 'AbortError';
        this.recordTransientFailure(serviceId);
        if (this.circuitOpen(serviceId)) return safeFailure('offline', 'Nitrado status checks are temporarily paused after repeated provider failures.');
        if (attempt < this.maxAttempts) {
          await this.sleepImpl(this.baseDelayMs * (2 ** (attempt - 1)));
          continue;
        }
        return safeFailure('offline', timedOut ? `Nitrado status request timed out after ${attempt} attempts.` : `Nitrado status request failed after ${attempt} attempts.`);
      }
    }
    return safeFailure('offline', 'Nitrado status request failed.');
  }

  async probe(server = {}) {
    if (server.providerType === 'nitrado-palworld') return this.nitradoStatus(server);
    if (server.providerType === 'oncehuman-basic') return {
      providerConnected: false, trackingState: 'manual', lastCheckedAt: checkedAt(),
      statusMessage: 'NetEase Custom Server management remains manual; no supported public management API is configured.'
    };
    return null;
  }

  async refresh(store, id = '') {
    const servers = id ? [store.get(id, { includePrivate: true })].filter(Boolean) : store.list({ includePrivate: true });
    const results = [];
    for (const server of servers) {
      const status = await this.probe(server);
      if (!status) { results.push({ id: server.id, skipped: true, reason: 'provider-not-supported' }); continue; }
      const updated = store.updateRuntime(server.id, status);
      results.push({ id: server.id, ok: true, server: updated });
    }
    return results;
  }
}

module.exports = {
  NITRADO_API_BASE,
  RETRYABLE_HTTP_STATES,
  normalizeState,
  gameserverFromPayload,
  statusFromNitradoPayload,
  HostedServerStatusService
};
