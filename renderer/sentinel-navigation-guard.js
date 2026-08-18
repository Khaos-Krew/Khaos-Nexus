'use strict';

(() => {
  if (window.__nexusSentinelNavigationGuardInstalled) {
    window.applyNexusSentinelNavigationGuard?.();
    return;
  }
  window.__nexusSentinelNavigationGuardInstalled = true;

  const FORBIDDEN_VIEWS = new Set([
    'dnd',
    'ai',
    'ai-services',
    'nexus-ai',
    'scheduler',
    'hosted-servers',
    'mobile',
    'mobile-companion',
    'rust',
    'satisfactory'
  ]);

  const VIEW_ATTRIBUTES = Object.freeze([
    'data-view',
    'data-view-link',
    'data-view-proxy',
    'data-command-view',
    'data-khaos-open'
  ]);

  let applyQueued = false;

  function setText(node, value) {
    if (node && node.textContent !== value) node.textContent = value;
  }

  function viewFor(node) {
    if (!node) return '';
    for (const attribute of VIEW_ATTRIBUTES) {
      const value = String(node.getAttribute?.(attribute) || '').trim();
      if (value) return value;
    }
    return '';
  }

  function hideForbiddenNavigation() {
    const selector = VIEW_ATTRIBUTES.map((attribute) => `[${attribute}]`).join(',');
    document.querySelectorAll(selector).forEach((node) => {
      const view = viewFor(node);
      if (FORBIDDEN_VIEWS.has(view)) node.classList.add('sentinel-hidden');
    });

    for (const view of FORBIDDEN_VIEWS) {
      document.getElementById(`view-${view}`)?.classList.add('sentinel-hidden');
    }
  }

  function hideEmptyGeneratedGroups() {
    document.querySelectorAll('#nexusNavigation .nexus-nav-group').forEach((group) => {
      const buttons = [...group.querySelectorAll('.nav-item[data-view]')];
      const hasAllowed = buttons.some((button) => !FORBIDDEN_VIEWS.has(String(button.dataset.view || '')));
      group.classList.toggle('sentinel-hidden', buttons.length > 0 && !hasAllowed);
    });

    document.querySelectorAll('#nexusStaticNavigation .nexus-navigation-group').forEach((group) => {
      const buttons = [...group.querySelectorAll('[data-view-proxy]')];
      const hasAllowed = buttons.some((button) => !FORBIDDEN_VIEWS.has(String(button.dataset.viewProxy || '')));
      group.classList.toggle('sentinel-hidden', buttons.length > 0 && !hasAllowed);
    });
  }

  function relabelSentinelShell() {
    document.documentElement.dataset.nexusProduct = 'sentinel';
    document.documentElement.dataset.sentinelUiGuard = 'active';
    document.title = 'Khaos Nexus — Nexus Sentinel';

    const brand = document.querySelector('.brand');
    setText(brand?.querySelector('strong'), 'Khaos Nexus');
    setText(brand?.querySelector('span'), 'Discord + Palworld Control Center');

    setText(document.querySelector('.local-badge'), 'DISCORD + PALWORLD');

    const version = document.getElementById('versionLabel');
    if (version && !/Sentinel/i.test(version.textContent || '')) {
      setText(version, `${String(version.textContent || 'Version 0.32.0').trim()} • Sentinel`);
    }

    document.querySelectorAll('[data-navigation-group="servers"] .nexus-navigation-group-copy').forEach((copy) => {
      setText(copy.querySelector('strong'), 'Palworld Servers');
      setText(copy.querySelector('small'), 'Status, players, saves, and moderation');
    });

    document.querySelectorAll('#nexusNavigation [data-nav-group="servers"] .nexus-nav-label').forEach((label) => {
      setText(label, 'Palworld Servers');
    });

    document.querySelectorAll('[data-view="servers"], [data-view-proxy="servers"]').forEach((button) => {
      const strong = button.querySelector('strong');
      if (strong) setText(strong, 'Palworld Servers');
    });
  }

  function verifyScope() {
    const forbiddenVisible = [];
    const selector = VIEW_ATTRIBUTES.map((attribute) => `[${attribute}]`).join(',');
    document.querySelectorAll(selector).forEach((node) => {
      const view = viewFor(node);
      if (!FORBIDDEN_VIEWS.has(view)) return;
      const style = window.getComputedStyle(node);
      if (style.display !== 'none' && style.visibility !== 'hidden' && !node.hidden && node.getClientRects().length > 0) {
        forbiddenVisible.push(view);
      }
    });

    const unique = [...new Set(forbiddenVisible)];
    document.documentElement.dataset.sentinelUiReady = unique.length ? 'false' : 'true';
    return unique;
  }

  function apply() {
    applyQueued = false;
    hideForbiddenNavigation();
    hideEmptyGeneratedGroups();
    relabelSentinelShell();
    const forbiddenVisible = verifyScope();
    window.khaos?.reportBootStage?.('sentinel-ui-scope', {
      ready: forbiddenVisible.length === 0,
      forbiddenVisible
    });
  }

  function scheduleApply() {
    if (applyQueued) return;
    applyQueued = true;
    queueMicrotask(apply);
  }

  window.applyNexusSentinelNavigationGuard = apply;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
  else scheduleApply();

  window.addEventListener('load', scheduleApply, { once: true });
  window.addEventListener('khaos:features-ready', scheduleApply);

  const observer = new MutationObserver(scheduleApply);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
})();
