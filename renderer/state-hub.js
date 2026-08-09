'use strict';

(() => {
  if (window.khaosStateHub?.subscribe) return;
  const listeners = new Set();
  let current = null;
  let sequence = 0;
  let unsubscribe = null;

  function publish(next) {
    current = next;
    sequence += 1;
    for (const listener of [...listeners]) {
      try { listener(next); }
      catch (error) { console.error('[Khaos Nexus] State hub subscriber failed.', error); }
    }
  }

  function ensureSubscription() {
    if (unsubscribe || !window.khaos?.onState) return;
    unsubscribe = window.khaos.onState(publish);
  }

  function subscribe(listener, options = {}) {
    if (typeof listener !== 'function') return () => {};
    ensureSubscription();
    listeners.add(listener);
    if (options.replay && current !== null) queueMicrotask(() => {
      if (listeners.has(listener)) listener(current);
    });
    return () => listeners.delete(listener);
  }

  window.khaosStateHub = Object.freeze({
    subscribe,
    getCurrent: () => current,
    getSequence: () => sequence,
    getSubscriberCount: () => listeners.size
  });

  ensureSubscription();
  window.addEventListener('beforeunload', () => {
    try { unsubscribe?.(); } catch {}
    unsubscribe = null;
    listeners.clear();
  }, { once: true });
})();
