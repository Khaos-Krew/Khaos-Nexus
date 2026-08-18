'use strict';

(() => {
  const ACTIVE_MODULES = new Set([
    'discord-runtime', 'game-server-control', 'palworld-operations', 'operator-console',
    'application-monitor', 'backup-update-center', 'players-console', 'server-status-panels',
    'embed-studio', 'role-menus', 'color-roles', 'discord-organization',
    'discord-audit-logging', 'discord-observability', 'palworld-companion', 'admin-command-center'
  ]);
  const HIDDEN_VIEWS = new Set([
    'dnd', 'ai', 'ai-services', 'nexus-ai', 'scheduler', 'hosted-servers', 'mobile', 'mobile-companion',
    'rust', 'satisfactory'
  ]);
  const RELEVANT_SELECTOR = '.brand, [data-view], [data-view-link], #serverGame, #serverEditor, #nexusModuleCenter, #view-dashboard, #view-setup, #view-servers';

  let scopeTimer = null;
  let applying = false;

  function setNodeText(node, value) {
    if (!node) return;
    const next = String(value ?? '');
    if (node.textContent !== next) node.textContent = next;
  }

  function setText(selector, value) {
    setNodeText(document.querySelector(selector), value);
  }

  function scopeStaticShell() {
    document.documentElement.dataset.nexusProduct = 'sentinel';
    document.title = 'Khaos Nexus — Nexus Sentinel';
    setText('.brand strong', 'Khaos Nexus');
    setText('.brand span', 'Discord + Palworld Control Center');
    setText('#viewSubtitle', 'Run Nexus Sentinel, Discord automation, and Palworld moderation from this PC.');
    setText('#view-dashboard .hero-panel .eyebrow', 'Nexus Sentinel runtime');

    const start = document.getElementById('startButton');
    if (start && /^Start Bot$/i.test(start.textContent || '')) setNodeText(start, 'Start Sentinel');

    const setupIntro = document.querySelector('#view-setup .section-intro');
    if (setupIntro) {
      setNodeText(setupIntro.querySelector('h2'), 'Nexus Sentinel Discord control');
      setNodeText(setupIntro.querySelector('p'), 'Connect the sole Khaos Nexus Discord bot using protected local credentials. The bot token remains encrypted by Windows.');
    }

    const serverIntro = document.querySelector('#view-servers .section-intro');
    if (serverIntro) {
      setNodeText(serverIntro.querySelector('h2'), 'Palworld server control');
      setNodeText(serverIntro.querySelector('p'), 'Manage Palworld REST or legacy RCON connections, players, saves, announcements, moderation, metrics, and shutdown controls.');
    }

    document.querySelectorAll('[data-view], [data-view-link]').forEach((node) => {
      const view = String(node.dataset.view || node.dataset.viewLink || '');
      node.classList.toggle('sentinel-hidden', HIDDEN_VIEWS.has(view));
    });

    document.querySelectorAll('#view-modules .migration-panel, #view-modules .module-migration-panel, #view-modules [data-module-migration]').forEach((migration) => {
      migration.classList.add('sentinel-hidden');
    });

    const quickCards = document.querySelectorAll('#view-dashboard .quick-card');
    quickCards.forEach((card) => {
      const value = card.textContent || '';
      if (/Game Servers|Palworld Servers/i.test(value)) {
        setNodeText(card.querySelector('strong'), 'Palworld Servers');
        setNodeText(card.querySelector('span'), 'Status, players, saves, moderation and server controls');
      }
    });

    setText('#view-dashboard .metric-card:nth-child(3) > span', 'Palworld servers');
    setNodeText(document.querySelector('.local-badge'), 'DISCORD + PALWORLD');
  }

  function scopeServerEditor() {
    const select = document.getElementById('serverGame');
    if (select) {
      for (const option of [...select.options]) {
        if (option.value !== 'palworld') option.remove();
      }
      if (!select.querySelector('option[value="palworld"]')) {
        const option = document.createElement('option');
        option.value = 'palworld';
        option.textContent = 'Palworld';
        select.appendChild(option);
      }
      select.value = 'palworld';
      select.disabled = true;
    }

    const editor = document.getElementById('serverEditor');
    if (editor) {
      const title = editor.querySelector('#serverEditorTitle');
      if (title && /^Add game server$/i.test(title.textContent || '')) setNodeText(title, 'Add Palworld server');
      editor.querySelectorAll('details').forEach((details) => {
        if (/generic command overrides/i.test(details.textContent || '')) details.classList.add('sentinel-legacy-rcon-options');
      });
    }
  }

  function scopeLegacyModuleCenter() {
    const center = document.getElementById('nexusModuleCenter');
    if (!center) return;

    const exportButton = document.getElementById('moduleExportButton');
    if (exportButton) exportButton.classList.add('sentinel-hidden');

    center.querySelectorAll('[data-module-id]').forEach((card) => {
      if (!ACTIVE_MODULES.has(String(card.dataset.moduleId || ''))) card.classList.add('sentinel-hidden');
    });
  }

  function apply() {
    if (applying) return;
    applying = true;
    try {
      scopeStaticShell();
      scopeServerEditor();
      scopeLegacyModuleCenter();
      window.applyNexusSentinelNavigationGuard?.();
    } finally {
      applying = false;
    }
  }

  function scheduleApply() {
    clearTimeout(scopeTimer);
    scopeTimer = setTimeout(() => {
      scopeTimer = null;
      apply();
    }, 50);
  }

  function relevantNode(node) {
    if (!node || node.nodeType !== 1) return false;
    return Boolean(node.matches?.(RELEVANT_SELECTOR) || node.querySelector?.(RELEVANT_SELECTOR));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
  else queueMicrotask(apply);

  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => [...mutation.addedNodes, ...mutation.removedNodes].some(relevantNode))) scheduleApply();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 12000);
  window.addEventListener('beforeunload', () => {
    observer.disconnect();
    clearTimeout(scopeTimer);
  }, { once: true });
})();
