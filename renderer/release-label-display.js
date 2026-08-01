'use strict';

(() => {
  if (window.__khaosReleaseLabelLoaded) return;
  window.__khaosReleaseLabelLoaded = true;

  async function applyReleaseLabel() {
    try {
      const identity = await window.khaos.invoke('update-history:identity');
      const version = document.getElementById('versionLabel');
      if (version && identity?.currentLabel) version.textContent = `Version ${identity.currentLabel}`;
      document.documentElement.dataset.releaseChannel = identity?.channel || 'stable';
    } catch (error) {
      console.warn('[Khaos Nexus] Public release label was unavailable.', error?.message || error);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyReleaseLabel, { once: true });
  else applyReleaseLabel();
})();
