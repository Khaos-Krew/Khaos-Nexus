'use strict';

(() => {
  if (window.__khaosNavigationShellInstalled) return;
  window.__khaosNavigationShellInstalled = true;

  const RECONCILE_DELAYS_MS = Object.freeze([0, 250, 1000, 3000, 6000]);
  const GROUPS = Object.freeze([
    { id: 'servers', title: 'Servers', detail: 'Hosting, schedules, and players', icon: '▦', views: ['servers', 'scheduler', 'players', 'hosted-servers'] },
    { id: 'discord', title: 'Discord & Community', detail: 'Bot, panels, and delivery', icon: '◉', views: ['setup', 'discord-studio', 'discord-automation', 'status-panels', 'observability'] },
    { id: 'automation', title: 'Automation', detail: 'Operations and readiness', icon: '⚡', views: ['operator', 'readiness'] },
    { id: 'modules', title: 'Modules & Tools', detail: 'Features and companion tools', icon: '◆', views: ['modules', 'mobile'] },
    { id: 'system', title: 'System', detail: 'Health, logs, updates, and settings', icon: '⚙', views: ['monitor', 'logs', 'settings'] }
  ]);

  const $ = (id) => document.getElementById(id);
  const boundOriginals = new WeakSet();

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  }

  function originalItems() {
    const seen = new Set();
    return [...document.querySelectorAll('.sidebar .nav-item[data-view]')].filter((item) => {
      if (item.closest('#nexusStaticNavigation')) return false;
      const view = String(item.dataset.view || '').trim();
      if (!view || seen.has(view)) return false;
      seen.add(view);
      return true;
    });
  }

  function labelFor(item) {
    const copy = item.cloneNode(true);
    copy.querySelector('span')?.remove();
    return String(copy.textContent || item.dataset.view || 'Workspace').trim().replace(/\s+/g, ' ');
  }

  function iconFor(item) {
    return String(item.querySelector('span')?.textContent || '◇').trim() || '◇';
  }

  function originalFor(view) {
    return originalItems().find((item) => item.dataset.view === view) || null;
  }

  function groupIdFor(view, label) {
    for (const group of GROUPS) if (group.views.includes(view)) return group.id;
    const search = `${view} ${label}`.toLowerCase();
    if (/(server|player|hosted|scheduler|palworld|rcon)/.test(search)) return 'servers';
    if (/(discord|status.?panel|observab|community)/.test(search)) return 'discord';
    if (/(operator|readiness|automation|recovery)/.test(search)) return 'automation';
    if (/(module|mobile|companion|embed|tool)/.test(search)) return 'modules';
    return 'system';
  }

  function ensureShell() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return null;
    let shell = $('nexusStaticNavigation');
    if (shell) return shell;

    shell = document.createElement('section');
    shell.id = 'nexusStaticNavigation';
    shell.className = 'nexus-navigation-shell';
    shell.setAttribute('aria-label', 'Khaos Nexus navigation');
    shell.innerHTML = `
      <label class="nexus-navigation-search" for="nexusNavigationFilter">
        <span aria-hidden="true">⌕</span>
        <input id="nexusNavigationFilter" type="search" autocomplete="off" placeholder="Filter workspaces">
        <kbd>Filter</kbd>
      </label>
      <div class="nexus-navigation-home" id="nexusNavigationHome"></div>
      <div class="nexus-navigation-groups" id="nexusNavigationGroups"></div>`;

    const footer = sidebar.querySelector('.sidebar-footer');
    if (footer) sidebar.insertBefore(shell, footer);
    else sidebar.appendChild(shell);

    shell.addEventListener('click', (event) => {
      const proxy = event.target.closest('[data-view-proxy]');
      if (!proxy) return;
      const view = String(proxy.dataset.viewProxy || '').trim();
      const original = originalFor(view);
      if (!view || !original) {
        window.khaos?.reportBootStage?.('navigation-proxy-missing-target', { view });
        return;
      }
      event.preventDefault();
      original.click();
      setTimeout(() => {
        syncActiveState();
        const activeView = currentActiveView();
        if (activeView !== view) window.khaos?.reportBootStage?.('navigation-proxy-routing-warning', { view, activeView });
      }, 0);
    });

    shell.addEventListener('toggle', (event) => {
      const opened = event.target.closest?.('.nexus-navigation-group');
      if (!opened?.open) return;
      shell.querySelectorAll('.nexus-navigation-group[open]').forEach((group) => {
        if (group !== opened) group.open = false;
      });
    }, true);

    $('nexusNavigationFilter')?.addEventListener('input', applyFilter);
    return shell;
  }

  function proxyMarkup(item) {
    const view = String(item.dataset.view || '');
    return `<button type="button" class="nav-item nexus-navigation-link" data-view-proxy="${escapeHtml(view)}"><span aria-hidden="true">${escapeHtml(iconFor(item))}</span><strong>${escapeHtml(labelFor(item))}</strong></button>`;
  }

  function groupMarkup(group, entries, activeView, previouslyOpen) {
    const shouldOpen = entries.some((entry) => entry.dataset.view === activeView) || previouslyOpen.has(group.id);
    return `<details class="nexus-navigation-group" data-navigation-group="${escapeHtml(group.id)}"${shouldOpen ? ' open' : ''}>
      <summary>
        <span class="nexus-navigation-group-icon" aria-hidden="true">${escapeHtml(group.icon)}</span>
        <span class="nexus-navigation-group-copy"><strong>${escapeHtml(group.title)}</strong><small>${escapeHtml(group.detail)}</small></span>
        <span class="nexus-navigation-count">${entries.length}</span>
        <span class="nexus-navigation-chevron" aria-hidden="true">›</span>
      </summary>
      <div class="nexus-navigation-links">${entries.map(proxyMarkup).join('')}</div>
    </details>`;
  }

  function currentActiveView(items = originalItems()) {
    return items.find((item) => item.classList.contains('active'))?.dataset.view
      || document.querySelector('.view.active')?.id?.replace(/^view-/, '')
      || 'dashboard';
  }

  function bindOriginal(item) {
    if (boundOriginals.has(item)) return;
    boundOriginals.add(item);
    item.addEventListener('click', () => setTimeout(syncActiveState, 0));
  }

  function applyFilter() {
    const shell = $('nexusStaticNavigation');
    if (!shell) return;
    const query = String($('nexusNavigationFilter')?.value || '').trim().toLowerCase();
    shell.querySelectorAll('[data-view-proxy]').forEach((button) => {
      button.hidden = Boolean(query) && !button.textContent.toLowerCase().includes(query);
    });
    shell.querySelectorAll('.nexus-navigation-group').forEach((group) => {
      const visible = [...group.querySelectorAll('[data-view-proxy]')].some((button) => !button.hidden);
      group.hidden = !visible;
      if (query && visible) group.open = true;
    });
  }

  function syncActiveState() {
    const shell = $('nexusStaticNavigation');
    if (!shell) return;
    const activeView = currentActiveView();
    shell.querySelectorAll('[data-view-proxy]').forEach((button) => {
      button.classList.toggle('active', button.dataset.viewProxy === activeView);
    });
    const activeProxy = shell.querySelector(`[data-view-proxy="${activeView}"]`);
    activeProxy?.closest('.nexus-navigation-group')?.setAttribute('open', '');
  }

  function render() {
    const shell = ensureShell();
    if (!shell) return;
    const items = originalItems();
    if (!items.length) return;
    const activeView = currentActiveView(items);
    const previouslyOpen = new Set([...shell.querySelectorAll('.nexus-navigation-group[open]')].map((group) => group.dataset.navigationGroup));

    for (const item of items) {
      bindOriginal(item);
      item.classList.add('nexus-original-nav-item');
      item.closest('nav')?.classList.add('nexus-legacy-navigation');
    }
    document.body.classList.add('nexus-static-navigation-active');

    const dashboard = items.find((item) => item.dataset.view === 'dashboard');
    $('nexusNavigationHome').innerHTML = dashboard ? proxyMarkup(dashboard) : '';

    const grouped = new Map(GROUPS.map((group) => [group.id, []]));
    for (const item of items) {
      if (item === dashboard) continue;
      const id = groupIdFor(item.dataset.view, labelFor(item));
      grouped.get(id)?.push(item);
    }
    $('nexusNavigationGroups').innerHTML = GROUPS
      .filter((group) => grouped.get(group.id)?.length)
      .map((group) => groupMarkup(group, grouped.get(group.id), activeView, previouslyOpen))
      .join('');

    applyFilter();
    syncActiveState();
    window.khaos?.reportBootStage?.('navigation-proxy-ready', { mode: 'static-proxy', items: items.length });
  }

  for (const delay of RECONCILE_DELAYS_MS) setTimeout(render, delay);
  window.addEventListener('load', render, { once: true });
  window.addEventListener('khaos:features-ready', render, { once: true });
})();