'use strict';

const path = require('node:path');
const { JsonStore, clone } = require('../core/json-store.cjs');
const { validatePollId } = require('./poll-model.cjs');

function defaultPollFile(dataDir = '') {
  const root = String(dataDir || process.env.NEXUS_DATA_DIR || path.join(process.cwd(), 'data'));
  return path.join(root, 'polls.json');
}

class PollStore {
  constructor(options = {}) {
    this.store = options.store || new JsonStore(options.filePath || defaultPollFile(options.dataDir), {
      schemaVersion: 1,
      nextSequence: 1,
      polls: {},
      hookLedger: {}
    });
  }

  allocateId() {
    return this.store.update((state) => {
      const sequence = Math.max(1, Math.trunc(Number(state.nextSequence || 1)));
      state.nextSequence = sequence + 1;
      return `POLL-${String(sequence).padStart(4, '0')}`;
    });
  }

  get(id) {
    const key = validatePollId(id);
    const value = this.store.read().polls?.[key] || null;
    return value ? clone(value) : null;
  }

  list(options = {}) {
    const statuses = Array.isArray(options.statuses) ? new Set(options.statuses.map((value) => String(value))) : null;
    const values = Object.values(this.store.read().polls || {})
      .filter((poll) => !statuses || statuses.has(String(poll.status)))
      .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    const limit = Number.isFinite(Number(options.limit)) ? Math.max(0, Math.trunc(Number(options.limit))) : values.length;
    return values.slice(0, limit).map(clone);
  }

  create(poll) {
    const id = validatePollId(poll?.id);
    return this.store.update((state) => {
      state.polls ||= {};
      if (state.polls[id]) throw new Error(`Poll ${id} already exists.`);
      state.polls[id] = clone(poll);
      return clone(state.polls[id]);
    });
  }

  replace(poll) {
    const id = validatePollId(poll?.id);
    return this.store.update((state) => {
      state.polls ||= {};
      if (!state.polls[id]) throw new Error(`Poll ${id} does not exist.`);
      if (state.polls[id].finalResult && JSON.stringify(state.polls[id].finalResult) !== JSON.stringify(poll.finalResult)) {
        throw new Error(`Poll ${id} final result is immutable.`);
      }
      state.polls[id] = clone(poll);
      return clone(state.polls[id]);
    });
  }

  update(id, mutator) {
    const key = validatePollId(id);
    if (typeof mutator !== 'function') throw new TypeError('PollStore update requires a mutator function.');
    return this.store.update((state) => {
      state.polls ||= {};
      const current = state.polls[key];
      if (!current) throw new Error(`Poll ${key} does not exist.`);
      const beforeFinal = current.finalResult ? JSON.stringify(current.finalResult) : '';
      const result = mutator(current) || current;
      const afterFinal = result.finalResult ? JSON.stringify(result.finalResult) : '';
      if (beforeFinal && beforeFinal !== afterFinal) throw new Error(`Poll ${key} final result is immutable.`);
      state.polls[key] = clone(result);
      return clone(state.polls[key]);
    });
  }

  hookDelivered(id, hookKey = 'completion') {
    const key = validatePollId(id);
    return Boolean(this.store.read().hookLedger?.[key]?.[hookKey]);
  }

  markHookDelivered(id, hookKey = 'completion', at = new Date().toISOString()) {
    const key = validatePollId(id);
    return this.store.update((state) => {
      state.hookLedger ||= {};
      state.hookLedger[key] ||= {};
      if (!state.hookLedger[key][hookKey]) state.hookLedger[key][hookKey] = String(at);
      return state.hookLedger[key][hookKey];
    });
  }
}

module.exports = {
  PollStore,
  defaultPollFile
};
