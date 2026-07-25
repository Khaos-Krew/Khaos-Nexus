'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { ServerConnection } = require('../../bot/server-client.cjs');
const {
  normalizeSchedule,
  normalizeHistoryEntry,
  nextOccurrence,
  relevantOccurrence,
  dueWarning,
  warningText
} = require('../../shared/server-scheduler.cjs');

class CancelledRunError extends Error {
  constructor(message = 'The scheduled workflow was cancelled.') {
    super(message);
    this.code = 'SCHEDULER_CANCELLED';
  }
}

function safeResult(value) {
  if (value === undefined || value === null || value === '') return 'Command completed.';
  if (typeof value === 'string') return value.slice(0, 500);
  try { return JSON.stringify(value).slice(0, 500); }
  catch { return String(value).slice(0, 500); }
}

class ServerSchedulerService extends EventEmitter {
  constructor({
    dataDirectory,
    configStore,
    logger,
    autonomy,
    connectionFactory,
    now = () => Date.now(),
    intervalFactory = setInterval,
    clearIntervalFactory = clearInterval,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  } = {}) {
    super();
    this.dataDirectory = dataDirectory;
    this.configStore = configStore;
    this.logger = logger;
    this.autonomy = autonomy;
    this.connectionFactory = connectionFactory || ((server) => new ServerConnection(server));
    this.now = now;
    this.intervalFactory = intervalFactory;
    this.clearIntervalFactory = clearIntervalFactory;
    this.sleep = sleep;
    this.historyPath = path.join(dataDirectory, 'server-scheduler-history.json');
    this.statePath = path.join(dataDirectory, 'server-scheduler-state.json');
    this.history = this.loadJson(this.historyPath, []);
    this.runtime = this.loadJson(this.statePath, { occurrences: {} });
    this.activeRuns = new Map();
    this.runPromises = new Map();
    this.timer = null;
    this.ticking = false;
  }

  loadJson(filePath, fallback) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        try { fs.renameSync(filePath, `${filePath}.corrupt-${Date.now()}`); } catch {}
      }
      return JSON.parse(JSON.stringify(fallback));
    }
  }

  atomicWrite(filePath, payload) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(temporary, filePath);
  }

  saveHistory() {
    const limit = this.configStore.getSchedulerConfig().settings.historyLimit;
    this.history = this.history.slice(0, limit);
    this.atomicWrite(this.historyPath, this.history);
  }

  saveRuntime() {
    this.atomicWrite(this.statePath, this.runtime);
  }

  start() {
    if (this.timer) return;
    this.timer = this.intervalFactory(() => this.tick().catch((error) => {
      this.logger?.error?.('Server scheduler tick failed.', { message: error.message });
    }), 15 * 1000);
    this.timer?.unref?.();
    setTimeout(() => this.tick().catch((error) => this.logger?.warn?.('Initial server scheduler check failed.', { message: error.message })), 2500).unref?.();
  }

  destroy() {
    if (this.timer) this.clearIntervalFactory(this.timer);
    this.timer = null;
    for (const run of this.activeRuns.values()) run.cancelRequested = true;
  }

  scheduleById(id) {
    const schedule = this.configStore.getSchedulerConfig().schedules.find((item) => item.id === id);
    if (!schedule) throw new Error('The selected server schedule was not found.');
    return normalizeSchedule(schedule);
  }

  nextRuns() {
    const now = new Date(this.now());
    return Object.fromEntries(this.configStore.getSchedulerConfig().schedules.map((schedule) => {
      const next = schedule.enabled ? nextOccurrence(schedule, now) : null;
      return [schedule.id, next ? next.toISOString() : null];
    }));
  }

  publicActiveRun(run) {
    return {
      id: run.id,
      scheduleId: run.scheduleId,
      scheduleName: run.scheduleName,
      action: run.action,
      source: run.source,
      stage: run.stage,
      startedAt: run.startedAt,
      targetAt: run.targetAt || null,
      serverIds: [...run.serverIds],
      cancelRequested: Boolean(run.cancelRequested),
      shutdownSent: Boolean(run.shutdownSent)
    };
  }

  getState() {
    return {
      config: this.configStore.getSchedulerConfig(),
      history: this.history.slice(0, this.configStore.getSchedulerConfig().settings.historyLimit),
      activeRuns: [...this.activeRuns.values()].map((run) => this.publicActiveRun(run)),
      nextRuns: this.nextRuns()
    };
  }

  emitState() {
    this.emit('state', this.getState());
  }

  historyEntry(id) {
    return this.history.find((entry) => entry.id === id) || null;
  }

  createHistory(schedule, { occurrenceKey = '', source = 'scheduled', stage = 'queued' } = {}) {
    const entry = normalizeHistoryEntry({
      id: `scheduler-run-${crypto.randomUUID()}`,
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      occurrenceKey,
      source,
      action: schedule.action,
      serverIds: schedule.serverIds,
      startedAt: new Date(this.now()).toISOString(),
      outcome: 'running',
      stage,
      summary: source === 'manual' ? 'Manual workflow queued.' : 'Scheduled workflow entered its warning window.',
      details: []
    });
    this.history.unshift(entry);
    this.saveHistory();
    this.emitState();
    return entry;
  }

  updateHistory(id, patch = {}) {
    const index = this.history.findIndex((entry) => entry.id === id);
    if (index < 0) return null;
    this.history[index] = normalizeHistoryEntry({ ...this.history[index], ...patch, id });
    this.saveHistory();
    this.emitState();
    return this.history[index];
  }

  addDetail(id, detail = {}) {
    const entry = this.historyEntry(id);
    if (!entry) return null;
    const details = [...entry.details, {
      time: new Date(this.now()).toISOString(),
      stage: detail.stage || entry.stage,
      serverId: detail.serverId || '',
      serverName: detail.serverName || '',
      outcome: detail.outcome || 'info',
      message: String(detail.message || '').slice(0, 700)
    }].slice(-100);
    return this.updateHistory(id, { details });
  }

  occurrenceState(key) {
    this.runtime.occurrences ||= {};
    this.runtime.occurrences[key] ||= {
      warningsSent: [],
      finalStarted: false,
      completed: false,
      outcome: null,
      historyId: null,
      updatedAt: new Date(this.now()).toISOString()
    };
    return this.runtime.occurrences[key];
  }

  updateOccurrence(key, patch = {}) {
    const state = this.occurrenceState(key);
    this.runtime.occurrences[key] = { ...state, ...patch, updatedAt: new Date(this.now()).toISOString() };
    this.saveRuntime();
    return this.runtime.occurrences[key];
  }

  pruneOccurrences() {
    const cutoff = this.now() - 8 * 24 * 60 * 60 * 1000;
    for (const [key, state] of Object.entries(this.runtime.occurrences || {})) {
      const updated = new Date(state.updatedAt || 0).getTime();
      if (!Number.isFinite(updated) || updated < cutoff) delete this.runtime.occurrences[key];
    }
    this.saveRuntime();
  }

  runtimeServers(schedule) {
    const runtime = this.configStore.getRuntimeBootstrap();
    const wanted = new Set(schedule.serverIds);
    return runtime.config.servers.filter((server) => wanted.has(server.id) && server.enabled !== false);
  }

  async notify(schedule, title, message, level = 'info') {
    if (!schedule.discordReport || !this.autonomy?.notify) return { skipped: true, reason: 'schedule-disabled' };
    try { return await this.autonomy.notify(title, message, level); }
    catch (error) {
      this.logger?.warn?.('Server scheduler Discord report failed.', { scheduleId: schedule.id, message: error.message });
      return { sent: false, error: error.message };
    }
  }

  async actionForServer(server, action, payload = {}) {
    if (!server.password) throw new Error('Protected server credentials are missing.');
    return this.connectionFactory(server).action(action, payload);
  }

  async actionAcrossServers(schedule, servers, action, payload, historyId, stage) {
    const results = [];
    for (const server of servers) {
      try {
        const result = await this.actionForServer(server, action, typeof payload === 'function' ? payload(server) : payload);
        results.push({ server, ok: true, result });
        this.addDetail(historyId, { stage, serverId: server.id, serverName: server.name, outcome: 'success', message: safeResult(result) });
      } catch (error) {
        results.push({ server, ok: false, error });
        this.addDetail(historyId, { stage, serverId: server.id, serverName: server.name, outcome: 'failed', message: error.message });
      }
    }
    return results;
  }

  async dispatchWarning(schedule, occurrence, minutes) {
    const occurrenceState = this.occurrenceState(occurrence.key);
    const history = occurrenceState.historyId ? this.historyEntry(occurrenceState.historyId) : this.createHistory(schedule, { occurrenceKey: occurrence.key, stage: 'warning-window' });
    if (!occurrenceState.historyId) this.updateOccurrence(occurrence.key, { historyId: history.id });
    const message = warningText(schedule, minutes);
    const servers = this.runtimeServers(schedule);
    const results = await this.actionAcrossServers(schedule, servers, 'announce', { message }, history.id, `warning-${minutes}m`);
    const due = schedule.warningMinutes.filter((warning) => new Date(this.now()).getTime() >= occurrence.target.getTime() - warning * 60 * 1000);
    const sent = [...new Set([...(occurrenceState.warningsSent || []), ...due])].sort((a, b) => b - a);
    this.updateOccurrence(occurrence.key, { warningsSent: sent, historyId: history.id });
    const delivered = results.filter((item) => item.ok).length;
    this.updateHistory(history.id, {
      stage: `warning-${minutes}m`,
      summary: `${minutes}-minute warning delivered to ${delivered} of ${servers.length} configured servers.`
    });
    await this.notify(schedule, `${schedule.name}: ${minutes}-minute warning`, `${message}\n\nDelivered to ${delivered} of ${servers.length} servers.`, delivered === servers.length ? 'warning' : 'error');
    return { historyId: history.id, delivered, total: servers.length };
  }

  hasServerConflict(schedule) {
    const wanted = new Set(schedule.serverIds);
    return [...this.activeRuns.values()].find((run) => run.serverIds.some((id) => wanted.has(id))) || null;
  }

  async waitFor(ms, run) {
    let remaining = Math.max(0, Number(ms) || 0);
    while (remaining > 0) {
      if (run.cancelRequested) throw new CancelledRunError();
      const chunk = Math.min(1000, remaining);
      await this.sleep(chunk);
      remaining -= chunk;
    }
    if (run.cancelRequested) throw new CancelledRunError();
  }

  startRun(scheduleInput, { occurrenceKey = '', source = 'scheduled', countdownSeconds = 0, targetAt = null, historyId = null } = {}) {
    const schedule = normalizeSchedule(scheduleInput);
    const conflict = this.hasServerConflict(schedule);
    if (conflict) throw new Error(`${conflict.scheduleName} is already operating on one or more selected servers.`);
    const history = historyId ? this.historyEntry(historyId) : this.createHistory(schedule, { occurrenceKey, source, stage: countdownSeconds > 0 ? 'manual-warning' : 'starting' });
    if (!history) throw new Error('The scheduler history record could not be created.');
    const run = {
      id: history.id,
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      action: schedule.action,
      source,
      stage: countdownSeconds > 0 ? 'manual-warning' : 'starting',
      startedAt: history.startedAt,
      targetAt: targetAt ? String(targetAt) : null,
      serverIds: [...schedule.serverIds],
      cancelRequested: false,
      shutdownSent: false
    };
    this.activeRuns.set(run.id, run);
    this.emitState();
    const promise = this.performRun(schedule, run, history, Math.max(0, Number(countdownSeconds) || 0), occurrenceKey)
      .catch((error) => this.logger?.error?.('Server scheduler workflow failed.', { scheduleId: schedule.id, runId: run.id, message: error.message }))
      .finally(() => {
        this.activeRuns.delete(run.id);
        this.runPromises.delete(run.id);
        this.emitState();
      });
    this.runPromises.set(run.id, promise);
    return this.publicActiveRun(run);
  }

  setRunStage(run, historyId, stage, summary) {
    run.stage = stage;
    this.updateHistory(historyId, { stage, summary });
    this.emitState();
  }

  async performRun(schedule, run, history, countdownSeconds, occurrenceKey) {
    let finalOutcome = 'failed';
    let finalSummary = '';
    try {
      const servers = this.runtimeServers(schedule);
      if (!servers.length) throw new Error('No enabled configured servers are selected for this schedule.');

      if (countdownSeconds > 0 && schedule.action === 'restart') {
        const minutes = Math.max(1, Math.ceil(countdownSeconds / 60));
        this.setRunStage(run, history.id, 'manual-warning', `Manual ${minutes}-minute warning is active.`);
        const message = warningText(schedule, minutes);
        await this.actionAcrossServers(schedule, servers, 'announce', { message }, history.id, 'manual-warning');
        await this.notify(schedule, `${schedule.name}: manual restart warning`, message, 'warning');
        await this.waitFor(countdownSeconds * 1000, run);
      }

      let eligible = [...servers];
      if (schedule.saveBeforeAction || schedule.action === 'save') {
        this.setRunStage(run, history.id, 'saving', `Saving ${servers.length} server${servers.length === 1 ? '' : 's'}.`);
        const saveResults = await this.actionAcrossServers(schedule, servers, 'save', {}, history.id, 'save');
        eligible = saveResults.filter((item) => item.ok).map((item) => item.server);
        if (!eligible.length) throw new Error('Every world save failed; shutdown was cancelled to protect server data.');
        if (schedule.action === 'save') {
          finalOutcome = eligible.length === servers.length ? 'success' : 'partial';
          finalSummary = `World save completed on ${eligible.length} of ${servers.length} servers.`;
          return;
        }
        this.setRunStage(run, history.id, 'save-settle', `World save completed on ${eligible.length} of ${servers.length} servers. Waiting before shutdown.`);
        await this.waitFor(schedule.saveDelaySeconds * 1000, run);
      }

      this.setRunStage(run, history.id, 'shutdown', `Sending safe shutdown to ${eligible.length} server${eligible.length === 1 ? '' : 's'}.`);
      await this.actionAcrossServers(schedule, eligible, 'announce', { message: schedule.finalMessage }, history.id, 'final-warning');
      const shutdownResults = await this.actionAcrossServers(schedule, eligible, 'shutdown', { waittime: 0, message: schedule.finalMessage }, history.id, 'shutdown');
      const shutdownServers = shutdownResults.filter((item) => item.ok).map((item) => item.server);
      run.shutdownSent = shutdownServers.length > 0;
      this.emitState();
      if (!shutdownServers.length) throw new Error('The safe shutdown command failed on every selected server.');

      this.setRunStage(run, history.id, 'verifying-restart', `Waiting for the host to restart ${shutdownServers.length} server${shutdownServers.length === 1 ? '' : 's'}.`);
      const verification = await this.verifyHostRestart(schedule, run, history.id, shutdownServers);
      const returned = verification.filter((item) => item.backOnline).length;
      const unobserved = verification.filter((item) => !item.wentOffline).length;
      finalOutcome = returned === shutdownServers.length && shutdownServers.length === servers.length ? 'success' : returned > 0 ? 'partial' : 'failed';
      finalSummary = returned === shutdownServers.length
        ? `Host-managed restart verified for ${returned} server${returned === 1 ? '' : 's'}.`
        : `Restart verification returned ${returned} of ${shutdownServers.length} servers online${unobserved ? `; ${unobserved} shutdown transition${unobserved === 1 ? ' was' : 's were'} not observed` : ''}.`;
    } catch (error) {
      if (error?.code === 'SCHEDULER_CANCELLED') {
        finalOutcome = 'cancelled';
        finalSummary = run.shutdownSent
          ? 'Monitoring was cancelled after shutdown had already been sent. Check the hosting panel before taking further action.'
          : 'The scheduled workflow was cancelled before shutdown.';
      } else {
        finalOutcome = 'failed';
        finalSummary = error.message;
        this.addDetail(history.id, { stage: run.stage, outcome: 'failed', message: error.message });
      }
    } finally {
      const completedAt = new Date(this.now()).toISOString();
      this.updateHistory(history.id, { outcome: finalOutcome, completedAt, stage: 'completed', summary: finalSummary });
      this.configStore.patchSchedulerSchedule(schedule.id, { lastRunAt: completedAt, lastOutcome: finalOutcome, lastError: finalOutcome === 'success' ? '' : finalSummary });
      if (occurrenceKey) this.updateOccurrence(occurrenceKey, { completed: true, outcome: finalOutcome, historyId: history.id });
      await this.notify(schedule, `${schedule.name}: ${finalOutcome}`, finalSummary, finalOutcome === 'success' ? 'info' : finalOutcome === 'partial' ? 'warning' : 'error');
      this.logger?.[finalOutcome === 'success' ? 'info' : finalOutcome === 'partial' ? 'warn' : 'error']?.('Server scheduler workflow completed.', {
        scheduleId: schedule.id,
        runId: history.id,
        outcome: finalOutcome,
        summary: finalSummary
      });
    }
  }

  async verifyHostRestart(schedule, run, historyId, servers) {
    const pollSeconds = this.configStore.getSchedulerConfig().settings.pollSeconds;
    const attempts = Math.max(1, Math.ceil(schedule.restartTimeoutMinutes * 60 / pollSeconds));
    const trackers = new Map(servers.map((server) => [server.id, { server, wentOffline: false, backOnline: false, checks: 0 }]));
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await this.waitFor(pollSeconds * 1000, run);
      for (const tracker of trackers.values()) {
        if (tracker.backOnline) continue;
        tracker.checks += 1;
        try {
          await this.actionForServer(tracker.server, 'status');
          if (tracker.wentOffline) {
            tracker.backOnline = true;
            this.addDetail(historyId, { stage: 'verify', serverId: tracker.server.id, serverName: tracker.server.name, outcome: 'success', message: 'Server returned online after the host-managed restart.' });
          }
        } catch (error) {
          if (!tracker.wentOffline) {
            tracker.wentOffline = true;
            this.addDetail(historyId, { stage: 'verify', serverId: tracker.server.id, serverName: tracker.server.name, outcome: 'info', message: 'Server shutdown transition detected.' });
          }
        }
      }
      if ([...trackers.values()].every((tracker) => tracker.backOnline)) break;
    }
    for (const tracker of trackers.values()) {
      if (!tracker.backOnline) {
        const message = tracker.wentOffline
          ? 'Server did not return before the restart verification timeout.'
          : 'Khaos Nexus did not observe the server go offline; the host may have ignored or completed the restart too quickly to verify.';
        this.addDetail(historyId, { stage: 'verify', serverId: tracker.server.id, serverName: tracker.server.name, outcome: 'failed', message });
      }
    }
    return [...trackers.values()];
  }

  runNow(scheduleId, options = {}) {
    const schedule = this.scheduleById(scheduleId);
    const countdownSeconds = schedule.action === 'restart' ? Math.max(0, Math.min(600, Number(options.countdownSeconds ?? 60))) : 0;
    return this.startRun(schedule, {
      occurrenceKey: `${schedule.id}:manual:${this.now()}`,
      source: 'manual',
      countdownSeconds,
      targetAt: new Date(this.now() + countdownSeconds * 1000).toISOString()
    });
  }

  cancelRun(runId) {
    const run = this.activeRuns.get(runId);
    if (!run) throw new Error('The selected scheduler run is no longer active.');
    run.cancelRequested = true;
    this.addDetail(run.id, { stage: run.stage, outcome: 'warning', message: run.shutdownSent ? 'Operator cancelled restart monitoring after shutdown was sent.' : 'Operator requested cancellation before shutdown.' });
    this.emitState();
    return this.publicActiveRun(run);
  }

  async testDiscord(scheduleId) {
    const schedule = this.scheduleById(scheduleId);
    return this.notify(schedule, `${schedule.name}: scheduler test`, 'Khaos Nexus server scheduler reporting is configured for this schedule.', 'info');
  }

  clearHistory() {
    if (this.activeRuns.size) throw new Error('Scheduler history cannot be cleared while a workflow is active.');
    this.history = [];
    this.saveHistory();
    this.emitState();
    return [];
  }

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const config = this.configStore.getSchedulerConfig();
      if (!config.settings.enabled) return;
      const now = new Date(this.now());
      for (const scheduleSource of config.schedules) {
        const schedule = normalizeSchedule(scheduleSource);
        if (!schedule.enabled || !schedule.serverIds.length) continue;
        const occurrence = relevantOccurrence(schedule, now, config.settings.missedRunGraceMinutes);
        if (!occurrence) continue;
        const state = this.occurrenceState(occurrence.key);
        if (state.completed) continue;
        const warning = dueWarning(schedule, state, now, occurrence.target);
        if (warning !== null) {
          try { await this.dispatchWarning(schedule, occurrence, warning); }
          catch (error) {
            this.logger?.warn?.('Scheduled restart warning failed.', { scheduleId: schedule.id, warning, message: error.message });
          }
        }
        if (now.getTime() >= occurrence.target.getTime() && !state.finalStarted) {
          const lateBy = now.getTime() - occurrence.target.getTime();
          if (lateBy > config.settings.missedRunGraceMinutes * 60 * 1000) {
            this.updateOccurrence(occurrence.key, { completed: true, outcome: 'failed' });
            continue;
          }
          const latest = this.occurrenceState(occurrence.key);
          this.updateOccurrence(occurrence.key, { finalStarted: true });
          try {
            this.startRun(schedule, {
              occurrenceKey: occurrence.key,
              source: 'scheduled',
              targetAt: occurrence.target.toISOString(),
              historyId: latest.historyId || null
            });
          } catch (error) {
            const history = latest.historyId ? this.historyEntry(latest.historyId) : this.createHistory(schedule, { occurrenceKey: occurrence.key, source: 'scheduled', stage: 'failed' });
            this.updateHistory(history.id, { outcome: 'failed', completedAt: new Date(this.now()).toISOString(), stage: 'completed', summary: error.message });
            this.updateOccurrence(occurrence.key, { completed: true, outcome: 'failed', historyId: history.id });
          }
        }
      }
      this.pruneOccurrences();
    } finally {
      this.ticking = false;
    }
  }
}

module.exports = { ServerSchedulerService, CancelledRunError, safeResult };
