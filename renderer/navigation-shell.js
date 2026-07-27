'use strict';

(() => {
  if (window.__khaosNavigationShellInstalled) return;
  window.__khaosNavigationShellInstalled = true;

  // v0.18.16 safety quarantine:
  // The grouped-navigation implementation moved live navigation buttons between
  // containers while serialized desktop modules were still loading. The last
  // known-good v0.18.11 interface kept those buttons in their original DOM.
  // Preserve that stable structure until the grouped menu is rebuilt as a
  // static shell rather than a startup-time DOM migration.
  window.khaos?.reportBootStage?.('navigation-safe-mode', {
    mode: 'original-dom',
    reason: 'Dynamic navigation reparenting is temporarily disabled after the blank-interface regression.'
  });
})();
