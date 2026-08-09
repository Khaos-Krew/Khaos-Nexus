'use strict';

(() => {
  if (window.__khaosRefreshStability?.installed) return;

  const NativeMutationObserver = window.MutationObserver;
  const LEGACY_NAV_SELECTOR = '.nav-item[data-view]:not(.nexus-nav-item)';

  function nodeContainsLegacyNavigation(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.matches?.(LEGACY_NAV_SELECTOR)) return true;
    return Boolean(node.querySelector?.(LEGACY_NAV_SELECTOR));
  }

  function isLegacyNavigationMutation(mutation) {
    return [...mutation.addedNodes, ...mutation.removedNodes].some(nodeContainsLegacyNavigation);
  }

  class ScopedMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.sidebarNavigationOnly = false;
      this.native = new NativeMutationObserver((mutations) => {
        const delivered = this.sidebarNavigationOnly
          ? mutations.filter(isLegacyNavigationMutation)
          : mutations;
        if (delivered.length) this.callback(delivered, this);
      });
    }

    observe(target, options) {
      this.sidebarNavigationOnly = Boolean(
        target?.matches?.('.sidebar') &&
        options?.childList === true &&
        options?.subtree === true
      );
      return this.native.observe(target, options);
    }

    disconnect() {
      return this.native.disconnect();
    }

    takeRecords() {
      const records = this.native.takeRecords();
      return this.sidebarNavigationOnly ? records.filter(isLegacyNavigationMutation) : records;
    }
  }

  if (typeof NativeMutationObserver === 'function') {
    window.MutationObserver = ScopedMutationObserver;
  }

  window.__khaosRefreshStability = Object.freeze({
    installed: true,
    legacyNavigationSelector: LEGACY_NAV_SELECTOR,
    isLegacyNavigationMutation
  });
})();