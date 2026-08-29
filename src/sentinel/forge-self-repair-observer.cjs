'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ForgeClient } = require('./forge-client.cjs');

const STATE_VERSION = 1;
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 30 * 1000;
const DEFAULT_MAX_INCIDENTS = 50;

function envBoolean(value, fallback = false) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  return fallback;
}

function clampIntervalMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(60_000, Math.min(parsed, 60 * 60 * 1000));
}

function defaultStateFile() {
  const root = String(process.env.NEXUS_DATA_DIR || '').trim() || '/app/data';
  return path.join(root, 'forge-self-repair-observer.json');
}

function safeText(value, max = 300) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function sanitizeCheckRun(item = {}) {
  return {
    name: safeText(item.name || 'unnamed check', 160),
    status: safeText(item.status || 'unknown', 40),
    conclusion: safeText(item.conclusion || 'unknown', 40)
  };
}

function failedCheckRuns(ci = {}) {
  const bad = new Set(['failure', 'cancelled', 'timed_out', 'action_required', 'stale', 'startup_failure']);
  return (Array.isArray(ci.checkRuns) ? ci.checkRuns : [])
    .filter((item) => bad.has(String(item?.conclusion || '').toLowerCase()))
    .map(sanitizeCheckRun)
    .slice(0, 20);
}

function isCiFailure(ci = {}) {
  const state = String(ci.state || '').toLowerCase();
  const combined = String(ci.combinedStatus || '').toLowerCase();
  return state === 'failure' || combined === 'failure' || failedCheckRuns(ci).length > 0;
}

function stableIncidentId(type, fingerprint = {}) {
  const digest = crypto.createHash('sha256')
    .update(`${String(type)}:${JSON.stringify(fingerprint)}`)
    .digest('hex')
    .slice(0, 16);
  return `SRI-${digest.toUpperCase()}`;
}

function repairCandidateForIncident(incident) {
  const type = String(incident.type || 'unknown');
  const evidence = incident.evidence || {};
  const common = {
    prepared: true,
    observationOnly: true,
    aiInvoked: false,
    automaticExecutionAllowed: false,
    requiresStaffConfirmation: true
  };

  if (type === 'ci-failure') {
    const ref = safeText(evidence.ref, 240);
    const sha = safeText(evidence.sha, 80);
    const failed = Array.isArray(evidence.failedChecks) ? evidence.failedChecks : [];
    const names = failed.map((item) => safeText(item.name, 120)).filter(Boolean);
    const detail = names.length ? ` Failed checks: ${names.join(', ')}.` : '';
    const goal = `Inspect the failing CI/check evidence on ${ref || 'the configured Nexus base ref'}${sha ? ` at ${sha}` : ''}.${detail} Diagnose the smallest safe code or configuration repair, preserve Nexus security/provider-neutral boundaries, run relevant tests, and leave the result on a guarded forge/* branch with a draft PR. Do not merge or deploy production.`;
    if (ref.startsWith('forge/')) {
      return { ...common, action: 'repair', branch: ref, goal };
    }
    return { ...common, action: 'build', baseRef: ref || null, goal };
  }

  if (type === 'nexus-backend-unhealthy') {
    return {
      ...common,
      action: 'build',
      goal: `Investigate the Nexus Backend health failure observed by Sentinel. Evidence: ${safeText(evidence.error || evidence.state || 'health endpoint reported unhealthy', 300)}. Find the smallest safe repair, add or update regression tests, and leave changes on a guarded forge/* branch with a draft PR. Do not merge or deploy production.`
    };
  }

  if (type === 'sentinel-admin-degraded') {
    return {
      ...common,
      action: 'build',
      goal: `Investigate the degraded Nexus Sentinel admin health surface. Evidence: ${safeText(evidence.error || evidence.state || 'admin health reported degraded', 300)}. Preserve Discord permission and secret-redaction boundaries, add regression coverage, and leave changes on a guarded forge/* branch with a draft PR. Do not merge or deploy production.`
    };
  }

  if (type === 'forge-auth-failure') {
    return {
      ...common,
      action: 'hold',
      requiresForgeRecovery: true,
      goal: `Forge authentication is failing. Verify the Sentinel/Forge shared service-token configuration and bridge policy without exposing the token. After authenticated CI access is restored, inspect whether a code change is required. Do not invoke an AI task while authentication is unavailable.`
    };
  }

  if (type === 'forge-runtime-unavailable' || type === 'forge-ci-probe-failure') {
    return {
      ...common,
      action: 'hold',
      requiresForgeRecovery: true,
      goal: `Forge is unavailable or its protected CI probe cannot complete. Evidence: ${safeText(evidence.error || evidence.state || type, 300)}. Restore Forge reachability first; only then use Forge to inspect whether a repository repair is needed. Do not invoke an AI task while Forge is unavailable.`
    };
  }

  return {
    ...common,
    action: 'hold',
    goal: `Review the observed Nexus incident ${safeText(type, 100)} and determine whether a guarded Forge repair is appropriate. Do not merge or deploy production.`
  };
}

function emptyState() {
  return {
    version: STATE_VERSION,
    mode: 'observe',
    lastRunAt: null,
    lastHealthyAt: null,
    lastSnapshot: null,
    openIncidentIds: [],
    incidents: []
  };
}

function loadState(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || parsed.version !== STATE_VERSION || !Array.isArray(parsed.incidents)) return emptyState();
    return { ...emptyState(), ...parsed, mode: 'observe' };
  } catch {
    return emptyState();
  }
}

function writeState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, filePath);
}

async function fetchJson(fetchImpl, url, timeoutMs = 8_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: controller.signal });
    let payload = null;
    try { payload = await response.json(); } catch {}
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { ok: payload?.ok !== false, payload: payload || {} };
  } catch (error) {
    if (error?.name === 'AbortError') return { ok: false, error: 'request timed out' };
    return { ok: false, error: safeText(error?.message || error, 300) };
  } finally {
    clearTimeout(timer);
  }
}

function summarizeSnapshot(snapshot) {
  return {
    checkedAt: snapshot.checkedAt,
    backend: { ok: Boolean(snapshot.backend?.ok), state: safeText(snapshot.backend?.state || snapshot.backend?.error || '', 160) },
    sentinelAdmin: { ok: Boolean(snapshot.sentinelAdmin?.ok), state: safeText(snapshot.sentinelAdmin?.state || snapshot.sentinelAdmin?.error || '', 160) },
    forge: { ok: Boolean(snapshot.forge?.ok), state: safeText(snapshot.forge?.state || snapshot.forge?.error || '', 160) },
    ci: {
      ok: Boolean(snapshot.ci?.ok),
      state: safeText(snapshot.ci?.state || snapshot.ci?.error || '', 80),
      ref: safeText(snapshot.ci?.ref || '', 240),
      sha: safeText(snapshot.ci?.sha || '', 80),
      failedChecks: Array.isArray(snapshot.ci?.failedChecks) ? snapshot.ci.failedChecks.slice(0, 20) : []
    }
  };
}

class ForgeSelfRepairObserver {
  constructor(options = {}) {
    this.forge = options.forge || new ForgeClient();
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.logger = options.logger || console;
    this.now = options.now || (() => new Date());
    this.stateFile = options.stateFile || process.env.NEXUS_FORGE_SELF_REPAIR_STATE_FILE || defaultStateFile();
    this.intervalMs = clampIntervalMs(options.intervalMs ?? (Number(process.env.NEXUS_FORGE_SELF_REPAIR_INTERVAL_SECONDS || 0) * 1000));
    this.initialDelayMs = Math.max(0, Number(options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS) || DEFAULT_INITIAL_DELAY_MS);
    this.maxIncidents = Math.max(10, Math.min(Number(options.maxIncidents || DEFAULT_MAX_INCIDENTS), 200));
    this.backendUrl = String(options.backendUrl || process.env.NEXUS_BACKEND_URL || 'http://127.0.0.1:3210').replace(/\/+$/, '');
    this.adminHealthUrl = String(options.adminHealthUrl || process.env.NEXUS_SENTINAL_ADMIN_HEALTH_URL || `http://127.0.0.1:${process.env.PORT || 8080}/health`).trim();
    this.enabled = options.enabled ?? envBoolean(process.env.NEXUS_FORGE_SELF_REPAIR_OBSERVER_ENABLED, true);
    this.state = loadState(this.stateFile);
    this.timer = null;
    this.running = false;
  }

  configuration() {
    return {
      enabled: Boolean(this.enabled),
      mode: 'observe',
      intervalMs: this.intervalMs,
      stateFile: this.stateFile,
      automaticExecutionAllowed: false,
      aiInvocationPathPresent: false
    };
  }

  async collectSnapshot() {
    const checkedAt = this.now().toISOString();
    const backend = typeof this.fetchImpl === 'function'
      ? await fetchJson(this.fetchImpl, `${this.backendUrl}/health`)
      : { ok: false, error: 'fetch unavailable' };
    const backendView = backend.ok
      ? { ok: true, state: 'healthy' }
      : { ok: false, state: 'unhealthy', error: backend.error || safeText(backend.payload?.code || 'backend health returned false', 300) };

    const admin = typeof this.fetchImpl === 'function'
      ? await fetchJson(this.fetchImpl, this.adminHealthUrl)
      : { ok: false, error: 'fetch unavailable' };
    const adminPayload = admin.payload || {};
    const adminHealthy = Boolean(admin.ok && adminPayload.discordReady !== false && adminPayload.backendReady !== false);
    const sentinelAdmin = adminHealthy
      ? { ok: true, state: safeText(adminPayload.state || 'ready', 80) }
      : {
          ok: false,
          state: safeText(adminPayload.state || 'degraded', 80),
          error: admin.error || `discordReady=${String(adminPayload.discordReady)} backendReady=${String(adminPayload.backendReady)}`
        };

    const forgeConfig = this.forge.configuration();
    let forge = { ok: false, state: 'skipped', error: '' };
    let ci = { ok: false, state: 'skipped', ref: forgeConfig.defaultBaseRef || '', failedChecks: [] };

    if (!forgeConfig.enabled) {
      forge = { ok: false, state: 'disabled', error: 'Forge integration disabled' };
      ci = { ok: false, state: 'disabled', ref: forgeConfig.defaultBaseRef || '', failedChecks: [] };
    } else if (!forgeConfig.baseUrlConfigured) {
      forge = { ok: false, state: 'not-configured', error: 'Forge base URL missing' };
      ci = { ok: false, state: 'not-configured', ref: forgeConfig.defaultBaseRef || '', failedChecks: [] };
    } else {
      try {
        const health = await this.forge.health();
        forge = { ok: Boolean(health.ok), state: health.ok ? 'healthy' : 'unhealthy', version: safeText(health.version, 80) };
      } catch (error) {
        forge = { ok: false, state: 'unavailable', error: safeText(error?.message || error, 300) };
      }

      if (!forgeConfig.tokenConfigured) {
        ci = { ok: false, state: 'auth-missing', ref: forgeConfig.defaultBaseRef || '', error: 'Forge service token missing', failedChecks: [] };
      } else {
        try {
          const result = await this.forge.ciStatus(forgeConfig.defaultBaseRef);
          const failed = failedCheckRuns(result);
          ci = {
            ok: !isCiFailure(result),
            state: safeText(result.state || 'unknown', 80),
            combinedStatus: safeText(result.combinedStatus || 'unknown', 80),
            ref: safeText(result.ref || forgeConfig.defaultBaseRef || '', 240),
            sha: safeText(result.sha || '', 80),
            failedChecks: failed
          };
        } catch (error) {
          ci = {
            ok: false,
            state: error?.code === 'FORGE_UNAUTHORIZED' ? 'auth-failure' : 'probe-failure',
            ref: forgeConfig.defaultBaseRef || '',
            error: safeText(error?.message || error, 300),
            failedChecks: []
          };
        }
      }
    }

    return { checkedAt, backend: backendView, sentinelAdmin, forge, ci };
  }

  incidentsFromSnapshot(snapshot) {
    const incidents = [];
    const add = (type, fingerprint, evidence) => {
      const incident = {
        id: stableIncidentId(type, fingerprint),
        type,
        evidence
      };
      incident.repairCandidate = repairCandidateForIncident(incident);
      incidents.push(incident);
    };

    if (!snapshot.backend.ok) {
      add('nexus-backend-unhealthy', { service: 'backend' }, { state: snapshot.backend.state, error: snapshot.backend.error || '' });
    }
    if (!snapshot.sentinelAdmin.ok) {
      add('sentinel-admin-degraded', { service: 'sentinel-admin' }, { state: snapshot.sentinelAdmin.state, error: snapshot.sentinelAdmin.error || '' });
    }
    if (!snapshot.forge.ok && !['disabled', 'not-configured'].includes(snapshot.forge.state)) {
      add('forge-runtime-unavailable', { service: 'forge' }, { state: snapshot.forge.state, error: snapshot.forge.error || '' });
    }
    if (snapshot.ci.state === 'auth-failure' || snapshot.ci.state === 'auth-missing') {
      add('forge-auth-failure', { ref: snapshot.ci.ref || 'default' }, { state: snapshot.ci.state, ref: snapshot.ci.ref || '', error: snapshot.ci.error || '' });
    } else if (snapshot.ci.state === 'probe-failure') {
      add('forge-ci-probe-failure', { ref: snapshot.ci.ref || 'default' }, { state: snapshot.ci.state, ref: snapshot.ci.ref || '', error: snapshot.ci.error || '' });
    } else if (!snapshot.ci.ok && !['disabled', 'not-configured', 'skipped'].includes(snapshot.ci.state)) {
      add('ci-failure', {
        ref: snapshot.ci.ref || '',
        sha: snapshot.ci.sha || '',
        failed: (snapshot.ci.failedChecks || []).map((item) => item.name).sort()
      }, {
        state: snapshot.ci.state,
        combinedStatus: snapshot.ci.combinedStatus || '',
        ref: snapshot.ci.ref || '',
        sha: snapshot.ci.sha || '',
        failedChecks: snapshot.ci.failedChecks || []
      });
    }

    return incidents;
  }

  reconcile(snapshot, observed) {
    const now = snapshot.checkedAt;
    const previousOpen = new Set(this.state.openIncidentIds || []);
    const currentIds = new Set(observed.map((item) => item.id));
    const byId = new Map((this.state.incidents || []).map((item) => [item.id, item]));
    const opened = [];
    const resolved = [];

    for (const item of observed) {
      const existing = byId.get(item.id);
      if (existing && existing.status === 'open') {
        existing.lastSeenAt = now;
        existing.seenCount = Math.max(1, Number(existing.seenCount) || 1) + 1;
        existing.evidence = item.evidence;
        existing.repairCandidate = item.repairCandidate;
      } else {
        const next = {
          ...item,
          status: 'open',
          firstSeenAt: now,
          lastSeenAt: now,
          resolvedAt: null,
          seenCount: 1
        };
        byId.set(item.id, next);
        opened.push(next);
      }
    }

    for (const id of previousOpen) {
      if (currentIds.has(id)) continue;
      const existing = byId.get(id);
      if (!existing || existing.status !== 'open') continue;
      existing.status = 'resolved';
      existing.resolvedAt = now;
      existing.lastSeenAt = now;
      resolved.push(existing);
    }

    const incidents = [...byId.values()]
      .sort((a, b) => String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')))
      .slice(0, this.maxIncidents);
    this.state = {
      version: STATE_VERSION,
      mode: 'observe',
      lastRunAt: now,
      lastHealthyAt: currentIds.size === 0 ? now : this.state.lastHealthyAt,
      lastSnapshot: summarizeSnapshot(snapshot),
      openIncidentIds: [...currentIds],
      incidents
    };
    writeState(this.stateFile, this.state);
    return { opened, resolved };
  }

  async runOnce(reason = 'periodic') {
    if (!this.enabled) return { ok: true, skipped: true, reason: 'disabled', mode: 'observe', aiInvoked: false };
    if (this.running) return { ok: true, skipped: true, reason: 'already-running', mode: 'observe', aiInvoked: false };
    this.running = true;
    try {
      const snapshot = await this.collectSnapshot();
      const observed = this.incidentsFromSnapshot(snapshot);
      const changes = this.reconcile(snapshot, observed);
      for (const incident of changes.opened) {
        this.logger.warn?.(`[Nexus Sentinal] Self-Repair observe OPEN: id=${incident.id} type=${incident.type} candidate=${incident.repairCandidate?.action || 'hold'} aiInvoked=false`);
      }
      for (const incident of changes.resolved) {
        this.logger.log?.(`[Nexus Sentinal] Self-Repair observe RESOLVED: id=${incident.id} type=${incident.type} aiInvoked=false`);
      }
      if (reason === 'startup' || changes.opened.length || changes.resolved.length) {
        this.logger.log?.(`[Nexus Sentinal] Self-Repair observe pass: reason=${reason} open=${observed.length} opened=${changes.opened.length} resolved=${changes.resolved.length} mode=observe aiInvoked=false`);
      }
      return {
        ok: observed.length === 0,
        skipped: false,
        reason,
        mode: 'observe',
        aiInvoked: false,
        snapshot: summarizeSnapshot(snapshot),
        openIncidents: observed,
        opened: changes.opened,
        resolved: changes.resolved
      };
    } finally {
      this.running = false;
    }
  }

  start() {
    if (!this.enabled || this.timer) return false;
    const first = setTimeout(() => {
      void this.runOnce('startup').catch((error) => this.logger.warn?.(`[Nexus Sentinal] Self-Repair observer startup error: ${safeText(error?.message || error, 300)}`));
      this.timer = setInterval(() => {
        void this.runOnce('periodic').catch((error) => this.logger.warn?.(`[Nexus Sentinal] Self-Repair observer periodic error: ${safeText(error?.message || error, 300)}`));
      }, this.intervalMs);
      this.timer.unref?.();
    }, this.initialDelayMs);
    first.unref?.();
    return true;
  }

  stop() {
    if (!this.timer) return false;
    clearInterval(this.timer);
    this.timer = null;
    return true;
  }

  status() {
    const open = (this.state.incidents || []).filter((item) => item.status === 'open');
    return {
      ...this.configuration(),
      lastRunAt: this.state.lastRunAt,
      lastHealthyAt: this.state.lastHealthyAt,
      openIncidents: open,
      recentIncidents: (this.state.incidents || []).slice(0, 10),
      lastSnapshot: this.state.lastSnapshot
    };
  }
}

module.exports = {
  STATE_VERSION,
  DEFAULT_INTERVAL_MS,
  DEFAULT_INITIAL_DELAY_MS,
  envBoolean,
  clampIntervalMs,
  safeText,
  failedCheckRuns,
  isCiFailure,
  stableIncidentId,
  repairCandidateForIncident,
  emptyState,
  loadState,
  writeState,
  fetchJson,
  summarizeSnapshot,
  ForgeSelfRepairObserver
};
