'use strict';

const NITRADO_API_BASE = 'https://api.nitrado.net';
const ONLINE_STATES = new Set(['started', 'running', 'online']);
const MAINTENANCE_STATES = new Set(['starting', 'restarting', 'stopping', 'installing', 'updating', 'maintenance']);

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
    lastCheckedAt: new Date().toISOString(),
    statusMessage: rawState ? `Nitrado reports ${clean(rawState, 80)}.` : 'Nitrado responded without a recognizable server state.'
  };
}

class HostedServerStatusService {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.baseUrl = String(options.baseUrl || NITRADO_API_BASE).replace(/\/$/, '');
    this.timeoutMs = Math.max(1000, Number(options.timeoutMs || 10000));
  }

  async nitradoStatus(server = {}) {
    if (server.moduleId !== 'palworld' || server.providerType !== 'nitrado-palworld') return null;
    const serviceId = clean(server.providerRef, 80);
    const token = server.credentialEnv ? String(process.env[server.credentialEnv] || '').trim() : '';
    if (!serviceId) return { providerConnected: false, trackingState: 'not-configured', lastCheckedAt: new Date().toISOString(), statusMessage: 'Nitrado service ID is not configured.' };
    if (!token) return { providerConnected: false, trackingState: 'not-configured', lastCheckedAt: new Date().toISOString(), statusMessage: 'Nitrado API credential is not configured.' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/services/${encodeURIComponent(serviceId)}/gameservers`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: controller.signal
      });
      if (!response.ok) {
        return { providerConnected: false, trackingState: 'offline', lastCheckedAt: new Date().toISOString(), statusMessage: `Nitrado status request returned HTTP ${response.status}.` };
      }
      return statusFromNitradoPayload(await response.json());
    } catch (error) {
      const timedOut = error?.name === 'AbortError';
      return { providerConnected: false, trackingState: 'offline', lastCheckedAt: new Date().toISOString(), statusMessage: timedOut ? 'Nitrado status request timed out.' : 'Nitrado status request failed.' };
    } finally {
      clearTimeout(timer);
    }
  }

  async probe(server = {}) {
    if (server.providerType === 'nitrado-palworld') return this.nitradoStatus(server);
    if (server.providerType === 'oncehuman-basic') return {
      providerConnected: false, trackingState: 'manual', lastCheckedAt: new Date().toISOString(),
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

module.exports = { NITRADO_API_BASE, normalizeState, gameserverFromPayload, statusFromNitradoPayload, HostedServerStatusService };
