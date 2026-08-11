'use strict';

const crypto = require('node:crypto');
const { makeAction, makeResult } = require('./contracts.cjs');
const { evaluateCapabilities } = require('./capability-registry.cjs');

function gatewayError(message, code = 'NEXUS_COMMAND_GATEWAY_INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeError(error) {
  return {
    code: String(error?.code || 'NEXUS_ACTION_FAILED'),
    message: String(error?.message || error || 'Action failed.').slice(0, 2000)
  };
}

class CommandGateway {
  constructor(options = {}) {
    if (!options.operationStore) throw gatewayError('operationStore is required.');
    if (!options.journal) throw gatewayError('journal is required.');
    this.operationStore = options.operationStore;
    this.journal = options.journal;
    this.now = options.now || (() => new Date().toISOString());
    this.idFactory = options.idFactory || (() => crypto.randomUUID());
    this.executors = new Map();
  }

  register(actionName, definition = {}) {
    const name = String(actionName || '').trim();
    if (!name) throw gatewayError('actionName is required.');
    if (typeof definition.execute !== 'function') throw gatewayError(`${name} requires an execute function.`);
    if (this.executors.has(name)) throw gatewayError(`${name} is already registered.`, 'NEXUS_ACTION_ALREADY_REGISTERED');
    const requiredCapabilities = [...new Set((definition.requiredCapabilities || []).map(String))].sort();
    this.executors.set(name, Object.freeze({
      requiredCapabilities: Object.freeze(requiredCapabilities),
      execute: definition.execute,
      verify: typeof definition.verify === 'function' ? definition.verify : null
    }));
    return this;
  }

  event(action, type, payload = {}) {
    return this.journal.append({
      eventId: `evt-${this.idFactory()}`,
      type,
      occurredAt: this.now(),
      scope: action.scope,
      actor: action.actor,
      source: { kind: 'nexus-core', id: 'command-gateway' },
      correlationId: action.correlationId,
      causationId: action.operationId,
      payload: {
        operationId: action.operationId,
        action: action.action,
        ...payload
      }
    });
  }

  async dispatch(input, subject = {}) {
    const action = makeAction(input);
    const definition = this.executors.get(action.action);
    if (!definition) throw gatewayError(`No executor is registered for ${action.action}.`, 'NEXUS_ACTION_NOT_REGISTERED');

    const requiredCapabilities = [...new Set([
      ...definition.requiredCapabilities,
      ...action.requiredCapabilities
    ])].sort();

    this.event(action, 'core.action.requested', { requiredCapabilities });

    const capabilityDecision = evaluateCapabilities(subject, requiredCapabilities);
    if (!capabilityDecision.allowed) {
      const result = makeResult({
        operationId: action.operationId,
        completedAt: this.now(),
        correlationId: action.correlationId,
        status: 'denied',
        output: {},
        error: {
          code: 'NEXUS_CAPABILITY_DENIED',
          message: `Missing capabilities: ${capabilityDecision.denied.join(', ') || capabilityDecision.unknown.join(', ')}.`
        }
      });
      this.event(action, 'core.action.denied', {
        reason: capabilityDecision.reason,
        deniedCapabilities: capabilityDecision.denied,
        unknownCapabilities: capabilityDecision.unknown
      });
      return result;
    }

    const acquisition = this.operationStore.begin(action);
    if (!acquisition.acquired) {
      const result = makeResult({
        operationId: action.operationId,
        completedAt: this.now(),
        correlationId: action.correlationId,
        status: 'duplicate',
        output: {
          originalOperationId: acquisition.record?.operationId || null,
          originalState: acquisition.record?.state || null,
          originalResultStatus: acquisition.record?.resultStatus || null
        },
        error: null
      });
      this.event(action, 'core.action.duplicate', {
        originalOperationId: acquisition.record?.operationId || null,
        originalState: acquisition.record?.state || null,
        originalResultStatus: acquisition.record?.resultStatus || null
      });
      return result;
    }

    let result;
    try {
      const output = await definition.execute(action, subject);
      if (definition.verify) {
        const verification = await definition.verify(output, action, subject);
        if (verification === false) throw gatewayError('Action verification failed.', 'NEXUS_ACTION_VERIFICATION_FAILED');
      }
      result = makeResult({
        operationId: action.operationId,
        completedAt: this.now(),
        correlationId: action.correlationId,
        status: 'succeeded',
        output: output ?? {},
        error: null
      });
    } catch (error) {
      result = makeResult({
        operationId: action.operationId,
        completedAt: this.now(),
        correlationId: action.correlationId,
        status: 'failed',
        output: {},
        error: normalizeError(error)
      });
    }

    this.operationStore.complete(action, result);
    this.event(action, result.status === 'succeeded' ? 'core.action.succeeded' : 'core.action.failed', {
      status: result.status,
      errorCode: result.error?.code || null
    });
    return result;
  }
}

module.exports = {
  CommandGateway,
  normalizeError
};
