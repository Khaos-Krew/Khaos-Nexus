'use strict';

(() => {
  const ACTIVE_MODULES = new Set([
    'discord-runtime', 'game-server-control', 'palworld-operations', 'operator-console',
    'application-monitor', 'backup-update-center', 'players-console', 'server-status-panels',
    'embed-studio', 'role-menus', 'color-roles', 'discord-organization',
    'discord-audit-logging', 'discord-observability', 'palworld-companion', 'admin-command-center'
  ]);
  const HIDDEN_VIEWS = new Set([
    'dnd', 'ai-services', 'nexus-ai', 'scheduler', 'hosted-servers', 'mobile-companion',
    'rust', 'satisfactory'
  ]);

  function setText(selector, value) {
    const node = document.querySelector(selector);
    if (node) node.textContent = value;
  }

  function scopeStaticShell() {
    document.documentElement.dataset.nexusProduct = 'sentinel';
    document.title = 'Khaos Nexus';
    setText('.brand strong', 'Khaos Nexus');
    setText('.brand span', 'Discord + Palworld Control Center');
    setText('#viewSubtitle', 'Run Nexus Sentinel, Discord automation, and Palworld moderation from this PC.');
    setText('#view-dashboard .hero-panel .eyebrow', 'Nexus Sentinel runtime');

    const start = document.getElementById('startButton');
    if (start && /^Start Bot$/i.test(start.textContent || '')) start.textContent = 'Start Sentinel';

    const setupIntro = document.querySelector('#view-setup .section-intro');
    if (setupIntro) {
      const h2 = setupIntro.querySelector('h2');
      const p = setupIntro.querySelector('p');
      if (h2) h2.textContent = 'Nexus Sentinel Discord control';
      if (p) p.textContent = 'Connect the sole Khaos Nexus Discord bot using protected local credentials. The bot token remains encrypted by Windows.';
    }

    const serverIntro = document.querySelector('#view-servers .section-intro');
    if (serverIntro) {
      const h2 = serverIntro.querySelector('h2');
      const p = serverIntro.querySelector('p');
      if (h2) h2.textContent = 'Palworld server control';
      if (p) p.textContent = 'Manage Palworld REST or legacy RCON connections, players, saves, announcements, moderation, metrics, and shutdown controls.';
    }

    document.querySelectorAll('[data-view], [data-view-link]').forEach((node) => {
      const view = String(node.dataset.view || node.dataset.viewLink || '');
      if (HIDDEN_VIEWS.has(view)) node.classList.add('sentinel-hidden');
    });

    const migration = document.querySelector('#view-modules .migration-panel');
    if (migration) migration.classList.add('sentinel-hidden');

    const quickCards = document.querySelectorAll('#view-dashboard .quick-card');
    quickCards.forEach((card) => {
      const text = card.textContent || '';
      if (/Game Servers/i.test(text)) {
        const strong = card.querySelector('strong');
        const span = card.querySelector('span');
        if (strong) strong.textContent = 'Palworld Servers';
        if (span) span.textContent = 'Status, players, saves, moderation and server controls';
      }
    });

    setText('#view-dashboard .metric-card:nth-child(3) > span', 'Palworld servers');
    const localBadge = document.querySelector('.local-badge');
    if (localBadge) localBadge.textContent = 'DISCORD + PALWORLD';
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
      if (title && /^Add game server$/i.test(title.textContent || '')) title.textContent = 'Add Palworld server';
      editor.querySelectorAll('details').forEach((details) => {
        if (/generic command overrides/i.test(details.textContent || '')) details.classList.add('sentinel-legacy-rcon-options');
      });
    }
  }

  function scopeModuleCenter() {
    const center = document.getElementById('nexusModuleCenter');
    if (!center) return;

    const hero = center.querySelector('.module-hero-copy');
    if (hero) {
      const eyebrow = hero.querySelector('.eyebrow');
      const h2 = hero.querySelector('h2');
      const p = hero.querySelector('p');
      if (eyebrow) eyebrow.textContent = 'Active Product Scope';
      if (h2) h2.textContent = 'Discord + Palworld Modules';
      if (p) p.textContent = 'Only the Discord, Palworld, moderation, monitoring, backup, and status modules needed for the current deployment are active. Deferred game modules remain disabled for later.';
    }

    const exportButton = document.getElementById('moduleExportButton');
    if (exportButton) exportButton.classList.add('sentinel-hidden');

    center.querySelectorAll('[data-module-id]').forEach((card) => {
      if (!ACTIVE_MODULES.has(String(card.dataset.moduleId || ''))) card.classList.add('sentinel-hidden');
    });

    const detail = document.getElementById('nexusModuleDetail');
    if (detail) {
      const card = detail.querySelector('[data-module-open], #moduleToggleButton');
      const selected = document.querySelector('.nexus-module-card.selected')?.dataset?.moduleId;
      if (selected && !ACTIVE_MODULES.has(selected)) detail.classList.add('sentinel-hidden');
      else detail.classList.remove('sentinel-hidden');
      void card;
    }

    const search = document.getElementById('moduleSearchInput');
    if (search) search.placeholder = 'Search Discord, Palworld, moderation, status…';
  }

  function apply() {
    scopeStaticShell();
    scopeServerEditor();
    scopeModuleCenter();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
  else queueMicrotask(apply);

  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 20000);
})();