'use strict';

(() => {
  if (window.__khaosNavigationShellInstalled) return;
  window.__khaosNavigationShellInstalled = true;

  const STORAGE_KEY = 'khaos-nexus:navigation-group:v1';
  const GROUPS = Object.freeze([
    { id: 'servers', label: 'Servers', icon: '▦', hint: 'Game servers and players' },
    { id: 'discord', label: 'Discord & Community', icon: '◈', hint: 'Bot, embeds, roles and feeds' },
    { id: 'automation', label: 'Automation', icon: '↻', hint: 'Schedules and recurring actions' },
    { id: 'modules', label: 'Modules & Tools', icon: '◆', hint: 'Feature workspaces' },
    { id: 'system', label: 'System', icon: '⚙', hint: 'Settings, logs and diagnostics' }
  ]);

  let organizing = false;
  let scheduled = false;
  let searchValue = '';
  let observer = null;

  function clean(value) {
    return String(value || '').trim().toLowerCase();
  }

  function classify(view) {
    const id = clean(view);
    if (!id || id === 'dashboard') return 'home';
    if (/^(setup|discord)/.test(id) || /(embed|role|reaction|welcome|community|status-panel|mobile-gateway)/.test(id)) return 'discord';
    if (/(scheduler|schedule|automation|routine|task|restart-plan)/.test(id)) return 'automation';
    if (/(server|palworld|ark|player|hosted|rcon|console)/.test(id)) return 'servers';
    if (/(monitor|log|setting|diagnostic|recovery|access|update|backup|system|observability)/.test(id)) return 'system';
    return 'modules';
  }

  function safeStoredGroup() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return GROUPS.some((group) => group.id === value) ? value : null;
    } catch {
      return null;
    }
  }

  function rememberGroup(id) {
    try { localStorage.setItem(STORAGE_KEY, id); } catch {}
  }

  function shell() {
    return document.getElementById('nexusNavigationShell');
  }

  function groupElement(id) {
    return document.querySelector(`#nexusNavigationShell details[data-navigation-group="${id}"]`);
  }

  function ensureShell() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return null;
    let root = shell();
    if (root) return root;

    root = document.createElement('section');
    root.id = 'nexusNavigationShell';
    root.className = 'nexus-navigation-shell';
    root.setAttribute('aria-label', 'Khaos Nexus navigation');
    root.innerHTML = `
      <label class="nexus-navigation-search">
        <span aria-hidden="true">⌕</span>
        <input id="nexusNavigationSearch" type="search" autocomplete="off" spellcheck="false" placeholder="Find a workspace…" aria-label="Find a workspace">
        <kbd>Esc</kbd>
      </label>
      <div class="nexus-navigation-home" data-navigation-home></div>
      <div class="nexus-navigation-groups">
        ${GROUPS.map((group) => `
          <details class="nexus-navigation-group" data-navigation-group="${group.id}">
            <summary>
              <span class="nexus-navigation-group-icon" aria-hidden="true">${group.icon}</span>
              <span class="nexus-navigation-group-copy"><strong>${group.label}</strong><small>${group.hint}</small></span>
              <span class="nexus-navigation-count" data-navigation-count="${group.id}">0</span>
              <span class="nexus-navigation-chevron" aria-hidden="true">›</span>
            </summary>
            <nav class="nexus-navigation-links" data-navigation-links="${group.id}" aria-label="${group.label}"></nav>
          </details>`).join('')}
      </div>`;

    const firstNavigation = sidebar.querySelector('.nav-label, nav, .sidebar-footer');
    sidebar.insertBefore(root, firstNavigation || null);

    const input = root.querySelector('#nexusNavigationSearch');
    input.addEventListener('input', () => {
      searchValue = clean(input.value);
      applySearch();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        input.value = '';
        searchValue = '';
        applySearch();
        input.blur();
      }
      if (event.key === 'Enter') {
        const first = root.querySelector('.nav-item[data-view]:not([hidden])');
        if (first) first.click();
      }
    });

    root.querySelectorAll('details[data-navigation-group]').forEach((details) => {
      details.addEventListener('toggle', () => {
        if (!details.open || searchValue) return;
        root.querySelectorAll('details[data-navigation-group]').forEach((other) => {
          if (other !== details) other.open = false;
        });
        rememberGroup(details.dataset.navigationGroup);
      });
    });

    return root;
  }

  function candidateItems(sidebar) {
    return [...sidebar.querySelectorAll('.nav-item[data-view]')]
      .filter((item) => !item.classList.contains('nexus-navigation-group-toggle'));
  }

  function canonicalItems(items) {
    const byView = new Map();
    for (const item of items) {
      const view = clean(item.dataset.view);
      if (!view) continue;
      const existing = byView.get(view);
      if (!existing || item.classList.contains('active')) {
        if (existing) {
          existing.hidden = true;
          existing.dataset.navigationDuplicate = 'true';
        }
        byView.set(view, item);
        item.hidden = false;
        delete item.dataset.navigationDuplicate;
      } else {
        item.hidden = true;
        item.dataset.navigationDuplicate = 'true';
      }
    }
    return [...byView.values()];
  }

  function labelFor(item) {
    return clean(item.getAttribute('aria-label') || item.title || item.textContent || item.dataset.view);
  }

  function activeGroup(root) {
    const active = root.querySelector('.nav-item.active[data-view]');
    return active ? classify(active.dataset.view) : null;
  }

  function openRelevantGroup(root) {
    const active = activeGroup(root);
    if (active && active !== 'home') {
      const details = groupElement(active);
      if (details) details.open = true;
      return;
    }
    const stored = safeStoredGroup();
    const storedDetails = stored ? groupElement(stored) : null;
    if (storedDetails && !root.querySelector('details[open]')) storedDetails.open = true;
  }

  function applySearch() {
    const root = shell();
    if (!root) return;
    const query = searchValue;
    const active = activeGroup(root);

    root.querySelectorAll('.nav-item[data-view]').forEach((item) => {
      if (item.dataset.navigationDuplicate === 'true') return;
      const match = !query || labelFor(item).includes(query) || clean(item.dataset.view).includes(query);
      item.hidden = !match;
    });

    GROUPS.forEach((group) => {
      const details = groupElement(group.id);
      if (!details) return;
      const visible = [...details.querySelectorAll('.nav-item[data-view]')]
        .filter((item) => !item.hidden && item.dataset.navigationDuplicate !== 'true');
      details.hidden = Boolean(query) && visible.length === 0;
      if (query && visible.length) details.open = true;
      else if (!query && group.id !== active && details.open && safeStoredGroup() !== group.id) details.open = false;
    });

    const home = root.querySelector('[data-navigation-home] .nav-item[data-view="dashboard"]');
    if (home) home.hidden = Boolean(query) && !labelFor(home).includes(query) && !'dashboard'.includes(query);
    if (!query) openRelevantGroup(root);
  }

  function hideLegacyContainers(sidebar, root) {
    [...sidebar.children].forEach((element) => {
      if (element === root || element.classList.contains('brand') || element.classList.contains('sidebar-footer')) return;
      if (element.matches('.nav-label')) element.hidden = true;
      if (element.matches('nav') && !element.closest('#nexusNavigationShell')) element.classList.add('nexus-legacy-navigation');
    });
  }

  function organize() {
    scheduled = false;
    if (organizing) return;
    const sidebar = document.querySelector('.sidebar');
    const root = ensureShell();
    if (!sidebar || !root) return;
    organizing = true;
    try {
      const items = canonicalItems(candidateItems(sidebar));
      const home = root.querySelector('[data-navigation-home]');
      const counts = Object.fromEntries(GROUPS.map((group) => [group.id, 0]));

      for (const item of items) {
        item.classList.add('nexus-navigation-link');
        const category = classify(item.dataset.view);
        const target = category === 'home'
          ? home
          : root.querySelector(`[data-navigation-links="${category}"]`);
        if (target && item.parentElement !== target) target.appendChild(item);
        if (category !== 'home' && Object.prototype.hasOwnProperty.call(counts, category)) counts[category] += 1;
      }

      GROUPS.forEach((group) => {
        const details = groupElement(group.id);
        const count = root.querySelector(`[data-navigation-count="${group.id}"]`);
        if (count) count.textContent = String(counts[group.id]);
        if (details) details.hidden = counts[group.id] === 0;
      });

      hideLegacyContainers(sidebar, root);
      openRelevantGroup(root);
      applySearch();
    } finally {
      organizing = false;
    }
  }

  function scheduleOrganize() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(organize);
  }

  function installObserver() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar || observer) return;
    observer = new MutationObserver((mutations) => {
      if (organizing) return;
      const relevant = mutations.some((mutation) =>
        mutation.type === 'childList' ||
        (mutation.type === 'attributes' && mutation.target?.matches?.('.nav-item[data-view]'))
      );
      if (relevant) scheduleOrganize();
    });
    observer.observe(sidebar, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'data-view'] });
  }

  function start() {
    ensureShell();
    organize();
    installObserver();
    window.addEventListener('hashchange', scheduleOrganize);
    document.addEventListener('click', (event) => {
      if (event.target.closest?.('.nav-item[data-view]')) setTimeout(scheduleOrganize, 0);
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
