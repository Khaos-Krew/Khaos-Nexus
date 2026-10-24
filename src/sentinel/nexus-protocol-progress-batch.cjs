'use strict';

const {
  normalizeProgressEvent,
  progressEventFingerprint
} = require('./nexus-protocol-progress.cjs');

function appendProgressBatch(ledger, inputs = []) {
  if (!ledger || typeof ledger.append !== 'function' || typeof ledger.snapshot !== 'function') {
    throw new Error('Protocol progress batch requires a ledger');
  }
  if (!Array.isArray(inputs) || !inputs.length) {
    throw new Error('Protocol progress batch requires events');
  }

  const snapshot = ledger.snapshot();
  const existingFingerprints = new Map((snapshot.events || []).map((event) => [
    normalizeProgressEvent(event).id,
    progressEventFingerprint(event)
  ]));
  const staged = new Map();
  const ordered = [];

  for (const input of inputs) {
    const event = normalizeProgressEvent(input);
    const fingerprint = progressEventFingerprint(event);
    const existingFingerprint = existingFingerprints.get(event.id);
    if (existingFingerprint) {
      if (existingFingerprint !== fingerprint) {
        throw new Error('Conflicting Protocol progress event replay in batch');
      }
      ordered.push({ event, fingerprint, duplicate: true });
      continue;
    }

    if (staged.has(event.id)) {
      if (staged.get(event.id) !== fingerprint) {
        throw new Error('Conflicting Protocol progress event replay within batch');
      }
      ordered.push({ event, fingerprint, duplicate: true });
      continue;
    }

    staged.set(event.id, fingerprint);
    ordered.push({ event, fingerprint, duplicate: false });
  }

  const currentCount = Array.isArray(snapshot.events) ? snapshot.events.length : 0;
  const maxEvents = Number(ledger.maxEvents);
  if (!Number.isInteger(maxEvents) || maxEvents < currentCount || currentCount + staged.size > maxEvents) {
    throw new Error('Protocol progress ledger capacity exceeded; batch rejected before mutation');
  }

  const results = [];
  const committed = new Set();
  for (const item of ordered) {
    if (item.duplicate || committed.has(item.event.id)) {
      results.push({ inserted: false, event: { ...item.event } });
      continue;
    }
    const result = ledger.append(item.event);
    results.push(result);
    if (result.inserted) committed.add(item.event.id);
  }

  return Object.freeze({
    accepted: true,
    requestedEvents: inputs.length,
    insertedEvents: committed.size,
    duplicateEvents: inputs.length - committed.size,
    results: Object.freeze(results.map((result) => Object.freeze({
      inserted: Boolean(result.inserted),
      event: Object.freeze({ ...result.event })
    })))
  });
}

module.exports = { appendProgressBatch };
