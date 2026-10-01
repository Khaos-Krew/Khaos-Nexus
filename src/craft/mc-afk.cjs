'use strict';

const AFK_UNCHANGED_MS = 5 * 60 * 1000;

function sampleKey(pos, rotation) {
  if (!Array.isArray(pos) || !Array.isArray(rotation)) return '';
  return `${pos.join(',')}|${rotation.join(',')}`;
}

class McAfkTracker {
  constructor({ timeoutMs = AFK_UNCHANGED_MS } = {}) {
    this.timeoutMs = timeoutMs;
    this.samples = new Map();
  }

  observe(uuid, pos, rotation, nowMs) {
    const key = sampleKey(pos, rotation);
    if (!key) return { afk: false, reason: 'no-sample' };
    const id = String(uuid || '');
    const previous = this.samples.get(id);
    if (!previous || previous.key !== key) {
      this.samples.set(id, { key, since: nowMs });
      return { afk: false, since: nowMs };
    }
    const afk = nowMs - previous.since >= this.timeoutMs;
    return { afk, since: previous.since };
  }

  forget(uuid) {
    this.samples.delete(String(uuid || ''));
  }
}

module.exports = { AFK_UNCHANGED_MS, sampleKey, McAfkTracker };
