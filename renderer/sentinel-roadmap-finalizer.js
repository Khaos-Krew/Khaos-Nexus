'use strict';

(() => {
  if (window.__nexusSentinelRoadmapFinalizerInstalled) return;
  window.__nexusSentinelRoadmapFinalizerInstalled = true;

  const DEFERRED_IDS = new Set(['palworld-companion']);
  let scheduled = false;

  function statusCounts() {
    const counts = { operational: 0, migrating: 0, disabled: 0, blocked: 0 };
    document.querySelectorAll('#sentinelModuleCenter [data-sentinel-module]').forEach((card) => {
      if (card.classList.contains('status-operational')) counts.operational += 1;
      else if (card.classList.contains('status-migrating')) counts.migrating += 1;
      else if (card.classList.contains('status-disabled')) counts.disabled += 1;
      else if (card.classList.contains('status-blocked')) counts.blocked += 1;
    });
    return counts;
  }

  function setSummary(counts) {
    const summary = document.querySelector('#sentinelModuleCenter .sentinel-module-summary');
    if (summary) {
      const cards = [...summary.querySelectorAll('.sentinel-roadmap-status')];
      const values = [counts.operational, counts.migrating, counts.disabled, counts.blocked];
      cards.forEach((card, index) => {
        const strong = card.querySelector('strong');
        if (strong && values[index] !== undefined) strong.textContent = String(values[index]);
      });
    }

    const dashboard = [...document.querySelectorAll('#sentinelTestRoadmap .sentinel-roadmap-status')]
      .find((card) => /^Modules$/i.test(String(card.querySelector('span')?.textContent || '').trim()));
    if (dashboard) {
      const strong = dashboard.querySelector('strong');
      const detail = dashboard.querySelector('small');
      if (strong) strong.textContent = `${counts.operational} operational`;
      if (detail) detail.textContent = `${counts.migrating} in progress • ${counts.disabled} disabled • ${counts.blocked} blocked`;
    }
  }

  function apply() {
    scheduled = false;
    for (const id of DEFERRED_IDS) {
      document.querySelectorAll(`#sentinelModuleCenter [data-sentinel-module="${id}"]`).forEach((card) => card.remove());
    }

    const centerHero = document.querySelector('#sentinelModuleCenter .sentinel-module-hero p');
    if (centerHero) centerHero.textContent = 'Only completed Discord, Palworld server-management, and supporting desktop systems in the current Nexus Sentinel product are shown.';

    const heading = document.querySelector('#sentinelTestRoadmap .sentinel-roadmap-heading');
    if (heading && !heading.querySelector('.sentinel-roadmap-complete')) {
      const badge = document.createElement('span');
      badge.className = 'tag good sentinel-roadmap-complete';
      badge.textContent = '11 phases implemented';
      heading.appendChild(badge);
    }

    setSummary(statusCounts());
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(apply);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
  else schedule();
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
})();
