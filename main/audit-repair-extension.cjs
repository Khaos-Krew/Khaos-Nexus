'use strict';

const path = require('node:path');

let installed = false;
const updateInstances = new Set();

function patchBotSupervisor() {
  const target = require('./services/bot-supervisor.cjs');
  const prototype = target.BotSupervisor?.prototype;
  if (!prototype || prototype.__khaosFullAuditPatched) return;

  const originalStart = prototype.start;
  prototype.start = function auditedStart(...args) {
    try {
      return originalStart.apply(this, args);
    } catch (error) {
      this.child = null;
      this.restartPending = false;
      const current = this.getState?.() || {};
      if (current.lastError?.message !== error.message) this.recordError?.(error);
      this.update?.({ status: 'error', pid: null, ready: null, heartbeat: null, lastHeartbeatAt: null });
      this.logger?.error?.('Bot runtime could not be spawned.', { message: error.message });
      throw error;
    }
  };

  prototype.botPath = function auditedBotPath() {
    const { app } = require('electron');
    return app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar', 'bot', 'audit-wrapper.cjs')
      : path.join(__dirname, '..', 'bot', 'audit-wrapper.cjs');
  };

  Object.defineProperty(prototype, '__khaosFullAuditPatched', { value: true });
}

function patchApplicationMonitor() {
  const target = require('./services/application-monitor.cjs');
  const prototype = target.ApplicationMonitor?.prototype;
  if (!prototype || prototype.__khaosFullAuditPatched) return;

  const originalDeliver = prototype.deliver;
  prototype.deliver = async function auditedDeliver(item, config = this.getConfig()) {
    if (!this.canSendToday(config)) {
      const error = new Error(`The Application Monitor daily delivery limit of ${config.maxReportsPerDay} was reached.`);
      error.code = 'DAILY_REPORT_LIMIT';
      throw error;
    }
    return originalDeliver.call(this, item, config);
  };

  prototype.processQueue = function auditedProcessQueue(options = {}) {
    const trigger = String(options.trigger || 'manual-queue-processing');
    const force = options.force !== false;
    return this.processAutomaticBatch({ trigger, force });
  };

  prototype.scheduleAutomaticBatches = function auditedScheduleAutomaticBatches() {
    const firstAt = this.now() + target.STARTUP_BATCH_DELAY_MS;
    this.state.nextBatchAt = new Date(firstAt).toISOString();
    this.saveState();
    this.startupBatchTimer = this.setTimeoutFactory(async () => {
      this.startupBatchTimer = null;
      try {
        await this.runBatchCycle('five-minute-startup-batch');
      } catch (error) {
        const message = String(error?.message || error).slice(0, 1600);
        this.logger?.error?.('Application Monitor startup batch failed.', { message });
        try { this.updateState({ status: this.state.queue.length ? 'queued' : 'error', lastError: message }); } catch {}
      } finally {
        this.startRecurringBatchTimer();
      }
    }, target.STARTUP_BATCH_DELAY_MS);
    this.startupBatchTimer?.unref?.();
  };

  Object.defineProperty(prototype, '__khaosFullAuditPatched', { value: true });
}

function patchAutonomyService() {
  const target = require('./services/autonomy-service.cjs');
  const prototype = target.AutonomyService?.prototype;
  if (!prototype || prototype.__khaosFullAuditPatched) return;

  prototype.checkServers = async function auditedCheckServers() {
    if (this.healthRunning) return { skipped: true, reason: 'already-running' };
    this.healthRunning = true;
    try {
      const runtime = this.configStore.getRuntimeBootstrap();
      const enabledServers = runtime.config.servers.filter((item) => item.enabled !== false);
      const health = {};
      const checkedAt = new Date(this.now()).toISOString();
      for (const server of enabledServers) {
        try {
          const detail = await this.testServer(server);
          health[server.id] = { name: server.name, game: server.game, status: 'online', checkedAt, failures: 0, detail };
        } catch (error) {
          const previous = this.state.serverHealth?.[server.id] || {};
          health[server.id] = {
            name: server.name,
            game: server.game,
            status: 'offline',
            checkedAt,
            failures: Number(previous.failures || 0) + 1,
            detail: String(error?.message || error).slice(0, 700)
          };
        }
      }
      const offline = Object.values(health).filter((entry) => entry.status === 'offline');
      const attention = offline.map((entry) => `A configured game server is unreachable: ${entry.detail}`);
      this.updateState({
        status: attention.length ? 'attention' : 'ready',
        lastHealthCheckAt: checkedAt,
        serverHealth: health,
        attention,
        lastError: attention[0] || null
      });
      if (offline.some((entry) => entry.failures >= 3)) {
        await this.notify('Khaos Nexus server attention required', `${offline.length} configured server connection(s) are failing repeatedly.`, 'warning').catch(() => {});
      }
      return { checkedAt, health: JSON.parse(JSON.stringify(health)), offline: offline.length };
    } finally {
      this.healthRunning = false;
    }
  };

  Object.defineProperty(prototype, '__khaosFullAuditPatched', { value: true });
}

function patchServerScheduler() {
  const target = require('./services/server-scheduler-service.cjs');
  const prototype = target.ServerSchedulerService?.prototype;
  if (!prototype || prototype.__khaosFullAuditPatched) return;
  const { normalizeHistoryEntry } = require('../shared/server-scheduler.cjs');
  const originalStart = prototype.start;

  prototype.reconcileInterruptedRuns = function reconcileInterruptedRuns() {
    if (this.__khaosInterruptedRunsReconciled) return { changed: false };
    this.__khaosInterruptedRunsReconciled = true;
    const completedAt = new Date(this.now()).toISOString();
    let historyChanged = false;
    let runtimeChanged = false;

    this.history = (Array.isArray(this.history) ? this.history : []).map((entry) => {
      if (entry?.outcome !== 'running') return normalizeHistoryEntry(entry);
      historyChanged = true;
      return normalizeHistoryEntry({
        ...entry,
        outcome: 'failed',
        stage: 'completed',
        completedAt,
        summary: 'Khaos Nexus restarted while this workflow was active. The run was closed without repeating a potentially destructive server action.'
      });
    });

    this.runtime.occurrences ||= {};
    for (const [key, state] of Object.entries(this.runtime.occurrences)) {
      if (!state?.finalStarted || state.completed) continue;
      this.runtime.occurrences[key] = {
        ...state,
        completed: true,
        outcome: 'failed',
        updatedAt: completedAt
      };
      runtimeChanged = true;
    }

    if (historyChanged) this.saveHistory();
    if (runtimeChanged) this.saveRuntime();
    if (historyChanged || runtimeChanged) {
      this.logger?.warn?.('Recovered interrupted server scheduler state without replaying server actions.', { historyChanged, runtimeChanged });
      this.emitState?.();
    }
    return { changed: historyChanged || runtimeChanged, historyChanged, runtimeChanged };
  };

  prototype.start = function auditedSchedulerStart(...args) {
    this.reconcileInterruptedRuns();
    return originalStart.apply(this, args);
  };

  prototype.pruneOccurrences = function auditedPruneOccurrences() {
    const cutoff = this.now() - 8 * 24 * 60 * 60 * 1000;
    let changed = false;
    for (const [key, state] of Object.entries(this.runtime.occurrences || {})) {
      const updated = new Date(state.updatedAt || 0).getTime();
      if (!Number.isFinite(updated) || updated < cutoff) {
        delete this.runtime.occurrences[key];
        changed = true;
      }
    }
    if (changed) this.saveRuntime();
    return changed;
  };

  Object.defineProperty(prototype, '__khaosFullAuditPatched', { value: true });
}

function patchUpdateService() {
  const target = require('./services/update-service.cjs');
  const Original = target.UpdateService;
  if (!Original || Original.__khaosFullAuditPatched) return;

  const originalInstall = Original.prototype.install;
  Original.prototype.install = function auditedInstall(...args) {
    const before = this.getState();
    try {
      if (this.mode === 'portable') {
        if (!this.stagedPath || !this.fs.existsSync(this.stagedPath)) throw new Error('The staged portable update file is missing. Download it again.');
        if (!this.portableExecutable) throw new Error('The original portable executable path is unavailable.');
      }
      return originalInstall.apply(this, args);
    } catch (error) {
      const current = this.getState();
      if (current.status === 'installing' || before.status === 'downloaded') {
        this.set({ status: 'downloaded', canDownload: false, canInstall: true, error: String(error?.message || error) });
      }
      throw error;
    }
  };

  class AuditedUpdateService extends Original {
    constructor(...args) {
      super(...args);
      updateInstances.add(this);
    }

    destroy() {
      updateInstances.delete(this);
      return super.destroy?.();
    }
  }

  Object.defineProperty(AuditedUpdateService, '__khaosFullAuditPatched', { value: true });
  target.UpdateService = AuditedUpdateService;
}

function install() {
  if (installed) return;
  installed = true;
  patchBotSupervisor();
  patchApplicationMonitor();
  patchAutonomyService();
  patchServerScheduler();
  patchUpdateService();

  const { app } = require('electron');
  app.on('before-quit', () => {
    for (const service of [...updateInstances]) {
      try { service.destroy?.(); } catch {}
    }
  });
}

module.exports = {
  install,
  patchBotSupervisor,
  patchApplicationMonitor,
  patchAutonomyService,
  patchServerScheduler,
  patchUpdateService,
  updateInstances
};
