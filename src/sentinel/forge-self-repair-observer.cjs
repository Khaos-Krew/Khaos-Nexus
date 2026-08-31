'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ForgeClient } = require('./forge-client.cjs');
const {
  clampSnoozeMinutes,
  evaluateIncidentPolicy,
  normalizeSelfRepairPolicy,
  publicPolicyView,
  riskForCandidate,
  safeIncidentId,
  severityForIncident
} = require('./forge-self-repair-policy.cjs');
const { collectLocalRuntimeDiagnostics } = require('./forge-self-repair-runtime.cjs');
const { collectArkSelfRepairDiagnostics } = require('./forge-self-repair-ark-diagnostics.cjs');

const STATE_VERSION = 2;
const AUDIT_VERSION = 1;
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 30 * 1000;
const DEFAULT_MAX_INCIDENTS = 100;

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

function defaultDataRoot() {
  return String(process.env.NEXUS_DATA_DIR || '').trim() || '/app/data';
}

function defaultStateFile() {
  return path.join(defaultDataRoot(), 'forge-self-repair-observer.json');
}

function defaultAuditFile() {
  return path.join(defaultDataRoot(), 'forge-self-repair-audit.ndjson');
}

function safeText(value, max = 300) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
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
      goal: 'Forge authentication is failing. Verify the Sentinel/Forge shared service-token configuration and bridge policy without exposing the token. After authenticated CI access is restored, inspect whether a code change is required. Do not invoke an AI task while authentication is unavailable.'
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

  if (type === 'sentinel-runtime-memory-pressure') {
    return {
      ...common,
      action: 'hold',
      goal: `Sentinel RSS memory crossed the configured Self-Repair warning threshold. Observed RSS: ${safeText(evidence.rssMb, 40)} MB; threshold: ${safeText(evidence.rssWarnMb, 40)} MB. Treat this as a capacity/runtime investigation first. Do not change code automatically, restart Sentinel, or invoke an AI task from the observer.`
    };
  }

  if (type === 'self-repair-state-store-degraded') {
    return {
      ...common,
      action: 'hold',
      goal: `Self-Repair cannot reliably use its persistent state directory. Evidence: ${safeText(evidence.error || evidence.state || 'state store unavailable', 300)}. Restore persistent storage/write access before any automated repair capability is considered.`
    };
  }

  if (type === 'ark-rcon-unavailable') {
    return {
      ...common,
      action: 'hold',
      goal: `ARK RCON is unavailable to Sentinel. Evidence: ${safeText(evidence.error || evidence.state || 'RCON probe failed', 300)}. Check game-server availability, RCON port/authentication, and host networking. Do not restart ARK automatically.`
    };
  }

  if (type === 'arkshop-database-unavailable') {
    return {
      ...common,
      action: 'hold',
      goal: `ArkShop database health is degraded. Evidence: ${safeText(evidence.error || evidence.state || 'database probe failed', 300)}. Check the configured ArkShop database backend and connectivity before deciding whether code repair is needed. Do not restart ARK automatically.`
    };
  }

  if (type === 'ark-sftp-degraded') {
    return {
      ...common,
      action: 'hold',
      goal: `ARK SFTP/config reachability is degraded. Evidence: ${safeText(evidence.error || evidence.state || 'SFTP/config probe failed', 300)}. Check provider-neutral SFTP credentials, paths, and host reachability. Do not write configuration or restart ARK automatically.`
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

function normalizeStoredIncident(incident = {}) {
  const candidate = incident.repairCandidate || repairCandidateForIncident(incident);
  return {
    ...incident,
    status: incident.status === 'resolved' ? 'resolved' : 'open',
    seenCount: Math.max(1, Number(incident.seenCount) || 1),
    occurrenceCount: Math.max(1, Number(incident.occurrenceCount) || 1),
    acknowledgedAt: incident.acknowledgedAt || null,
    acknowledgedBy: incident.acknowledgedBy || null,
    acknowledgementNote: incident.acknowledgementNote || null,
    snoozedUntil: incident.snoozedUntil || null,
    snoozedBy: incident.snoozedBy || null,
    verification: incident.verification || null,
    repairCandidate: candidate,
    severity: severityForIncident(incident.type),
    risk: riskForCandidate(candidate)
  };
}

function migrateState(parsed) {
  if (!parsed || !Array.isArray(parsed.incidents)) return emptyState();
  if (![1, STATE_VERSION].includes(Number(parsed.version))) return emptyState();
  const incidents = parsed.incidents.map(normalizeStoredIncident);
  const openIncidentIds = incidents.filter((item) => item.status === 'open').map((item) => item.id);
  return {
    ...emptyState(),
    ...parsed,
    version: STATE_VERSION,
    mode: 'observe',
    incidents,
    openIncidentIds
  };
}

function loadState(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return migrateState(parsed);
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

function appendAuditEvent(filePath, event = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const record = {
    version: AUDIT_VERSION,
    at: event.at || new Date().toISOString(),
    event: safeText(event.event || 'unknown', 80),
    incidentId: safeText(event.incidentId || '', 40) || null,
    incidentType: safeText(event.incidentType || '', 100) || null,
    actorId: safeText(event.actorId || '', 80) || null,
    detail: safeText(event.detail || '', 500) || null
  };
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
  return record;
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
  const runtime = snapshot.runtime || {};
  const ark = snapshot.ark || {};
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
    },
    runtime: {
      ok: Boolean(runtime.ok),
      state: safeText(runtime.state || '', 80),
      process: runtime.process ? {
        ok: Boolean(runtime.process.ok),
        state: safeText(runtime.process.state || '', 80),
        uptimeSeconds: Math.max(0, Number(runtime.process.uptimeSeconds) || 0),
        memory: cloneJson(runtime.process.memory || {})
      } : null,
      persistence: runtime.persistence ? {
        ok: Boolean(runtime.persistence.ok),
        state: safeText(runtime.persistence.state || '', 80),
        directory: safeText(runtime.persistence.directory || '', 260)
      } : null
    },
    ark: {
      enabled: Boolean(ark.enabled),
      ok: ark.enabled ? Boolean(ark.ok) : true,
      state: safeText(ark.state || 'disabled', 80),
      rcon: ark.rcon ? { enabled: Boolean(ark.rcon.enabled), ok: Boolean(ark.rcon.ok), state: safeText(ark.rcon.state || '', 80) } : null,
      database: ark.database ? { enabled: Boolean(ark.database.enabled), ok: Boolean(ark.database.ok), state: safeText(ark.database.state || '', 80), backend: safeText(ark.database.backend || '', 40) } : null,
      sftp: ark.sftp ? { enabled: Boolean(ark.sftp.enabled), ok: Boolean(ark.sftp.ok), state: safeText(ark.sftp.state || '', 80) } : null
    }
  };
}

class ForgeSelfRepairObserver {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.forge = options.forge || new ForgeClient();
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.logger = options.logger || console;
    this.now = options.now || (() => new Date());
    this.stateFile = options.stateFile || this.env.NEXUS_FORGE_SELF_REPAIR_STATE_FILE || defaultStateFile();
    this.auditFile = options.auditFile || this.env.NEXUS_FORGE_SELF_REPAIR_AUDIT_FILE || path.join(path.dirname(this.stateFile), 'forge-self-repair-audit.ndjson');
    this.intervalMs = clampIntervalMs(options.intervalMs ?? (Number(this.env.NEXUS_FORGE_SELF_REPAIR_INTERVAL_SECONDS || 0) * 1000));
    this.initialDelayMs = Math.max(0, Number(options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS) || DEFAULT_INITIAL_DELAY_MS);
    this.maxIncidents = Math.max(10, Math.min(Number(options.maxIncidents || DEFAULT_MAX_INCIDENTS), 500));
    this.backendUrl = String(options.backendUrl || this.env.NEXUS_BACKEND_URL || 'http://127.0.0.1:3210').replace(/\/+$/, '');
    this.adminHealthUrl = String(options.adminHealthUrl || this.env.NEXUS_SENTINAL_ADMIN_HEALTH_URL || `http://127.0.0.1:${this.env.PORT || 8080}/health`).trim();
    this.enabled = options.enabled ?? envBoolean(this.env.NEXUS_FORGE_SELF_REPAIR_OBSERVER_ENABLED, true);
    this.policy = options.policy || normalizeSelfRepairPolicy(this.env);
    this.arkPrefix = String(options.arkPrefix || this.env.NEXUS_FORGE_SELF_REPAIR_ARK_PREFIX || 'ARK_GEN1').trim() || 'ARK_GEN1';
    this.arkDiagnostics = options.arkDiagnostics || collectArkSelfRepairDiagnostics;
    this.state = loadState(this.stateFile);
    this.timer = null;
    this.initialTimer = null;
    this.running = false;
    this.incidentChangeHandler = typeof options.onIncidentChange === 'function' ? options.onIncidentChange : null;
  }

  configuration() {
    return {
      enabled: Boolean(this.enabled),
      mode: 'observe',
      intervalMs: this.intervalMs,
      stateFile: this.stateFile,
      auditFile: this.auditFile,
      arkPrefix: this.arkPrefix,
      automaticExecutionAllowed: false,
      aiInvocationPathPresent: false,
      policy: publicPolicyView(this.policy)
    };
  }

  setIncidentChangeHandler(handler) {
    this.incidentChangeHandler = typeof handler === 'function' ? handler : null;
    return Boolean(this.incidentChangeHandler);
  }

  audit(event) {
    try {
      return appendAuditEvent(this.auditFile, event);
    } catch (error) {
      this.logger.warn?.(`[Nexus Sentinal] Self-Repair audit write failed: ${safeText(error?.message || error, 300)}`);
      return null;
    }
  }

  async emitIncidentChange(event, incident) {
    if (!this.incidentChangeHandler) return;
    try {
      await this.incidentChangeHandler(event, cloneJson(incident));
    } catch (error) {
      this.logger.warn?.(`[Nexus Sentinal] Self-Repair incident notification hook failed: ${safeText(error?.message || error, 300)}`);
    }
  }

  async collectSnapshot() {
    const checkedAt = this.now().toISOString();
    const runtime = collectLocalRuntimeDiagnostics({ stateFile: this.stateFile, policy: this.policy });
    const ark = await this.arkDiagnostics({ env: this.env, prefix: this.arkPrefix });
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

    return { checkedAt, backend: backendView, sentinelAdmin, forge, ci, runtime, ark };
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
      incident.severity = severityForIncident(type);
      incident.risk = riskForCandidate(incident.repairCandidate);
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

    if (snapshot.runtime?.process && !snapshot.runtime.process.ok) {
      const memory = snapshot.runtime.process.memory || {};
      add('sentinel-runtime-memory-pressure', { threshold: Number(memory.rssWarnMb || 0) }, {
        state: snapshot.runtime.process.state,
        rssMb: Number(memory.rssMb || 0),
        rssWarnMb: Number(memory.rssWarnMb || 0),
        heapUsedMb: Number(memory.heapUsedMb || 0),
        heapTotalMb: Number(memory.heapTotalMb || 0)
      });
    }
    if (snapshot.runtime?.persistence && !snapshot.runtime.persistence.ok) {
      add('self-repair-state-store-degraded', { directory: snapshot.runtime.persistence.directory || 'unknown' }, {
        state: snapshot.runtime.persistence.state,
        directory: snapshot.runtime.persistence.directory || '',
        error: snapshot.runtime.persistence.error || ''
      });
    }

    if (snapshot.ark?.enabled) {
      if (snapshot.ark.rcon?.enabled && !snapshot.ark.rcon.ok) {
        add('ark-rcon-unavailable', { prefix: this.arkPrefix }, {
          state: snapshot.ark.rcon.state,
          error: snapshot.ark.rcon.error || ''
        });
      }
      if (snapshot.ark.database?.enabled && !snapshot.ark.database.ok) {
        add('arkshop-database-unavailable', { prefix: this.arkPrefix, backend: snapshot.ark.database.backend || 'unknown' }, {
          state: snapshot.ark.database.state,
          backend: snapshot.ark.database.backend || '',
          error: snapshot.ark.database.error || ''
        });
      }
      if (snapshot.ark.sftp?.enabled && !snapshot.ark.sftp.ok) {
        add('ark-sftp-degraded', { prefix: this.arkPrefix }, {
          state: snapshot.ark.sftp.state,
          error: snapshot.ark.sftp.error || ''
        });
      }
    }

    return incidents;
  }

  reconcile(snapshot, observed) {
    const now = snapshot.checkedAt;
    const previousOpen = new Set(this.state.openIncidentIds || []);
    const currentIds = new Set(observed.map((item) => item.id));
    const byId = new Map((this.state.incidents || []).map((item) => [item.id, normalizeStoredIncident(item)]));
    const opened = [];
    const resolved = [];

    for (const item of observed) {
      const existing = byId.get(item.id);
      if (existing && existing.status === 'open') {
        existing.lastSeenAt = now;
        existing.seenCount = Math.max(1, Number(existing.seenCount) || 1) + 1;
        existing.evidence = item.evidence;
        existing.repairCandidate = item.repairCandidate;
        existing.severity = item.severity;
        existing.risk = item.risk;
      } else if (existing) {
        existing.status = 'open';
        existing.reopenedAt = now;
        existing.lastSeenAt = now;
        existing.resolvedAt = null;
        existing.seenCount = Math.max(1, Number(existing.seenCount) || 1) + 1;
        existing.occurrenceCount = Math.max(1, Number(existing.occurrenceCount) || 1) + 1;
        existing.evidence = item.evidence;
        existing.repairCandidate = item.repairCandidate;
        existing.severity = item.severity;
        existing.risk = item.risk;
        existing.acknowledgedAt = null;
        existing.acknowledgedBy = null;
        existing.acknowledgementNote = null;
        existing.snoozedUntil = null;
        existing.snoozedBy = null;
        opened.push(existing);
      } else {
        const next = normalizeStoredIncident({
          ...item,
          status: 'open',
          firstSeenAt: now,
          lastSeenAt: now,
          resolvedAt: null,
          seenCount: 1,
          occurrenceCount: 1
        });
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
      existing.snoozedUntil = null;
      existing.snoozedBy = null;
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
        this.logger.warn?.(`[Nexus Sentinal] Self-Repair observe OPEN: id=${incident.id} type=${incident.type} severity=${incident.severity} candidate=${incident.repairCandidate?.action || 'hold'} aiInvoked=false`);
        this.audit({ at: snapshot.checkedAt, event: 'incident-opened', incidentId: incident.id, incidentType: incident.type, detail: `severity=${incident.severity} candidate=${incident.repairCandidate?.action || 'hold'}` });
        await this.emitIncidentChange('opened', incident);
      }
      for (const incident of changes.resolved) {
        this.logger.log?.(`[Nexus Sentinal] Self-Repair observe RESOLVED: id=${incident.id} type=${incident.type} aiInvoked=false`);
        this.audit({ at: snapshot.checkedAt, event: 'incident-resolved', incidentId: incident.id, incidentType: incident.type });
        await this.emitIncidentChange('resolved', incident);
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
    if (!this.enabled || this.timer || this.initialTimer) return false;
    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      void this.runOnce('startup').catch((error) => this.logger.warn?.(`[Nexus Sentinal] Self-Repair observer startup error: ${safeText(error?.message || error, 300)}`));
      this.timer = setInterval(() => {
        void this.runOnce('periodic').catch((error) => this.logger.warn?.(`[Nexus Sentinal] Self-Repair observer periodic error: ${safeText(error?.message || error, 300)}`));
      }, this.intervalMs);
      this.timer.unref?.();
    }, this.initialDelayMs);
    this.initialTimer.unref?.();
    return true;
  }

  stop() {
    let stopped = false;
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
      stopped = true;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      stopped = true;
    }
    return stopped;
  }

  findIncident(id) {
    const normalized = safeIncidentId(id);
    if (!normalized) return null;
    return (this.state.incidents || []).find((item) => item.id === normalized) || null;
  }

  incidentOrThrow(id) {
    const incident = this.findIncident(id);
    if (!incident) {
      const error = new Error('Self-Repair incident was not found');
      error.code = 'SELF_REPAIR_INCIDENT_NOT_FOUND';
      throw error;
    }
    return incident;
  }

  persistControlChange() {
    writeState(this.stateFile, this.state);
  }

  acknowledgeIncident(id, actorId, note = '') {
    const incident = this.incidentOrThrow(id);
    if (incident.status !== 'open') throw Object.assign(new Error('Only an open incident can be acknowledged'), { code: 'SELF_REPAIR_INCIDENT_RESOLVED' });
    const at = this.now().toISOString();
    incident.acknowledgedAt = at;
    incident.acknowledgedBy = safeText(actorId, 80) || 'unknown';
    incident.acknowledgementNote = safeText(note, 300) || null;
    this.persistControlChange();
    this.audit({ at, event: 'incident-acknowledged', incidentId: incident.id, incidentType: incident.type, actorId: incident.acknowledgedBy, detail: incident.acknowledgementNote || '' });
    return cloneJson(incident);
  }

  snoozeIncident(id, minutes, actorId) {
    const incident = this.incidentOrThrow(id);
    if (incident.status !== 'open') throw Object.assign(new Error('Only an open incident can be snoozed'), { code: 'SELF_REPAIR_INCIDENT_RESOLVED' });
    const duration = clampSnoozeMinutes(minutes, this.policy);
    const atDate = this.now();
    const until = new Date(atDate.getTime() + duration * 60 * 1000).toISOString();
    incident.snoozedUntil = until;
    incident.snoozedBy = safeText(actorId, 80) || 'unknown';
    this.persistControlChange();
    this.audit({ at: atDate.toISOString(), event: 'incident-snoozed', incidentId: incident.id, incidentType: incident.type, actorId: incident.snoozedBy, detail: `minutes=${duration} until=${until}` });
    return { incident: cloneJson(incident), minutes: duration, until };
  }

  unsnoozeIncident(id, actorId) {
    const incident = this.incidentOrThrow(id);
    const at = this.now().toISOString();
    incident.snoozedUntil = null;
    incident.snoozedBy = null;
    this.persistControlChange();
    this.audit({ at, event: 'incident-unsnoozed', incidentId: incident.id, incidentType: incident.type, actorId: safeText(actorId, 80) || 'unknown' });
    return cloneJson(incident);
  }

  prepareIncident(id) {
    const incident = this.incidentOrThrow(id);
    const decision = evaluateIncidentPolicy(incident, { policy: this.policy, now: this.now() });
    const candidate = cloneJson(incident.repairCandidate || {});
    let handoff = null;
    if (decision.mayPrepareManualHandoff && candidate.action === 'build') {
      handoff = { command: 'forge build', goal: candidate.goal, baseRef: candidate.baseRef || null };
    } else if (decision.mayPrepareManualHandoff && candidate.action === 'repair') {
      handoff = { command: 'forge repair', branch: candidate.branch || null, goal: candidate.goal };
    }
    return {
      incident: cloneJson(incident),
      decision,
      candidate,
      handoff,
      aiInvoked: false,
      automaticExecutionAllowed: false
    };
  }

  async verifyIncident(id, options = {}) {
    const existing = this.incidentOrThrow(id);
    const actorId = safeText(options.actorId, 80) || 'unknown';
    const run = await this.runOnce('verification');
    let incident = this.incidentOrThrow(existing.id);
    const branch = safeText(options.branch || incident.repairCandidate?.branch || '', 240);
    let branchCi = null;

    if (branch) {
      try {
        const result = await this.forge.ciStatus(branch);
        branchCi = {
          ok: !isCiFailure(result),
          ref: safeText(result.ref || branch, 240),
          sha: safeText(result.sha || '', 80),
          state: safeText(result.state || 'unknown', 80),
          combinedStatus: safeText(result.combinedStatus || 'unknown', 80),
          failedChecks: failedCheckRuns(result)
        };
      } catch (error) {
        branchCi = {
          ok: false,
          ref: branch,
          state: error?.code === 'FORGE_UNAUTHORIZED' ? 'auth-failure' : 'probe-failure',
          error: safeText(error?.message || error, 300),
          failedChecks: []
        };
      }
    }

    incident = this.incidentOrThrow(existing.id);
    const conditionCleared = incident.status === 'resolved';
    const branchHealthy = branchCi ? Boolean(branchCi.ok) : true;
    const passed = Boolean(conditionCleared && branchHealthy);
    const priorPasses = Number(incident.verification?.consecutivePasses || 0);
    const consecutivePasses = passed ? priorPasses + 1 : 0;
    const complete = passed && consecutivePasses >= Number(this.policy.verificationPassesRequired || 1);
    const at = this.now().toISOString();
    incident.verification = {
      checkedAt: at,
      actorId,
      passed,
      complete,
      consecutivePasses,
      requiredPasses: Number(this.policy.verificationPassesRequired || 1),
      conditionCleared,
      branchCi
    };
    this.persistControlChange();
    this.audit({
      at,
      event: 'incident-verified',
      incidentId: incident.id,
      incidentType: incident.type,
      actorId,
      detail: `passed=${passed} complete=${complete} consecutive=${consecutivePasses} branch=${branch || 'none'} aiInvoked=false`
    });
    return {
      ok: complete,
      passed,
      complete,
      run,
      incident: cloneJson(incident),
      branchCi,
      aiInvoked: false
    };
  }

  policyStatus() {
    return publicPolicyView(this.policy);
  }

  status() {
    const decorate = (item) => ({
      ...cloneJson(item),
      policyDecision: evaluateIncidentPolicy(item, { policy: this.policy, now: this.now() })
    });
    const open = (this.state.incidents || []).filter((item) => item.status === 'open').map(decorate);
    return {
      ...this.configuration(),
      lastRunAt: this.state.lastRunAt,
      lastHealthyAt: this.state.lastHealthyAt,
      openIncidents: open,
      recentIncidents: (this.state.incidents || []).slice(0, 20).map(decorate),
      lastSnapshot: cloneJson(this.state.lastSnapshot)
    };
  }
}

module.exports = {
  STATE_VERSION,
  AUDIT_VERSION,
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
  normalizeStoredIncident,
  migrateState,
  loadState,
  writeState,
  appendAuditEvent,
  fetchJson,
  summarizeSnapshot,
  ForgeSelfRepairObserver
};
