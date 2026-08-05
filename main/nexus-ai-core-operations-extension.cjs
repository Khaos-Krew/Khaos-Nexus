'use strict';

const { randomUUID } = require('node:crypto');
const electron = require('electron');
const runtimes = require('./bundled-ai-runtimes-extension.cjs');

const REQUEST_TIMEOUT_MS = 15000;
const MAX_HISTORY = 50;
const MAX_SOURCES = 100;
const MIN_INTERVAL_MINUTES = 15;
const MAX_INTERVAL_MINUTES = 1440;
const allowedCapabilities = new Set([
  'nexus.help',
  'nexus.discord.assist',
  'nexus.update.poll',
  'nexus.update.state',
  'nexus.maintenance.propose'
]);
const refs = {
  configStore: null,
  logger: null,
  autonomy: null,
  discordAuth: null,
  supervisor: null,
  scheduler: null
};
let installed = false;
let ipcInstalled = false;
let schedulerPollInFlight = false;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function safeText(value, max = 4000) {
  return String(value ?? '')
    .replace(/@everyone|@here/gi, '@ disabled')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function safeIdentifier(value, max = 100) {
  return String(value ?? '').trim().replace(/[^a-z0-9._:-]/gi, '-').slice(0, max);
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function currentRole() {
  try { return refs.autonomy?.accessState?.(refs.discordAuth?.getState?.())?.role || 'locked'; }
  catch { return 'locked'; }
}

function assertAccess(minimumRole, action) {
  if (refs.autonomy?.assertAccess) return refs.autonomy.assertAccess(refs.discordAuth?.getState?.(), minimumRole, action);
  const rank = { locked: 0, viewer: 1, operator: 2, owner: 3, 'local-admin': 4 };
  if ((rank[currentRole()] || 0) < (rank[minimumRole] || 0)) {
    const error = new Error(`${action} requires ${minimumRole} access.`);
    error.code = 'ACCESS_DENIED';
    throw error;
  }
  return true;
}

function defaultMonitorConfig() {
  return {
    enabled: false,
    intervalMinutes: 60,
    sources: [],
    subscriptions: [],
    lastStartedAt: null,
    lastRunAt: null,
    nextRunAt: null,
    lastOutcome: 'never',
    lastError: '',
    lastSummary: 'No Nexus AI update check has run yet.',
    history: [],
    updatedAt: nowIso()
  };
}

function normalizeChannels(value) {
  const allowed = new Set(['stable', 'beta', 'alpha']);
  const source = Array.isArray(value) && value.length ? value : ['stable'];
  const channels = [...new Set(source.map((item) => String(item || '').toLowerCase()).filter((item) => allowed.has(item)))];
  return channels.length ? channels : ['stable'];
}

function normalizeSource(input = {}, index = 0) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`Monitor source ${index + 1} is invalid.`);
  const provider = String(input.provider || '').trim().toLowerCase();
  if (!['github-release', 'modrinth-project', 'curseforge-mod', 'steam-news'].includes(provider)) {
    throw new Error('Select a supported Nexus AI monitor provider.');
  }
  const id = safeIdentifier(input.id || `${provider}-${randomUUID()}`);
  if (!id) throw new Error('Monitor source ID is required.');
  const base = {
    id,
    provider,
    enabled: input.enabled !== false,
    allowedChannels: normalizeChannels(input.allowedChannels),
    emitInitialEvents: input.emitInitialEvents === true
  };
  if (provider === 'github-release') {
    const owner = safeIdentifier(input.owner, 100);
    const repo = safeIdentifier(input.repo, 100);
    if (!owner || !repo) throw new Error('GitHub monitor sources require owner and repository names.');
    return { ...base, owner, repo };
  }
  if (provider === 'modrinth-project') {
    const project = safeIdentifier(input.project, 100);
    if (!project) throw new Error('Modrinth monitor sources require a project slug or ID.');
    return {
      ...base,
      project,
      gameVersions: Array.isArray(input.gameVersions) ? input.gameVersions.map((item) => safeText(item, 50)).filter(Boolean).slice(0, 20) : [],
      loaders: Array.isArray(input.loaders) ? input.loaders.map((item) => safeText(item, 50)).filter(Boolean).slice(0, 20) : []
    };
  }
  if (provider === 'curseforge-mod') {
    const modId = Number(input.modId);
    if (!Number.isInteger(modId) || modId <= 0) throw new Error('CurseForge monitor sources require a positive numeric mod ID.');
    return { ...base, modId, gameVersion: input.gameVersion ? safeText(input.gameVersion, 50) : null };
  }
  const appId = Number(input.appId);
  if (!Number.isInteger(appId) || appId <= 0) throw new Error('Steam monitor sources require a positive numeric app ID.');
  return {
    ...base,
    appId,
    count: boundedInteger(input.count, 10, 1, 20),
    feeds: Array.isArray(input.feeds) ? input.feeds.map((item) => safeIdentifier(item, 100)).filter(Boolean).slice(0, 10) : [],
    keywords: Array.isArray(input.keywords) ? input.keywords.map((item) => safeText(item, 80).toLowerCase()).filter(Boolean).slice(0, 20) : []
  };
}

function sourceFromTarget(providerInput, targetInput) {
  const provider = String(providerInput || '').trim().toLowerCase();
  const target = safeText(targetInput, 200);
  if (provider === 'github-release') {
    const [owner, repo, extra] = target.split('/');
    if (!owner || !repo || extra) throw new Error('GitHub targets must use owner/repository.');
    return normalizeSource({ id: `github-${owner}-${repo}`, provider, owner, repo });
  }
  if (provider === 'modrinth-project') return normalizeSource({ id: `modrinth-${target}`, provider, project: target });
  if (provider === 'curseforge-mod') return normalizeSource({ id: `curseforge-${target}`, provider, modId: Number(target) });
  if (provider === 'steam-news') return normalizeSource({ id: `steam-${target}`, provider, appId: Number(target) });
  throw new Error('Select GitHub Releases, Modrinth, CurseForge, or Steam News.');
}

function normalizeSubscription(input = {}) {
  const sourceId = safeIdentifier(input.sourceId);
  if (!sourceId) throw new Error('A source ID is required for this subscription.');
  const guildId = safeIdentifier(input.guildId, 40);
  const channelId = safeIdentifier(input.channelId, 40);
  const userId = safeIdentifier(input.userId, 40);
  if (!guildId || !channelId || !userId) throw new Error('Discord subscriptions require a guild, channel, and user.');
  return {
    id: safeIdentifier(input.id || `${guildId}:${channelId}:${userId}:${sourceId}`, 240),
    sourceId,
    guildId,
    channelId,
    userId,
    createdAt: input.createdAt || nowIso()
  };
}

function normalizeMonitorConfig(input = {}) {
  const fallback = defaultMonitorConfig();
  const sources = Array.isArray(input.sources)
    ? input.sources.slice(0, MAX_SOURCES).map((source, index) => normalizeSource(source, index))
    : [];
  const sourceIds = new Set(sources.map((source) => source.id));
  const subscriptions = Array.isArray(input.subscriptions)
    ? input.subscriptions.map(normalizeSubscription).filter((item) => sourceIds.has(item.sourceId)).slice(0, 500)
    : [];
  const history = Array.isArray(input.history) ? input.history.slice(0, MAX_HISTORY).map((entry) => ({
    id: safeIdentifier(entry.id || randomUUID(), 120),
    source: safeText(entry.source || 'unknown', 40),
    startedAt: entry.startedAt || null,
    completedAt: entry.completedAt || null,
    outcome: ['success', 'partial', 'failed', 'skipped'].includes(entry.outcome) ? entry.outcome : 'failed',
    sourceCount: boundedInteger(entry.sourceCount, 0, 0, MAX_SOURCES),
    newEventCount: boundedInteger(entry.newEventCount, 0, 0, 100000),
    failedSourceCount: boundedInteger(entry.failedSourceCount, 0, 0, MAX_SOURCES),
    summary: safeText(entry.summary, 500),
    error: safeText(entry.error, 500)
  })) : [];
  return {
    ...fallback,
    enabled: input.enabled === true,
    intervalMinutes: boundedInteger(input.intervalMinutes, fallback.intervalMinutes, MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES),
    sources,
    subscriptions,
    lastStartedAt: input.lastStartedAt || null,
    lastRunAt: input.lastRunAt || null,
    nextRunAt: input.nextRunAt || null,
    lastOutcome: ['never', 'running', 'success', 'partial', 'failed', 'skipped'].includes(input.lastOutcome) ? input.lastOutcome : 'never',
    lastError: safeText(input.lastError, 500),
    lastSummary: safeText(input.lastSummary || fallback.lastSummary, 500),
    history,
    updatedAt: input.updatedAt || fallback.updatedAt
  };
}

function ensureMonitorConfig(store) {
  store.config ||= {};
  const normalized = normalizeMonitorConfig(store.config.nexusAiMonitor || {});
  const changed = JSON.stringify(store.config.nexusAiMonitor || null) !== JSON.stringify(normalized);
  store.config.nexusAiMonitor = normalized;
  if (changed) store.saveConfig();
  return normalized;
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosNexusAiOperations) return;

  class NexusAiOperationsConfigStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      ensureMonitorConfig(this);
    }

    getNexusAiMonitorConfig() {
      return clone(ensureMonitorConfig(this));
    }

    setNexusAiMonitorSettings(input = {}) {
      const current = ensureMonitorConfig(this);
      const enabled = input.enabled === undefined ? current.enabled : input.enabled === true;
      const intervalMinutes = boundedInteger(input.intervalMinutes, current.intervalMinutes, MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES);
      const nextRunAt = enabled
        ? (current.nextRunAt || nowIso(Date.now() + intervalMinutes * 60 * 1000))
        : null;
      this.config.nexusAiMonitor = normalizeMonitorConfig({
        ...current,
        enabled,
        intervalMinutes,
        nextRunAt,
        updatedAt: nowIso()
      });
      this.saveConfig();
      return this.getNexusAiMonitorConfig();
    }

    upsertNexusAiMonitorSource(input = {}) {
      const current = ensureMonitorConfig(this);
      const source = normalizeSource(input);
      const index = current.sources.findIndex((item) => item.id === source.id);
      if (index >= 0) current.sources[index] = source;
      else current.sources.push(source);
      if (current.sources.length > MAX_SOURCES) throw new Error(`Nexus AI supports at most ${MAX_SOURCES} monitor sources.`);
      current.updatedAt = nowIso();
      this.config.nexusAiMonitor = normalizeMonitorConfig(current);
      this.saveConfig();
      return clone(source);
    }

    removeNexusAiMonitorSource(id) {
      const sourceId = safeIdentifier(id);
      const current = ensureMonitorConfig(this);
      current.sources = current.sources.filter((item) => item.id !== sourceId);
      current.subscriptions = current.subscriptions.filter((item) => item.sourceId !== sourceId);
      current.updatedAt = nowIso();
      this.config.nexusAiMonitor = normalizeMonitorConfig(current);
      this.saveConfig();
      return this.getNexusAiMonitorConfig();
    }

    addNexusAiSubscription(input = {}) {
      const current = ensureMonitorConfig(this);
      const subscription = normalizeSubscription(input);
      if (!current.sources.some((item) => item.id === subscription.sourceId)) throw new Error('The selected Nexus AI source does not exist.');
      const index = current.subscriptions.findIndex((item) => item.id === subscription.id);
      if (index >= 0) current.subscriptions[index] = subscription;
      else current.subscriptions.push(subscription);
      this.config.nexusAiMonitor = normalizeMonitorConfig({ ...current, updatedAt: nowIso() });
      this.saveConfig();
      return clone(subscription);
    }

    removeNexusAiSubscription(input = {}) {
      const current = ensureMonitorConfig(this);
      const sourceId = safeIdentifier(input.sourceId || input);
      const userId = safeIdentifier(input.userId, 40);
      const channelId = safeIdentifier(input.channelId, 40);
      const before = current.subscriptions.length;
      current.subscriptions = current.subscriptions.filter((item) => {
        if (item.sourceId !== sourceId) return true;
        if (userId && item.userId !== userId) return true;
        if (channelId && item.channelId !== channelId) return true;
        return false;
      });
      this.config.nexusAiMonitor = normalizeMonitorConfig({ ...current, updatedAt: nowIso() });
      this.saveConfig();
      return { removed: before - current.subscriptions.length, state: this.getNexusAiMonitorConfig() };
    }

    claimNexusAiMonitorRun({ startedAt, nextRunAt }) {
      const current = ensureMonitorConfig(this);
      this.config.nexusAiMonitor = normalizeMonitorConfig({
        ...current,
        lastStartedAt: startedAt,
        nextRunAt,
        lastOutcome: 'running',
        lastError: '',
        lastSummary: 'Nexus AI update check is running.',
        updatedAt: nowIso()
      });
      this.saveConfig();
      return this.getNexusAiMonitorConfig();
    }

    recordNexusAiMonitorRun(entry = {}) {
      const current = ensureMonitorConfig(this);
      const normalizedEntry = normalizeMonitorConfig({ history: [entry] }).history[0];
      current.history = [normalizedEntry, ...current.history].slice(0, MAX_HISTORY);
      current.lastRunAt = normalizedEntry.completedAt || nowIso();
      current.lastOutcome = normalizedEntry.outcome;
      current.lastError = normalizedEntry.error;
      current.lastSummary = normalizedEntry.summary;
      current.updatedAt = nowIso();
      this.config.nexusAiMonitor = normalizeMonitorConfig(current);
      this.saveConfig();
      return clone(normalizedEntry);
    }

    getPublicConfig() {
      const config = super.getPublicConfig();
      config.nexusAiMonitor = this.getNexusAiMonitorConfig();
      return config;
    }
  }

  Object.defineProperty(NexusAiOperationsConfigStore, '__khaosNexusAiOperations', { value: true });
  target.ConfigStore = NexusAiOperationsConfigStore;
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosNexusAiOperationsCapture) return;
  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
    }
  }
  Object.defineProperty(Captured, '__khaosNexusAiOperationsCapture', { value: true });
  target[exportName] = Captured;
}

function audit(action, outcome, metadata = {}) {
  const safeMetadata = Object.fromEntries(Object.entries(metadata || {}).slice(0, 20).map(([key, value]) => [safeText(key, 80), safeText(value, 500)]));
  try { refs.configStore?.appendAiServiceAudit?.(action, { outcome, ...safeMetadata }); } catch {}
  try {
    const auth = refs.discordAuth?.getState?.() || {};
    refs.configStore?.appendDiscordAudit?.({
      category: 'nexus-ai',
      action,
      outcome,
      targetType: 'nexus-ai-core',
      targetId: safeMetadata.sourceId || '',
      targetName: safeMetadata.action || safeMetadata.source || '',
      summary: safeText(safeMetadata.summary || `${action} ${outcome}.`, 500),
      actorId: safeMetadata.actorId || auth.user?.id || '',
      actorName: safeMetadata.actorName || auth.user?.globalName || auth.user?.username || 'Local operator',
      actorRole: safeMetadata.actorRole || currentRole(),
      time: nowIso()
    });
  } catch {}
  try {
    const level = outcome === 'failed' ? 'warn' : 'info';
    refs.logger?.write?.(level, `Nexus AI ${action}: ${outcome}.`, safeMetadata, 'nexus-ai');
  } catch {}
}

async function request(pathname, { method = 'GET', capability = null, body = null } = {}) {
  const { endpoint, serviceToken } = runtimes.coreConnection();
  if (capability && !allowedCapabilities.has(capability)) throw new Error('Unsupported Nexus AI Core capability.');
  const requestId = method === 'POST' ? randomUUID() : null;
  const payload = method === 'POST' ? {
    ...(body && typeof body === 'object' && !Array.isArray(body) ? body : {}),
    apiVersion: 'v1',
    requestId,
    targetService: 'khaos-nexus',
    routingDepth: 0,
    capability
  } : undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(new URL(pathname, endpoint), {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${serviceToken}`,
        ...(payload ? { 'Content-Type': 'application/json', 'X-Khaos-Request-Id': requestId } : {})
      },
      body: payload ? JSON.stringify(payload) : undefined,
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) throw new Error('Nexus AI Core returned an invalid content type.');
  const data = await response.json();
  if (!response.ok) throw new Error(safeText(data?.error?.message || 'Nexus AI Core request failed.', 500));
  if (requestId && data.requestId !== requestId) throw new Error('Nexus AI Core response identity did not match.');
  return data;
}

async function negotiate() {
  const [health, capabilities, contracts] = await Promise.all([
    request('/health'),
    request('/api/v1/capabilities'),
    request('/api/v1/contracts')
  ]);
  if (health.apiVersion !== 'v1' || capabilities.apiVersion !== 'v1') throw new Error('Nexus AI Core API version is incompatible.');
  if (health.targetService !== 'khaos-nexus' || capabilities.targetService !== 'khaos-nexus') throw new Error('Nexus AI Core target is incompatible.');
  if (capabilities.directExecution !== false || capabilities.directDiscordConnection !== false || capabilities.directServiceForwarding !== false) throw new Error('Nexus AI Core authority contract is unsafe.');
  if ((capabilities.capabilities || []).some((item) => String(item).startsWith('dnd.'))) throw new Error('Nexus AI Core advertised a D&D capability.');
  return {
    ready: true,
    service: health.service,
    version: health.version,
    providerStatus: health.providerStatus,
    monitorAvailable: capabilities.capabilities?.includes('nexus.update.poll') === true,
    contracts: {
      service: contracts.contractVersion || contracts.serviceContractVersion || contracts.contract?.contractVersion || '1.0.0',
      api: health.apiVersion
    }
  };
}

async function status() {
  const runtime = runtimes.status().services.find((item) => item.key === 'core');
  if (!runtime || runtime.status !== 'ready') return { runtime, ready: false };
  try { return { runtime, ...(await negotiate()) }; }
  catch (error) { return { runtime, ready: false, error: safeText(error.message, 500) }; }
}

async function coreMonitorState() {
  const state = await request('/api/v1/monitor/state');
  return state?.state || { sourceCount: 0, sources: [] };
}

function monitorSummary(result = {}) {
  const sourceCount = boundedInteger(result.sourceCount, 0, 0, MAX_SOURCES);
  const newEventCount = boundedInteger(result.newEventCount, 0, 0, 100000);
  const failedSourceCount = boundedInteger(result.failedSourceCount, 0, 0, MAX_SOURCES);
  return `${sourceCount} source${sourceCount === 1 ? '' : 's'} checked; ${newEventCount} new event${newEventCount === 1 ? '' : 's'}; ${failedSourceCount} failed.`;
}

async function checkNow(input = {}) {
  const configured = refs.configStore?.getNexusAiMonitorConfig?.() || defaultMonitorConfig();
  const sources = Array.isArray(input.sources) && input.sources.length
    ? input.sources.slice(0, MAX_SOURCES).map(normalizeSource)
    : configured.sources;
  if (!sources.length) throw new Error('Add at least one Nexus AI monitor source before running a check.');
  return request('/api/v1/monitor/poll', {
    method: 'POST',
    capability: 'nexus.update.poll',
    body: { sources, reason: safeText(input.reason || 'owner-manual-check', 100) }
  });
}

async function ask(input = {}) {
  const prompt = safeText(input.prompt, 4000).trim();
  if (!prompt) throw new Error('A Nexus AI prompt is required.');
  const context = input.context && typeof input.context === 'object' && !Array.isArray(input.context)
    ? Object.fromEntries(Object.entries(input.context).slice(0, 20).map(([key, value]) => [safeText(key, 80), safeText(value, 500)]))
    : {};
  delete context.dnd;
  delete context.campaign;
  delete context.gm;
  return request('/api/v1/discord/assist', {
    method: 'POST',
    capability: 'nexus.discord.assist',
    body: { prompt, context, visibility: 'ephemeral' }
  });
}

async function proposeMaintenance(input = {}) {
  const findings = Array.isArray(input.findings)
    ? input.findings.map((item) => safeText(item, 1000)).filter(Boolean).slice(0, 100)
    : [safeText(input.finding, 1500)].filter(Boolean);
  if (!findings.length) throw new Error('Describe at least one finding for the advisory maintenance plan.');
  return request('/api/v1/maintenance/plans', {
    method: 'POST',
    capability: 'nexus.maintenance.propose',
    body: { findings, executionAllowed: false }
  });
}

async function monitorPublicState({ includeCore = true } = {}) {
  const config = refs.configStore?.getNexusAiMonitorConfig?.() || defaultMonitorConfig();
  let service = null;
  let coreState = null;
  if (includeCore) {
    service = await status();
    if (service.ready) {
      try { coreState = await coreMonitorState(); }
      catch (error) { coreState = { sourceCount: 0, sources: [], error: safeText(error.message, 500) }; }
    }
  }
  return {
    role: currentRole(),
    settings: {
      enabled: config.enabled,
      intervalMinutes: config.intervalMinutes,
      lastStartedAt: config.lastStartedAt,
      lastRunAt: config.lastRunAt,
      nextRunAt: config.nextRunAt,
      lastOutcome: config.lastOutcome,
      lastError: config.lastError,
      lastSummary: config.lastSummary
    },
    sources: clone(config.sources),
    subscriptions: clone(config.subscriptions),
    history: clone(config.history.slice(0, 20)),
    service,
    coreState,
    policy: {
      schedulerAuthority: 'khaos-nexus-shared-scheduler',
      automaticPublicAnnouncements: false,
      maintenanceExecutionAllowed: false,
      dndContextAllowed: false
    }
  };
}

function outcomeFor(result) {
  if (result.failedSourceCount > 0 && result.failedSourceCount >= result.sourceCount) return 'failed';
  if (result.failedSourceCount > 0) return 'partial';
  return 'success';
}

async function runRecordedCheck({ source = 'desktop-manual', actor = {}, reason = 'owner-manual-check' } = {}) {
  const startedAt = nowIso();
  let completedAt;
  try {
    const response = await checkNow({ reason });
    const result = response.monitor || response;
    completedAt = nowIso();
    const entry = refs.configStore.recordNexusAiMonitorRun({
      id: randomUUID(),
      source,
      startedAt,
      completedAt,
      outcome: outcomeFor(result),
      sourceCount: result.sourceCount,
      newEventCount: result.newEventCount,
      failedSourceCount: result.failedSourceCount,
      summary: monitorSummary(result),
      error: result.failedSourceCount ? `${result.failedSourceCount} monitor source${result.failedSourceCount === 1 ? '' : 's'} failed.` : ''
    });
    audit('monitor.check', entry.outcome, {
      actorId: actor.userId,
      actorName: actor.username,
      actorRole: actor.role,
      source,
      summary: entry.summary
    });
    broadcastMonitor();
    return { response, entry, state: await monitorPublicState({ includeCore: false }) };
  } catch (error) {
    completedAt = nowIso();
    const entry = refs.configStore?.recordNexusAiMonitorRun?.({
      id: randomUUID(),
      source,
      startedAt,
      completedAt,
      outcome: 'failed',
      sourceCount: refs.configStore?.getNexusAiMonitorConfig?.().sources.length || 0,
      newEventCount: 0,
      failedSourceCount: refs.configStore?.getNexusAiMonitorConfig?.().sources.length || 0,
      summary: 'Nexus AI update check failed.',
      error: safeText(error.message, 500)
    });
    audit('monitor.check', 'failed', {
      actorId: actor.userId,
      actorName: actor.username,
      actorRole: actor.role,
      source,
      summary: safeText(error.message, 500)
    });
    broadcastMonitor();
    error.monitorEntry = entry;
    throw error;
  }
}

async function runScheduledMonitorTick({ now = Date.now() } = {}) {
  if (schedulerPollInFlight || !refs.configStore?.getNexusAiMonitorConfig) return { skipped: true, reason: 'unavailable-or-running' };
  const config = refs.configStore.getNexusAiMonitorConfig();
  if (!config.enabled || !config.sources.length) return { skipped: true, reason: !config.enabled ? 'disabled' : 'no-sources' };
  const intervalMs = config.intervalMinutes * 60 * 1000;
  const dueAt = Date.parse(config.nextRunAt || '');
  if (!Number.isFinite(dueAt)) {
    refs.configStore.setNexusAiMonitorSettings({ enabled: true, intervalMinutes: config.intervalMinutes });
    broadcastMonitor();
    return { skipped: true, reason: 'initialized' };
  }
  if (now < dueAt) return { skipped: true, reason: 'not-due' };

  schedulerPollInFlight = true;
  const startedAt = nowIso(now);
  const nextRunAt = nowIso(now + intervalMs);
  refs.configStore.claimNexusAiMonitorRun({ startedAt, nextRunAt });
  broadcastMonitor();
  try {
    return await runRecordedCheck({ source: 'shared-scheduler', reason: 'shared-scheduler-recurring-check' });
  } finally {
    schedulerPollInFlight = false;
  }
}

function patchSchedulerService() {
  const target = require('./services/server-scheduler-service.cjs');
  const Original = target.ServerSchedulerService;
  if (!Original || Original.__khaosNexusAiOperations) return;
  class NexusAiSharedSchedulerService extends Original {
    constructor(...args) {
      super(...args);
      refs.scheduler = this;
    }

    async tick() {
      await super.tick();
      try { await runScheduledMonitorTick({ now: this.now() }); }
      catch (error) { refs.logger?.warn?.('Shared scheduler Nexus AI check failed.', { message: safeText(error.message, 500) }); }
    }
  }
  Object.defineProperty(NexusAiSharedSchedulerService, '__khaosNexusAiOperations', { value: true });
  target.ServerSchedulerService = NexusAiSharedSchedulerService;
}

function configuredOwnerId() {
  try { return String(refs.configStore?.getConfig?.().discord?.ownerUserId || ''); }
  catch { return ''; }
}

function assertBotActor(actor = {}, { owner = false } = {}) {
  const guildId = safeIdentifier(actor.guildId, 40);
  const channelId = safeIdentifier(actor.channelId, 40);
  const userId = safeIdentifier(actor.userId, 40);
  if (!guildId || !channelId || !userId) throw new Error('Nexus AI Discord commands must run in an authorized server channel.');
  const configuredGuild = safeIdentifier(refs.configStore?.getConfig?.().discord?.guildId, 40);
  if (configuredGuild && guildId !== configuredGuild) throw new Error('This Discord server is not authorized for Khaos Nexus commands.');
  const ownerId = configuredOwnerId();
  const isOwner = Boolean(ownerId && userId === ownerId);
  const isAdministrator = actor.administrator === true;
  if (owner && !isOwner && !isAdministrator) throw new Error('This Nexus AI command requires the configured Owner or a Discord administrator.');
  return { ...actor, guildId, channelId, userId, role: isOwner ? 'owner' : isAdministrator ? 'administrator' : 'viewer' };
}

async function handleBotRequest(payload = {}) {
  const id = safeIdentifier(payload.id, 120);
  const action = safeIdentifier(payload.action, 40);
  const ownerAction = ['check', 'plan', 'subscribe', 'unsubscribe'].includes(action);
  const actor = assertBotActor(payload.actor, { owner: ownerAction });
  const input = payload.input && typeof payload.input === 'object' ? payload.input : {};
  let result;
  if (action === 'status') result = await monitorPublicState();
  else if (action === 'ask') result = await ask({ prompt: input.prompt, context: { source: 'discord', guildId: actor.guildId, channelId: actor.channelId } });
  else if (action === 'updates') {
    const config = refs.configStore.getNexusAiMonitorConfig();
    result = { history: config.history.slice(0, boundedInteger(input.limit, 5, 1, 10)), settings: monitorPublicSettings(config) };
  } else if (action === 'check') result = await runRecordedCheck({ source: 'discord-manual', actor, reason: 'discord-owner-manual-check' });
  else if (action === 'plan') result = await proposeMaintenance({ finding: input.finding });
  else if (action === 'subscribe') {
    const source = sourceFromTarget(input.provider, input.target);
    refs.configStore.upsertNexusAiMonitorSource(source);
    const subscription = refs.configStore.addNexusAiSubscription({
      sourceId: source.id,
      guildId: actor.guildId,
      channelId: actor.channelId,
      userId: actor.userId
    });
    audit('monitor.subscribe', 'success', { actorId: actor.userId, actorName: actor.username, actorRole: actor.role, sourceId: source.id, summary: 'Discord monitor subscription saved for review-only updates.' });
    broadcastMonitor();
    result = { source, subscription, automaticPublicAnnouncement: false };
  } else if (action === 'unsubscribe') {
    const removed = refs.configStore.removeNexusAiSubscription({ sourceId: input.sourceId, userId: actor.userId, channelId: actor.channelId });
    audit('monitor.unsubscribe', 'success', { actorId: actor.userId, actorName: actor.username, actorRole: actor.role, sourceId: input.sourceId, summary: `${removed.removed} Discord monitor subscription(s) removed.` });
    broadcastMonitor();
    result = removed;
  } else throw new Error('Unsupported Nexus AI Discord action.');
  audit(`discord.${action}`, 'success', { actorId: actor.userId, actorName: actor.username, actorRole: actor.role, action, summary: `Nexus AI ${action} completed.` });
  return { id, action, result };
}

function monitorPublicSettings(config) {
  return {
    enabled: config.enabled,
    intervalMinutes: config.intervalMinutes,
    lastRunAt: config.lastRunAt,
    nextRunAt: config.nextRunAt,
    lastOutcome: config.lastOutcome,
    lastSummary: config.lastSummary
  };
}

function patchBotSupervisor() {
  const target = require('./services/bot-supervisor.cjs');
  const Original = target.BotSupervisor;
  if (!Original || Original.__khaosNexusAiOperations) return;
  class NexusAiOperationsBotSupervisor extends Original {
    constructor(...args) {
      super(...args);
      refs.supervisor = this;
    }

    botPath() {
      return electron.app.isPackaged
        ? require('node:path').join(process.resourcesPath, 'app.asar', 'bot', 'nexus-ai-index.cjs')
        : require('node:path').join(__dirname, '..', 'bot', 'nexus-ai-index.cjs');
    }

    handleMessage(message) {
      if (message?.type === 'nexus-ai-request') {
        const child = this.child;
        handleBotRequest(message.payload).then((value) => {
          if (this.child === child) child?.postMessage?.({ type: 'nexus-ai-response', payload: { id: message.payload?.id, ok: true, value } });
        }).catch((error) => {
          audit(`discord.${safeIdentifier(message.payload?.action, 40) || 'unknown'}`, 'failed', {
            actorId: message.payload?.actor?.userId,
            actorName: message.payload?.actor?.username,
            summary: safeText(error.message, 500)
          });
          if (this.child === child) child?.postMessage?.({
            type: 'nexus-ai-response',
            payload: { id: message.payload?.id, ok: false, error: safeText(error.message, 500), code: safeIdentifier(error.code || 'NEXUS_AI_REQUEST_FAILED', 100) }
          });
        });
        return;
      }
      return super.handleMessage(message);
    }
  }
  Object.defineProperty(NexusAiOperationsBotSupervisor, '__khaosNexusAiOperations', { value: true });
  target.BotSupervisor = NexusAiOperationsBotSupervisor;
}

function broadcastMonitor() {
  if (!refs.configStore?.getNexusAiMonitorConfig) return;
  const config = refs.configStore.getNexusAiMonitorConfig();
  const payload = { settings: monitorPublicSettings(config), sources: config.sources, subscriptions: config.subscriptions, history: config.history.slice(0, 20) };
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('nexus-ai-core:monitor-update', payload);
  }
}

function registerIpc() {
  if (ipcInstalled || !refs.configStore) return;
  ipcInstalled = true;
  electron.ipcMain.handle('nexus-ai-core:status', () => { assertAccess('viewer', 'View Nexus AI status'); return status(); });
  electron.ipcMain.handle('nexus-ai-core:monitor-state', () => { assertAccess('viewer', 'View Nexus AI monitor'); return monitorPublicState(); });
  electron.ipcMain.handle('nexus-ai-core:check-now', (_event, input) => { assertAccess('owner', 'Run a Nexus AI update check'); return runRecordedCheck({ source: 'desktop-manual', reason: input?.reason || 'owner-manual-check' }); });
  electron.ipcMain.handle('nexus-ai-core:ask', (_event, input) => { assertAccess('viewer', 'Ask Nexus AI'); return ask(input); });
  electron.ipcMain.handle('nexus-ai-core:propose-maintenance', (_event, input) => { assertAccess('owner', 'Create an advisory Nexus AI maintenance plan'); return proposeMaintenance(input); });
  electron.ipcMain.handle('nexus-ai-core:monitor-save', (_event, input) => {
    assertAccess('owner', 'Change Nexus AI monitor settings');
    const state = refs.configStore.setNexusAiMonitorSettings(input || {});
    audit('monitor.settings', 'success', { summary: `Monitor ${state.enabled ? 'enabled' : 'disabled'} at ${state.intervalMinutes}-minute intervals.` });
    broadcastMonitor();
    return monitorPublicState({ includeCore: false });
  });
  electron.ipcMain.handle('nexus-ai-core:source-save', (_event, input) => {
    assertAccess('owner', 'Add or change Nexus AI monitor sources');
    const source = input?.target ? sourceFromTarget(input.provider, input.target) : normalizeSource(input);
    refs.configStore.upsertNexusAiMonitorSource(source);
    audit('monitor.source-saved', 'success', { sourceId: source.id, source: source.provider, summary: `Nexus AI monitor source ${source.id} saved.` });
    broadcastMonitor();
    return monitorPublicState({ includeCore: false });
  });
  electron.ipcMain.handle('nexus-ai-core:source-remove', (_event, id) => {
    assertAccess('owner', 'Remove Nexus AI monitor sources');
    refs.configStore.removeNexusAiMonitorSource(id);
    audit('monitor.source-removed', 'success', { sourceId: id, summary: `Nexus AI monitor source ${safeIdentifier(id)} removed.` });
    broadcastMonitor();
    return monitorPublicState({ includeCore: false });
  });
}

function patchBrowserLoader() {
  const prototype = electron.BrowserWindow?.prototype;
  if (!prototype || prototype.__khaosNexusAiOperationsUi) return;
  const original = prototype.loadFile;
  prototype.loadFile = function patchedLoadFile(...args) {
    this.webContents.once('did-finish-load', () => {
      if (this.isDestroyed() || this.webContents.isDestroyed()) return;
      this.webContents.executeJavaScript(`(() => {
        if (!document.querySelector('link[href="nexus-ai-operations.css"]')) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = 'nexus-ai-operations.css';
          document.head.appendChild(link);
        }
        if (!document.querySelector('script[src="nexus-ai-operations.js"]')) {
          const script = document.createElement('script');
          script.src = 'nexus-ai-operations.js';
          script.defer = true;
          document.body.appendChild(script);
        }
      })();`).catch((error) => refs.logger?.warn?.('Nexus AI operations renderer bootstrap failed.', { message: error.message }));
    });
    return original.apply(this, args);
  };
  Object.defineProperty(prototype, '__khaosNexusAiOperationsUi', { value: true });
}

function install() {
  if (installed) return;
  installed = true;
  patchConfigStore();
  patchBotSupervisor();
  patchSchedulerService();
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  patchBrowserLoader();
  electron.app.whenReady().then(() => {
    const wait = () => {
      if (refs.configStore) registerIpc();
      else setTimeout(wait, 100).unref?.();
    };
    wait();
  });
}

module.exports = {
  install,
  refs,
  status,
  negotiate,
  checkNow,
  ask,
  proposeMaintenance,
  monitorPublicState,
  runScheduledMonitorTick,
  normalizeSource,
  sourceFromTarget,
  safeText
};
