'use strict';

const listeners = new Set();

function onPublicServersChanged(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyPublicServersChanged(reason = 'change') {
  for (const listener of listeners) {
    try { listener(String(reason || 'change')); } catch {}
  }
}

module.exports = { onPublicServersChanged, notifyPublicServersChanged };
