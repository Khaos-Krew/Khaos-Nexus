'use strict';

const { EventEmitter } = require('node:events');
const { knownCapability } = require('./capability-registry.cjs');

function supervisorError(message, code = 'NEXUS_WORKER_SUPERVISOR_INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class WorkerSupervisor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.now = options.now || (() => Date.now());
    this.schedule = options.schedule || ((fn, delay) => setTimeout(fn, delay));
    this.cancelScheduled = options.cancelScheduled || ((handle) => clearTimeout(handle));
    this.maxRestarts = Math.max(1, Number(options.maxRestarts || 3));
    this.restartWindowMs = Math.max(1000, Number(options.restartWindowMs || 5 * 60 * 1000));
    this.baseBackoffMs = Math.max(0, Number(options.baseBackoffMs ?? 1000));
    this.maxBackoffMs = Math.max(this.baseBackoffMs, Number(options.maxBackoffMs ?? 30 * 1000));
    this.workers = new Map();
  }

  register(idInput, definition = {}) {
    const id = String(idInput || '').trim();
    if (!id) throw supervisorError('Worker id is required.');
    if (this.workers.has(id)) throw supervisorError(`Worker ${id} is already registered.`, 'NEXUS_WORKER_EXISTS');
    if (typeof definition.start !== 'function' || typeof definition.stop !== 'function') {
      throw supervisorError(`Worker ${id} requires start and stop functions.`);
    }

    const allowedCapabilities = [...new Set((definition.allowedCapabilities || []).map(String))].sort();
    for (const capability of allowedCapabilities) {
      if (!knownCapability(capability)) throw supervisorError(`Worker ${id} references unknown capability ${capability}.`);
    }

    this.workers.set(id, {
      id,
      definition: {
        start: definition.start,
        stop: definition.stop,
        health: typeof definition.health === 'function' ? definition.health : null,
        allowedCapabilities
      },
      state: {
        status: 'stopped',
        desiredRunning: false,
        startedAt: null,
        readyAt: null,
        stoppedAt: null,
        failedAt: null,
        lastError: null,
        restartCount: 0,
        restartHistory: [],
        restartScheduledAt: null,
        circuitOpen: false,
        circuitOpenedAt: null,
        capabilities: []
      },
      handle: null,
      restartTimer: null,
      generation: 0
    });
    this.emitState(id);
    return this.snapshot(id);
  }

  entry(id) {
    const entry = this.workers.get(String(id || ''));
    if (!entry) throw supervisorError(`Worker ${id || '(empty)'} is not registered.`, 'NEXUS_WORKER_NOT_FOUND');
    return entry;
  }

  emitState(id) {
    this.emit('state', this.snapshot(id));
  }

  snapshot(id) {
    const entry = this.entry(id);
    return Object.freeze({
      id: entry.id,
      ...clone(entry.state),
      allowedCapabilities: Object.freeze(entry.definition.allowedCapabilities.slice())
    });
  }

  all() {
    return Object.freeze([...this.workers.keys()].map((id) => this.snapshot(id)));
  }

  normalizeCapabilities(entry, requested) {
    const values = [...new Set((requested || []).map(String))].sort();
    const allowed = new Set(entry.definition.allowedCapabilities);
    for (const capability of values) {
      if (!knownCapability(capability)) throw supervisorError(`Unknown worker capability ${capability}.`);
      if (!allowed.has(capability)) {
        throw supervisorError(`Worker ${entry.id} cannot be granted ${capability}.`, 'NEXUS_WORKER_CAPABILITY_EXPANSION');
      }
    }
    return values;
  }

  pruneRestarts(entry) {
    const cutoff = this.now() - this.restartWindowMs;
    entry.state.restartHistory = entry.state.restartHistory.filter((time) => time >= cutoff);
    entry.state.restartCount = entry.state.restartHistory.length;
  }

  async start(id, options = {}) {
    const entry = this.entry(id);
    if (entry.state.circuitOpen) throw supervisorError(`Worker ${entry.id} restart circuit is open.`, 'NEXUS_WORKER_CIRCUIT_OPEN');
    if (['starting', 'running', 'ready'].includes(entry.state.status)) return this.snapshot(id);

    const capabilities = this.normalizeCapabilities(entry, options.grantedCapabilities || []);
    entry.state.desiredRunning = true;
    entry.state.status = 'starting';
    entry.state.lastError = null;
    entry.state.capabilities = capabilities;
    entry.state.restartScheduledAt = null;
    entry.generation += 1;
    const generation = entry.generation;
    this.emitState(id);

    try {
      entry.handle = await entry.definition.start({
        id: entry.id,
        generation,
        capabilities: Object.freeze(capabilities.slice()),
        reportReady: () => this.reportReady(entry.id, generation),
        reportFailure: (error) => this.reportFailure(entry.id, error, generation)
      });
      if (entry.generation !== generation || !entry.state.desiredRunning) return this.snapshot(id);
      if (entry.state.status === 'starting') {
        entry.state.status = 'running';
        entry.state.startedAt = new Date(this.now()).toISOString();
        this.emitState(id);
      }
      return this.snapshot(id);
    } catch (error) {
      await this.reportFailure(entry.id, error, generation);
      return this.snapshot(id);
    }
  }

  reportReady(id, generation = null) {
    const entry = this.entry(id);
    if (generation !== null && generation !== entry.generation) return this.snapshot(id);
    if (!entry.state.desiredRunning || !['starting', 'running', 'ready'].includes(entry.state.status)) return this.snapshot(id);
    entry.state.status = 'ready';
    entry.state.readyAt = new Date(this.now()).toISOString();
    entry.state.lastError = null;
    this.emitState(id);
    return this.snapshot(id);
  }

  async reportFailure(id, error, generation = null) {
    const entry = this.entry(id);
    if (generation !== null && generation !== entry.generation) return this.snapshot(id);
    if (['stopped', 'stopping'].includes(entry.state.status) || !entry.state.desiredRunning) return this.snapshot(id);

    entry.state.status = 'failed';
    entry.state.failedAt = new Date(this.now()).toISOString();
    entry.state.lastError = String(error?.message || error || 'Worker failed.').slice(0, 2000);
    entry.handle = null;
    this.emitState(id);
    this.scheduleRestart(entry);
    return this.snapshot(id);
  }

  scheduleRestart(entry) {
    if (!entry.state.desiredRunning || entry.restartTimer || entry.state.circuitOpen) return;
    this.pruneRestarts(entry);
    if (entry.state.restartHistory.length >= this.maxRestarts) {
      entry.state.circuitOpen = true;
      entry.state.circuitOpenedAt = new Date(this.now()).toISOString();
      entry.state.status = 'circuit-open';
      entry.state.restartScheduledAt = null;
      this.emitState(entry.id);
      return;
    }

    const attempt = entry.state.restartHistory.length;
    const delay = Math.min(this.maxBackoffMs, this.baseBackoffMs * (2 ** attempt));
    entry.state.restartScheduledAt = new Date(this.now() + delay).toISOString();
    this.emitState(entry.id);
    entry.restartTimer = this.schedule(async () => {
      entry.restartTimer = null;
      if (!entry.state.desiredRunning || entry.state.circuitOpen) return;
      entry.state.restartHistory.push(this.now());
      this.pruneRestarts(entry);
      entry.state.status = 'stopped';
      entry.state.restartScheduledAt = null;
      this.emitState(entry.id);
      await this.start(entry.id, { grantedCapabilities: entry.state.capabilities });
    }, delay);
  }

  async stop(id) {
    const entry = this.entry(id);
    entry.state.desiredRunning = false;
    entry.generation += 1;
    if (entry.restartTimer) this.cancelScheduled(entry.restartTimer);
    entry.restartTimer = null;
    entry.state.restartScheduledAt = null;

    if (entry.state.status === 'stopped') return this.snapshot(id);
    entry.state.status = 'stopping';
    this.emitState(id);
    try {
      await entry.definition.stop(entry.handle, { id: entry.id, generation: entry.generation });
    } finally {
      entry.handle = null;
      entry.state.status = 'stopped';
      entry.state.stoppedAt = new Date(this.now()).toISOString();
      entry.state.lastError = null;
      this.emitState(id);
    }
    return this.snapshot(id);
  }

  clearCircuit(id) {
    const entry = this.entry(id);
    if (entry.restartTimer) this.cancelScheduled(entry.restartTimer);
    entry.restartTimer = null;
    entry.state.circuitOpen = false;
    entry.state.circuitOpenedAt = null;
    entry.state.restartHistory = [];
    entry.state.restartCount = 0;
    entry.state.restartScheduledAt = null;
    if (entry.state.status === 'circuit-open') entry.state.status = 'stopped';
    this.emitState(id);
    return this.snapshot(id);
  }

  async health(id) {
    const entry = this.entry(id);
    if (!entry.definition.health) return { ok: ['running', 'ready'].includes(entry.state.status), detail: null };
    try {
      const detail = await entry.definition.health(entry.handle, this.snapshot(id));
      return { ok: detail?.ok !== false, detail: detail ?? null };
    } catch (error) {
      return { ok: false, detail: { error: String(error?.message || error) } };
    }
  }
}

module.exports = {
  WorkerSupervisor
};
