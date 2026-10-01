'use strict';

const AFK_UNCHANGED_MS = 5 * 60 * 1000;

function rotationKey(rotation) {
  if (!Array.isArray(rotation) || rotation.length < 2) return '';
  if (rotation.some((value) => !Number.isFinite(Number(value)))) return '';
  return rotation.map((value) => Number(value)).join(',');
}

class McAfkTracker {
  constructor({ timeoutMs = AFK_UNCHANGED_MS } = {}) {
    this.timeoutMs = timeoutMs;
    this.samples = new Map();
  }

  observe(uuid, sample = {}, nowMs = Date.now()) {
    const id = String(uuid || '');
    const rotation = rotationKey(sample.rotation);
    const interactions = Number.isFinite(Number(sample.interactions)) ? Number(sample.interactions) : null;
    const ftbKnownOff = sample.ftbAfk === false;
    if (sample.ftbAfk === true) {
      this.samples.set(id, { rotation, interactions, since: nowMs, afk: true });
      return { afk: true, since: nowMs, reason: 'ftb-afk' };
    }
    const hasSignal = (rotation && ftbKnownOff) || interactions != null;
    if (!hasSignal) return { afk: true, since: nowMs, reason: 'signal-missing' };
    const previous = this.samples.get(id);
    const rotationActive = Boolean(rotation && ftbKnownOff && previous && previous.rotation !== rotation);
    const interactionActive = interactions != null && previous && previous.interactions != null && interactions > previous.interactions;
    if (!previous || rotationActive || interactionActive) {
      this.samples.set(id, { rotation, interactions, since: nowMs });
      return { afk: false, since: nowMs, reason: 'input' };
    }
    const afk = nowMs - previous.since >= this.timeoutMs;
    this.samples.set(id, { rotation: rotation || previous.rotation, interactions: interactions ?? previous.interactions, since: previous.since });
    return { afk, since: previous.since, reason: afk ? 'unchanged' : 'input' };
  }

  forget(uuid) {
    this.samples.delete(String(uuid || ''));
  }
}

module.exports = { AFK_UNCHANGED_MS, rotationKey, McAfkTracker };
