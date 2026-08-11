'use strict';

const path = require('node:path');
const { FileEventJournal } = require('../shared/nexus-core/event-journal.cjs');
const { FileOperationStore } = require('../shared/nexus-core/operation-store.cjs');
const { CommandGateway } = require('../shared/nexus-core/command-gateway.cjs');

let installed = false;
const runtimes = new WeakMap();

const OPERATION_CAPABILITY = Object.freeze({
  announce: 'game.server.broadcast',
  save: 'game.server.save',
  shutdown: 'game.server.restart'
});

function capabilityForSchedulerOperation(operation) {
  return OPERATION_CAPABILITY[String(operation || '')] || null;
}

function runtimeFor(service) {
  const existing = runtimes.get(service);
  if (existing) return existing;

  const root = path.join(service.dataDirectory, 'nexus-core');
  const journal = new FileEventJournal({ filePath: path.join(root, 'events.ndjson') });
  const operationStore = new FileOperationStore({ directory: path.join(root, 'operations') });
  const gateway = new CommandGateway({ journal, operationStore });

  gateway.register('scheduler.game.operation', {
    requiredCapabilities: [],
    execute: async (request) => {
      const operation = String(request.input.operation || '');
      const capability = capabilityForSchedulerOperation(operation);
      if (!capability) {
        const error = new Error(`Scheduler operation ${operation || '(empty)'} is not approved for Nexus Core execution.`);
        error.code = 'NEXUS_SCHEDULER_OPERATION_UNSUPPORTED';
        throw error;
      }

      const runtime = service.configStore.getRuntimeBootstrap();
      const server = runtime.config.servers.find((item) => String(item.id) === String(request.input.serverId));
      if (!server) {
        const error = new Error('The configured game server was not found.');
        error.code = 'NEXUS_SERVER_NOT_FOUND';
        throw error;
      }
      if (!server.password) {
        const error = new Error('Protected server credentials are missing.');
        error.code = 'NEXUS_SERVER_CREDENTIAL_MISSING';
        throw error;
      }

      return service.connectionFactory(server).action(operation, request.input.payload || {});
    }
  });

  const runtime = Object.freeze({ journal, operationStore, gateway });
  runtimes.set(service, runtime);
  return runtime;
}

function actionEnvelope(service, schedule, server, operation, payload, historyId, stage) {
  const capability = capabilityForSchedulerOperation(operation);
  if (!capability) return null;
  const operationId = `scheduler:${historyId}:${stage}:${server.id}:${operation}`;
  return {
    operationId,
    action: 'scheduler.game.operation',
    requestedAt: new Date(service.now()).toISOString(),
    scope: { kind: 'server', id: String(server.id) },
    actor: { kind: 'system', id: 'server-scheduler' },
    source: { kind: 'scheduler', id: String(schedule.id) },
    correlationId: String(historyId),
    idempotencyKey: operationId,
    requiredCapabilities: [capability],
    input: {
      serverId: String(server.id),
      operation: String(operation),
      payload: payload || {}
    }
  };
}

function patchScheduler() {
  const target = require('./services/server-scheduler-service.cjs');
  const prototype = target.ServerSchedulerService?.prototype;
  if (!prototype || prototype.__khaosNexusCoreGatewayPatched) return;
  const { safeResult } = target;
  const original = prototype.actionAcrossServers;

  prototype.actionAcrossServers = async function nexusCoreActionAcrossServers(schedule, servers, operation, payload, historyId, stage) {
    const capability = capabilityForSchedulerOperation(operation);
    if (!capability) return original.call(this, schedule, servers, operation, payload, historyId, stage);

    const core = runtimeFor(this);
    const results = [];
    for (const server of servers) {
      const operationPayload = typeof payload === 'function' ? payload(server) : payload;
      try {
        const request = actionEnvelope(this, schedule, server, operation, operationPayload, historyId, stage);
        const result = await core.gateway.dispatch(request, {
          role: 'locked',
          grantedCapabilities: [capability]
        });

        const duplicateSuccess = result.status === 'duplicate'
          && result.output?.originalState === 'completed'
          && result.output?.originalResultStatus === 'succeeded';
        if (result.status !== 'succeeded' && !duplicateSuccess) {
          const error = new Error(result.error?.message || `Nexus Core blocked scheduler operation with status ${result.status}.`);
          error.code = result.error?.code || 'NEXUS_SCHEDULER_OPERATION_BLOCKED';
          throw error;
        }

        const displayResult = duplicateSuccess
          ? 'Nexus Core duplicate guard: this workflow step already completed.'
          : result.output;
        results.push({ server, ok: true, result: displayResult, duplicate: duplicateSuccess });
        this.addDetail(historyId, {
          stage,
          serverId: server.id,
          serverName: server.name,
          outcome: 'success',
          message: safeResult(displayResult)
        });
      } catch (error) {
        results.push({ server, ok: false, error });
        this.addDetail(historyId, {
          stage,
          serverId: server.id,
          serverName: server.name,
          outcome: 'failed',
          message: String(error?.message || error).slice(0, 700)
        });
      }
    }
    return results;
  };

  Object.defineProperty(prototype, '__khaosNexusCoreGatewayPatched', { value: true });
}

function install() {
  if (installed) return;
  installed = true;
  patchScheduler();
}

module.exports = {
  install,
  patchScheduler,
  runtimeFor,
  actionEnvelope,
  capabilityForSchedulerOperation
};
