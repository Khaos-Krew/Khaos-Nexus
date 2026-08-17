'use strict';

const crypto = require('node:crypto');
const { validateSchema } = require('./schema-validator.cjs');
const { evaluateCapabilities } = require('./capability-registry.cjs');
const { sanitizeContext } = require('./context-broker.cjs');

const TOOL_MODES = new Set(['read', 'propose', 'execute', 'approval-required']);

function toolError(message, code = 'NEXUS_AI_TOOL_INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function stableToken(value, field) {
  const text = String(value || '').trim();
  if (!text || text.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(text)) throw toolError(`${field} must be a stable token.`);
  return text;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

class AiToolGateway {
  constructor(options = {}) {
    if (!options.commandGateway) throw toolError('commandGateway is required.');
    this.commandGateway = options.commandGateway;
    this.journal = options.journal || null;
    this.approvalVerifier = typeof options.approvalVerifier === 'function' ? options.approvalVerifier : null;
    this.now = options.now || (() => new Date().toISOString());
    this.idFactory = options.idFactory || (() => crypto.randomUUID());
    this.tools = new Map();
  }

  register(nameInput, definition = {}) {
    const name = stableToken(nameInput, 'tool name');
    if (this.tools.has(name)) throw toolError(`AI tool ${name} is already registered.`, 'NEXUS_AI_TOOL_EXISTS');
    const mode = String(definition.mode || 'read');
    if (!TOOL_MODES.has(mode)) throw toolError(`AI tool ${name} has unsupported mode ${mode}.`);
    if (!definition.inputSchema || typeof definition.inputSchema !== 'object') throw toolError(`AI tool ${name} requires an input schema.`);
    const requiredCapabilities = [...new Set((definition.requiredCapabilities || []).map(String))].sort();
    const handler = typeof definition.handler === 'function' ? definition.handler : null;
    const toAction = typeof definition.toAction === 'function' ? definition.toAction : null;
    if (['read', 'propose'].includes(mode) && !handler) throw toolError(`${name} requires a handler.`);
    if (['execute', 'approval-required'].includes(mode) && !toAction) throw toolError(`${name} requires a toAction mapper.`);

    this.tools.set(name, Object.freeze({
      name,
      mode,
      inputSchema: definition.inputSchema,
      requiredCapabilities: Object.freeze(requiredCapabilities),
      handler,
      toAction
    }));
    return this;
  }

  audit(type, call, definition, payload = {}) {
    if (!this.journal?.append) return null;
    const correlationId = stableToken(call.correlationId || `ai-${this.idFactory()}`, 'correlationId');
    const toolCallId = stableToken(call.toolCallId || `tool-${this.idFactory()}`, 'toolCallId');
    return this.journal.append({
      eventId: `evt-${this.idFactory()}`,
      type,
      occurredAt: this.now(),
      scope: { kind: 'ai-tool-call', id: toolCallId },
      actor: call.actor || { kind: 'system', id: 'nexus-core' },
      source: { kind: 'ai-worker', id: stableToken(call.workerId, 'workerId') },
      correlationId,
      causationId: toolCallId,
      payload: {
        tool: definition.name,
        mode: definition.mode,
        ...payload
      }
    });
  }

  deny(call, definition, reason, message) {
    this.audit('core.ai.tool.denied', call, definition, { reason });
    throw toolError(message, 'NEXUS_AI_TOOL_DENIED');
  }

  async verifiedApproval(call, definition, args, subject) {
    if (definition.mode !== 'approval-required') return { subject, approval: null };
    if (!this.approvalVerifier) this.deny(call, definition, 'approval-verifier-unavailable', 'This AI tool requires human approval, but no approval verifier is configured.');
    const decision = await this.approvalVerifier(call.approval || null, {
      workerId: call.workerId,
      tool: definition.name,
      correlationId: call.correlationId,
      actor: call.actor || null,
      args,
      subject
    });
    if (!decision?.approved) this.deny(call, definition, 'approval-required', 'Human approval is required for this AI tool.');
    if (!decision.subject || typeof decision.subject !== 'object') this.deny(call, definition, 'approval-subject-missing', 'Approved AI tool execution did not receive a scoped execution subject.');
    return {
      subject: decision.subject,
      approval: {
        approvalId: String(decision.approvalId || ''),
        approvedBy: String(decision.approvedBy || ''),
        approvedAt: String(decision.approvedAt || this.now())
      }
    };
  }

  async invoke(call = {}, subject = {}) {
    const workerId = stableToken(call.workerId, 'workerId');
    const toolName = stableToken(call.tool, 'tool');
    const definition = this.tools.get(toolName);
    if (!definition) throw toolError(`AI tool ${toolName} is not registered.`, 'NEXUS_AI_TOOL_NOT_FOUND');
    const args = freeze(validateSchema(definition.inputSchema, call.args ?? {}));

    const toolDecision = evaluateCapabilities(subject, definition.requiredCapabilities);
    if (!toolDecision.allowed && definition.mode !== 'approval-required') {
      this.deny(call, definition, 'missing-capability', `AI tool ${toolName} requires capabilities: ${toolDecision.denied.join(', ') || toolDecision.unknown.join(', ')}.`);
    }

    this.audit('core.ai.tool.requested', { ...call, workerId }, definition, {
      requiredCapabilities: definition.requiredCapabilities
    });

    if (definition.mode === 'read' || definition.mode === 'propose') {
      const output = sanitizeContext(await definition.handler(args, { ...call, workerId, subject }) ?? {}, `ai-tool:${toolName}`);
      this.audit(definition.mode === 'read' ? 'core.ai.tool.read' : 'core.ai.tool.proposed', { ...call, workerId }, definition, { status: 'succeeded' });
      return freeze({
        tool: toolName,
        mode: definition.mode,
        status: 'succeeded',
        output
      });
    }

    const approved = await this.verifiedApproval({ ...call, workerId }, definition, args, subject);
    const executionSubject = approved.subject;
    const executionDecision = evaluateCapabilities(executionSubject, definition.requiredCapabilities);
    if (!executionDecision.allowed) {
      this.deny(call, definition, 'execution-subject-denied', `Approved execution still lacks capabilities: ${executionDecision.denied.join(', ') || executionDecision.unknown.join(', ')}.`);
    }

    const mapped = await definition.toAction(args, { ...call, workerId, subject: executionSubject, approval: approved.approval });
    if (!mapped || typeof mapped !== 'object') throw toolError(`${toolName} did not produce a Core action.`);
    if (!mapped.idempotencyKey) throw toolError(`${toolName} must provide a stable idempotencyKey.`, 'NEXUS_AI_TOOL_IDEMPOTENCY_REQUIRED');
    if (!mapped.action) throw toolError(`${toolName} must provide an action name.`);
    if (!mapped.scope) throw toolError(`${toolName} must provide an action scope.`);

    const correlationId = stableToken(call.correlationId || `ai-${this.idFactory()}`, 'correlationId');
    const operationId = stableToken(mapped.operationId || `ai-op-${this.idFactory()}`, 'operationId');
    const action = {
      operationId,
      action: mapped.action,
      requestedAt: this.now(),
      scope: mapped.scope,
      actor: call.actor || { kind: 'ai-worker', id: workerId },
      source: { kind: 'ai-worker', id: workerId },
      correlationId,
      idempotencyKey: mapped.idempotencyKey,
      requiredCapabilities: definition.requiredCapabilities,
      input: mapped.input ?? args
    };

    const result = await this.commandGateway.dispatch(action, executionSubject);
    this.audit('core.ai.tool.executed', { ...call, workerId, correlationId }, definition, {
      operationId,
      status: result.status,
      approvalId: approved.approval?.approvalId || null
    });
    return freeze({
      tool: toolName,
      mode: definition.mode,
      status: result.status,
      operationId,
      output: sanitizeContext(result.output ?? {}, `ai-tool:${toolName}:result`),
      error: result.error ? sanitizeContext(result.error, `ai-tool:${toolName}:error`) : null
    });
  }
}

module.exports = {
  AiToolGateway,
  TOOL_MODES
};
