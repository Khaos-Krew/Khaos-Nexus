'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { validDiscordId } = require('./ark-identity-store.cjs');

const MAX_AUDIT_ENTRIES = 10_000;
const STATES = Object.freeze(['pending', 'verified', 'rejected']);

function cleanId(value, max = 128) {
  return String(value || '').replace(/[\r\n\t]/g, '').trim().slice(0, max);
}

function cleanReason(value, max = 240) {
  return cleanId(value, max);
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function emptyState() {
  return { version: 1, members: {}, audit: [] };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeState(parsed) {
  if (!plainObject(parsed)) throw new Error('Member verification state root must be a JSON object.');
  if (parsed.version != null && parsed.version !== 1) {
    throw new Error(`Unsupported member verification state version: ${String(parsed.version).slice(0, 24)}.`);
  }
  if (parsed.members != null && !plainObject(parsed.members)) {
    throw new Error('Member verification state field members must be an object.');
  }
  if (parsed.audit != null && !Array.isArray(parsed.audit)) {
    throw new Error('Member verification state field audit must be an array.');
  }
  return {
    version: 1,
    members: parsed.members || {},
    audit: (parsed.audit || []).slice(-MAX_AUDIT_ENTRIES)
  };
}

class MemberVerificationStore {
  constructor(options = {}) {
    const root = options.root || process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..', 'data');
    this.dir = path.resolve(root);
    this.file = path.join(this.dir, 'member-verifications.json');
    this.now = typeof options.now === 'function' ? options.now : Date.now;
  }

  read() {
    let raw;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyState();
      throw error;
    }
    return normalizeState(JSON.parse(raw));
  }

  write(state) {
    fs.mkdirSync(this.dir, { recursive: true });
    const safe = {
      version: 1,
      updatedAt: new Date(this.now()).toISOString(),
      members: state.members || {},
      audit: (state.audit || []).slice(-MAX_AUDIT_ENTRIES)
    };
    normalizeState(safe);
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(safe, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    return safe;
  }

  audit(state, action, details = {}) {
    state.audit.push({
      id: crypto.randomUUID(),
      action,
      at: new Date(this.now()).toISOString(),
      ...details
    });
  }

  get(discordUserId) {
    const discordId = cleanId(discordUserId);
    if (!validDiscordId(discordId)) return null;
    const row = this.read().members[discordId];
    return row ? clone(row) : null;
  }

  ensurePending(discordUserId, { actorId = 'system', reason = 'first-touch' } = {}) {
    const discordId = cleanId(discordUserId);
    if (!validDiscordId(discordId)) throw new Error('A valid Discord user id is required.');
    const state = this.read();
    const existing = state.members[discordId];
    if (existing) return clone(existing);
    const nowIso = new Date(this.now()).toISOString();
    const row = {
      discordUserId: discordId,
      state: 'pending',
      updatedAt: nowIso,
      updatedBy: cleanId(actorId),
      reason: cleanReason(reason),
      createdAt: nowIso
    };
    state.members[discordId] = row;
    this.audit(state, 'member-verify-ensure-pending', {
      actorId: cleanId(actorId),
      targetId: discordId,
      priorState: null,
      newState: 'pending',
      reason: cleanReason(reason)
    });
    this.write(state);
    return clone(row);
  }

  _transition(discordUserId, nextState, { actorId, reason, allowedFrom, action } = {}) {
    const discordId = cleanId(discordUserId);
    if (!validDiscordId(discordId)) throw new Error('A valid Discord user id is required.');
    if (!STATES.includes(nextState)) throw new Error(`Invalid member verification state: ${nextState}`);
    const actor = cleanId(actorId);
    if (!validDiscordId(actor) && actor !== 'system') throw new Error('A valid actor Discord user id is required.');
    const why = cleanReason(reason);
    if ((nextState === 'rejected' || action === 'member-verify-revoke' || action === 'member-verify-reject') && !why) {
      throw new Error('A non-empty reason is required.');
    }
    const state = this.read();
    let row = state.members[discordId];
    if (!row) {
      const nowIso = new Date(this.now()).toISOString();
      row = {
        discordUserId: discordId,
        state: 'pending',
        updatedAt: nowIso,
        updatedBy: 'system',
        reason: 'first-touch',
        createdAt: nowIso
      };
      state.members[discordId] = row;
    }
    const priorState = row.state;
    // Never auto-verify; rejected → verified is disallowed (must reopen to pending first).
    if (nextState === 'verified' && priorState === 'rejected') {
      return { ok: false, reason: 'rejected-must-reopen', priorState, state: priorState };
    }
    if (Array.isArray(allowedFrom) && !allowedFrom.includes(priorState)) {
      return { ok: false, reason: 'invalid-transition', priorState, state: priorState };
    }
    if (priorState === nextState) {
      return { ok: true, unchanged: true, record: clone(row) };
    }
    row.state = nextState;
    row.updatedAt = new Date(this.now()).toISOString();
    row.updatedBy = actor;
    row.reason = why || row.reason || '';
    row.priorState = priorState;
    this.audit(state, action, {
      actorId: actor,
      targetId: discordId,
      priorState,
      newState: nextState,
      reason: why || ''
    });
    this.write(state);
    return { ok: true, record: clone(row), priorState, newState: nextState };
  }

  grant(discordUserId, { actorId, reason = 'admin-grant' } = {}) {
    return this._transition(discordUserId, 'verified', {
      actorId,
      reason: reason || 'admin-grant',
      allowedFrom: ['pending'],
      action: 'member-verify-grant'
    });
  }

  reject(discordUserId, { actorId, reason } = {}) {
    return this._transition(discordUserId, 'rejected', {
      actorId,
      reason,
      allowedFrom: ['pending'],
      action: 'member-verify-reject'
    });
  }

  revoke(discordUserId, { actorId, reason } = {}) {
    return this._transition(discordUserId, 'rejected', {
      actorId,
      reason,
      allowedFrom: ['verified'],
      action: 'member-verify-revoke'
    });
  }

  reopen(discordUserId, { actorId, reason = 'admin-reopen' } = {}) {
    return this._transition(discordUserId, 'pending', {
      actorId,
      reason: reason || 'admin-reopen',
      allowedFrom: ['rejected'],
      action: 'member-verify-reopen'
    });
  }

  /** Alias for admin reopenToPending. */
  reopenToPending(discordUserId, options = {}) {
    return this.reopen(discordUserId, options);
  }
}

module.exports = {
  MAX_AUDIT_ENTRIES,
  STATES,
  emptyState,
  MemberVerificationStore
};
