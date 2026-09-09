'use strict';

class ActionGate {
  constructor({ mutationEnabled = false, dryRun = true, allow = [] } = {}) {
    this.mutationEnabled = Boolean(mutationEnabled);
    this.dryRun = Boolean(dryRun);
    this.allow = new Set((Array.isArray(allow) ? allow : []).map((item) => String(item).trim()).filter(Boolean));
  }

  authorize({ capability, destructive = false, approvalGranted = false } = {}) {
    const name = String(capability || '').trim();
    if (!name) return { allowed: false, reason: 'missing-capability' };
    if (!this.mutationEnabled) return { allowed: false, reason: 'mutations-disabled' };
    if (this.dryRun) return { allowed: false, reason: 'dry-run' };
    if (this.allow.size && !this.allow.has(name)) return { allowed: false, reason: 'not-allowlisted' };
    if (destructive && !approvalGranted) return { allowed: false, reason: 'approval-required' };
    return { allowed: true, reason: 'authorized' };
  }
}

class ActionController {
  constructor({ gate, store, logger } = {}) {
    if (!gate || typeof gate.authorize !== 'function') throw new TypeError('action gate is required');
    if (!store || typeof store.request !== 'function') throw new TypeError('action store is required');
    this.gate = gate;
    this.store = store;
    this.logger = logger;
  }

  async submit(input = {}, handler) {
    const authorization = this.gate.authorize(input);
    const initialStatus = authorization.allowed
      ? 'requested'
      : authorization.reason === 'approval-required'
        ? 'approval-required'
        : 'blocked';

    const action = await this.store.request({ ...input, initialStatus });
    this.#logDecision(action, authorization);

    if (!authorization.allowed) {
      return { ok: false, executed: false, action, authorization };
    }

    if (typeof handler !== 'function') {
      return { ok: true, executed: false, action, authorization, ready: true };
    }

    return this.#execute(action, handler, authorization);
  }

  async approveAndExecute(action, { actor, reason } = {}, handler) {
    if (!action?.actionId) throw new TypeError('action record is required');
    if (!action.destructive) throw new Error('approval execution is only valid for destructive actions');
    if (typeof handler !== 'function') throw new TypeError('action handler is required');

    const approval = await this.store.decideApproval(action.actionId, { approved: true, actor, reason });
    if (approval?.persisted === false) {
      const authorization = { allowed: false, reason: 'approval-not-durable' };
      this.#logDecision(action, authorization);
      return { ok: false, executed: false, action, approval, authorization };
    }

    const authorization = this.gate.authorize({
      capability: action.capability,
      destructive: true,
      approvalGranted: true,
    });
    this.#logDecision(action, authorization);
    if (!authorization.allowed) {
      return { ok: false, executed: false, action, approval, authorization };
    }

    return this.#execute(action, handler, authorization, { approval });
  }

  async deny(action, { actor, reason } = {}) {
    if (!action?.actionId) throw new TypeError('action record is required');
    const approval = await this.store.decideApproval(action.actionId, { approved: false, actor, reason });
    return { ok: true, executed: false, action, approval, authorization: { allowed: false, reason: 'approval-denied' } };
  }

  async #execute(action, handler, authorization, extra = {}) {
    const attempt = 1;
    await this.store.startAttempt(action.actionId, attempt);
    try {
      const result = await handler({ action, attempt });
      const completed = await this.store.complete(action.actionId, { status: 'succeeded', result, attempt });
      return { ok: true, executed: true, action: completed, authorization, result, ...extra };
    } catch (error) {
      const completed = await this.store.complete(action.actionId, { status: 'failed', attempt, error });
      this.logger?.error?.('sentinel.action.execution_failed', {
        actionId: action.actionId,
        capability: action.capability,
        error: { message: String(error?.message || error) },
      });
      return { ok: false, executed: true, action: completed, authorization, error, ...extra };
    }
  }

  #logDecision(action, authorization) {
    this.logger?.info?.('sentinel.action.authorization', {
      actionId: action?.actionId,
      capability: action?.capability,
      destructive: Boolean(action?.destructive),
      allowed: Boolean(authorization?.allowed),
      reason: authorization?.reason,
    });
  }
}

module.exports = { ActionGate, ActionController };
