'use strict';

const AFK_UNCHANGED_MS = 5 * 60 * 1000;

function vectorKey(vector) {
  if (!Array.isArray(vector) || vector.length < 2) return '';
  if (vector.some((value) => !Number.isFinite(Number(value)))) return '';
  return vector.map((value) => Number(value)).join(',');
}

class McAfkTracker {
  constructor({ timeoutMs = AFK_UNCHANGED_MS } = {}) {
    this.timeoutMs = timeoutMs;
    this.samples = new Map();
  }

  observe(uuid, sample = {}, nowMs = Date.now()) {
    const id = String(uuid || '');
    const position = vectorKey(sample.position);
    const rotation = vectorKey(sample.rotation);
    if (sample.datapackAfk === true) {
      const previous = this.samples.get(id);
      const since = previous?.since ?? nowMs;
      this.samples.set(id, { position: position || previous?.position || '', rotation: rotation || previous?.rotation || '', since });
      return { afk: true, since, reason: 'datapack-afk' };
    }
    if (!position || !rotation) return { afk: true, since: nowMs, reason: 'signal-missing' };
    const previous = this.samples.get(id);
    const moved = Boolean(previous && (previous.position !== position || previous.rotation !== rotation));
    if (!previous || moved) {
      this.samples.set(id, { position, rotation, since: nowMs });
      return { afk: false, since: nowMs, reason: 'input' };
    }
    const afk = nowMs - previous.since >= this.timeoutMs;
    this.samples.set(id, { position, rotation, since: previous.since });
    return { afk, since: previous.since, reason: afk ? 'unchanged' : 'input' };
  }

  forget(uuid) {
    this.samples.delete(String(uuid || ''));
  }
}

module.exports = { AFK_UNCHANGED_MS, vectorKey, rotationKey: vectorKey, McAfkTracker };
