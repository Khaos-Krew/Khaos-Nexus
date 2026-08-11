'use strict';

const { getNexusCoreService } = require('./services/nexus-core-service.cjs');

let installed = false;
const runtimes = new WeakMap();

const OPERATION_CAPABILITY = Object.freeze({
  announce: 'game.server.broadcast',
  save: 'game.server.save',
  shutdown: 'game.server.restart'
});

const INTERRUPTED_SUMMARY = 'Nexus Core detected that this workflow was interrupted by a desktop/runtime restart. Destructive steps will not be replayed automatically; verify server state before running the workflow again.';

function capabilityForSchedulerOperation(operation) {
  return OPERATION_CAPABILITY[String(operation || '')] || null;
}

function requiredCapabilitiesForSchedulerAction(request) {
  const operation = String(request?.input?.operation || '');
  const capability = capabilityForSchedulerOperation(operation);
  return capability ? [capability] : ['scheduler.unsupported-operation'];
}

function runtimeFor(service) {
  const existing = runtimes.get(service);
  if (existing) return existing;

  const core = getNexusCoreService({
    dataDirectory: service.dataDirectory,
    logger: service.logger
  });
  core.registerAction('scheduler.game.operation', {
    requiredCapabilities: requiredCapabilitiesForSchedulerAction,
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

  runtimes.set(service, core);
  return core;
}

function recoverInterruptedSchedulerState(service) {
  if (!service || !service.runtime || !Array.isArray(service.history)) {
    return Object.freeze({ recoveredOccurrences: 0, recoveredHistory: 0 });
  }

  const completedAt = new Date(service.now()).toISOString();
  let recoveredOccurrences = 0;
  let runtimeChanged = false;

  for (const state of Object.values(service.runtime.occurrences || {})) {
    if (!state || state.completed || !state.finalStarted) continue;
    state.completed = true;
    state.outcome = 'failed';
    state.recoveryReason = 'interrupted-runtime';
    state.updatedAt = completedAt;
    recoveredOccurrences += 1;
    runtimeChanged = true;
  }
  if (runtimeChanged) service.saveRuntime();

  let recoveredHistory = 0;
  for (const entry of [...service.history]) {
    if (entry?.outcome !== 'running') continue;
    const details = [...(entry.details || []), {
      time: completedAt,
      stage: entry.stage || 'recovery',
      serverId: '',
      serverName: '',
      outcome: 'warning',
      message: INTERRUPTED_SUMMARY
    }].slice(-100);
    service.updateHistory(entry.id, {
      outcome: 'failed',
      completedAt,
      stage: 'completed',
      summary: INTERRUPTED_SUMMARY,
      details
    });
    recoveredHistory += 1;
  }

  if (recoveredOccurrences || recoveredHistory) {
    service.logger?.warn?.('Interrupted scheduler workflows were reconciled without replay.', {
      recoveredOccurrences,
      recoveredHistory
    });
  }

  return Object.freeze({ recoveredOccurrences, recoveredHistory });
}

function actionEnvelope(service, schedule, server, operation, payload, historyId, stage) {
  if (!capabilityForSchedulerOperation(operation)) return null;
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
    requiredCapabilities: [],
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
  const originalActionAcrossServers = prototype.actionAcrossServers;
  const originalStart = prototype.start;

  prototype.start = function nexusCoreSchedulerStart(...args) {
    recoverInterruptedSchedulerState(this);
    return originalStart.apply(this, args);
  };

  prototype.actionAcrossServers = async function nexusCoreActionAcrossServers(schedule, servers, operation, payload, historyId, stage) {
    const capability = capabilityForSchedulerOperation(operation);
    if (!capability) return originalActionAcrossServers.call(this, schedule, servers, operation, payload, historyId, stage);

    const core = runtimeFor(this);
    const results = [];
    for (const server of servers) {
      const operationPayload = typeof payload === 'function' ? payload(server) : payload;
      try {
        const request = actionEnvelope(this, schedule, server, operation, operationPayload, historyId, stage);
        const result = await core.commandGateway.dispatch(request, {
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
  capabilityForSchedulerOperation,
  requiredCapabilitiesForSchedulerAction,
  recoverInterruptedSchedulerState,
  INTERRUPTED_SUMMARY
};
