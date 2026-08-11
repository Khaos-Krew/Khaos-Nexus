'use strict';

const path = require('node:path');
const { FileEventJournal } = require('../../shared/nexus-core/event-journal.cjs');
const { FileOperationStore } = require('../../shared/nexus-core/operation-store.cjs');
const { CommandGateway } = require('../../shared/nexus-core/command-gateway.cjs');
const { WorkerSupervisor } = require('../../shared/nexus-core/worker-supervisor.cjs');
const { ContextBroker } = require('../../shared/nexus-core/context-broker.cjs');
const { AiToolGateway } = require('../../shared/nexus-core/ai-tool-gateway.cjs');

const CORE_PROJECTION_VERSION = 1;
const instances = new Map();

function coreError(message, code = 'NEXUS_CORE_SERVICE_INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

class NexusCoreService {
  constructor(options = {}) {
    if (!options.dataDirectory) throw coreError('dataDirectory is required.');
    this.dataDirectory = path.resolve(String(options.dataDirectory));
    this.rootDirectory = path.join(this.dataDirectory, 'nexus-core');
    this.logger = options.logger || null;
    this.registeredActions = new Set();
    this.registeredTools = new Set();
    this.registeredContextProviders = new Set();
    this.registeredWorkers = new Set();

    this.journal = new FileEventJournal({
      filePath: path.join(this.rootDirectory, 'events.ndjson')
    });
    this.operationStore = new FileOperationStore({
      directory: path.join(this.rootDirectory, 'operations')
    });
    this.commandGateway = new CommandGateway({
      journal: this.journal,
      operationStore: this.operationStore,
      now: options.now,
      idFactory: options.idFactory
    });
    // Compatibility alias for the first Core migration slice.
    this.gateway = this.commandGateway;
    this.workerSupervisor = new WorkerSupervisor(options.workerSupervisor || {});
    this.contextBroker = new ContextBroker({
      journal: this.journal,
      now: options.now,
      idFactory: options.idFactory
    });
    this.aiToolGateway = new AiToolGateway({
      commandGateway: this.commandGateway,
      journal: this.journal,
      approvalVerifier: options.approvalVerifier,
      now: options.now,
      idFactory: options.idFactory
    });
  }

  registerAction(name, definition) {
    const key = String(name || '').trim();
    if (!key) throw coreError('Action name is required.');
    if (this.registeredActions.has(key)) return false;
    this.commandGateway.register(key, definition);
    this.registeredActions.add(key);
    return true;
  }

  hasAction(name) {
    return this.registeredActions.has(String(name || '').trim());
  }

  registerTool(name, definition) {
    const key = String(name || '').trim();
    if (!key) throw coreError('Tool name is required.');
    if (this.registeredTools.has(key)) return false;
    this.aiToolGateway.register(key, definition);
    this.registeredTools.add(key);
    return true;
  }

  registerContextProvider(scopeKind, provider) {
    const key = String(scopeKind || '').trim();
    if (!key) throw coreError('Context provider scope is required.');
    if (this.registeredContextProviders.has(key)) return false;
    this.contextBroker.registerProvider(key, provider);
    this.registeredContextProviders.add(key);
    return true;
  }

  registerWorker(workerId, policy, supervisorDefinition = null) {
    const key = String(workerId || '').trim();
    if (!key) throw coreError('Worker id is required.');
    if (this.registeredWorkers.has(key)) return false;
    if (policy) this.contextBroker.registerWorker(key, policy);
    if (supervisorDefinition) this.workerSupervisor.register(key, supervisorDefinition);
    this.registeredWorkers.add(key);
    return true;
  }

  setApprovalVerifier(verifier) {
    if (verifier !== null && typeof verifier !== 'function') throw coreError('approval verifier must be a function or null.');
    this.aiToolGateway.approvalVerifier = verifier;
  }

  snapshot() {
    const journal = this.journal.stats();
    return Object.freeze({
      journal,
      actions: this.registeredActions.size,
      tools: this.registeredTools.size,
      contextProviders: this.registeredContextProviders.size,
      workers: this.registeredWorkers.size,
      workerStates: this.workerSupervisor.all()
    });
  }

  publicSnapshot() {
    const snapshot = this.snapshot();
    return Object.freeze({
      schemaVersion: CORE_PROJECTION_VERSION,
      status: 'ready',
      journal: Object.freeze({
        records: snapshot.journal.records,
        scopes: snapshot.journal.scopes,
        lastSequence: snapshot.journal.lastSequence
      }),
      registry: Object.freeze({
        actions: snapshot.actions,
        tools: snapshot.tools,
        contextProviders: snapshot.contextProviders,
        workers: snapshot.workers
      }),
      workers: Object.freeze(snapshot.workerStates.map((worker) => Object.freeze({
        id: worker.id,
        status: worker.status,
        desiredRunning: worker.desiredRunning,
        readyAt: worker.readyAt,
        failedAt: worker.failedAt,
        restartCount: worker.restartCount,
        circuitOpen: worker.circuitOpen
      })))
    });
  }
}

function getNexusCoreService(options = {}) {
  if (!options.dataDirectory) throw coreError('dataDirectory is required.');
  const key = path.resolve(String(options.dataDirectory));
  const existing = instances.get(key);
  if (existing) {
    if (options.logger) existing.logger = options.logger;
    if (options.approvalVerifier) existing.setApprovalVerifier(options.approvalVerifier);
    return existing;
  }
  const service = new NexusCoreService(options);
  instances.set(key, service);
  return service;
}

module.exports = {
  CORE_PROJECTION_VERSION,
  NexusCoreService,
  getNexusCoreService
};
