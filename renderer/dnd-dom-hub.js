'use strict';

(() => {
  if (window.khaosDndDomHub?.subscribe) return;
  const listeners = new Set();
  let observer = null;
  let scheduled = false;

  function notify(mutations = []) {
    scheduled = false;
    for (const listener of [...listeners]) {
      try { listener(mutations); }
      catch (error) { console.error('[Khaos Nexus] D&D DOM hub subscriber failed.', error); }
    }
  }

  function schedule(mutations = []) {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => notify(mutations));
  }

  function installObserver() {
    if (observer) return;
    const root = document.querySelector('main.content') || document.body;
    if (!root) return;
    observer = new MutationObserver((mutations) => schedule(mutations));
    observer.observe(root, { childList: true, subtree: true });
  }

  function subscribe(listener, options = {}) {
    if (typeof listener !== 'function') return () => {};
    installObserver();
    listeners.add(listener);
    if (options.immediate !== false) queueMicrotask(() => {
      if (listeners.has(listener)) listener([]);
    });
    return () => listeners.delete(listener);
  }

  window.khaosDndDomHub = Object.freeze({
    subscribe,
    getSubscriberCount: () => listeners.size
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installObserver, { once: true });
  else installObserver();

  window.addEventListener('beforeunload', () => {
    observer?.disconnect();
    observer = null;
    listeners.clear();
  }, { once: true });
})();
