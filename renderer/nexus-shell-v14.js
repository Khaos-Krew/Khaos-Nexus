'use strict';

(() => {
  const WORKSPACES = [
    { key: 'dashboard', label: 'Command', icon: '⌂', detail: 'Overview and urgent actions' },
    { key: 'servers', label: 'Operations', icon: '▦', detail: 'Game servers and recovery' },
    { key: 'setup', label: 'Discord', icon: '◉', detail: 'Runtime and automation' },
    { key: 'modules', label: 'Modules', icon: '◆', detail: 'Migration and companions' },
    { key: 'settings', label: 'System', icon: '⚙', detail: 'Settings, logs, updates, access' }
  ];
  const VIEW_DETAIL = {
    dashboard: 'Command Center', setup: 'Discord Runtime', 'discord-studio': 'Discord Studio', 'discord-automation': 'Discord Automation', observability: 'Discord Observability',
    servers: 'Game Servers', modules: 'Module Network', operator: 'Operator Console', readiness: 'Readiness Center', monitor: 'Application Monitor',
    logs: 'Live Logs', mobile: 'Mobile Companion', settings: 'Settings'
  };
  const state = { app: null, observability: null, initialized: false, activeCommandIndex: 0 };
  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  }

  function removeWorkspaceRail() {
    $('nexusWorkspaceRail')?.remove();
  }

  function ensureTaskRail() {
    const dashboard = $('view-dashboard');
    if (!dashboard || $('nexusTaskRail')) return;
    const rail = document.createElement('div');
    rail.id = 'nexusTaskRail';
    rail.className = 'nexus-task-rail';
    dashboard.insertBefore(rail, dashboard.firstElementChild?.nextSibling || dashboard.firstChild);
  }

  function currentView() {
    const active = document.querySelector('.view.active');
    return active?.id?.replace(/^view-/, '') || 'dashboard';
  }

  function workspaceForView(view) {
    if (['dashboard'].includes(view)) return 'dashboard';
    if (['servers', 'operator', 'readiness'].includes(view)) return 'servers';
    if (['setup', 'discord-studio', 'discord-automation', 'observability'].includes(view)) return 'setup';
    if (['modules', 'mobile'].includes(view)) return 'modules';
    return 'settings';
  }

  function activateView(view) {
    const target = document.querySelector(`[data-view="${CSS.escape(view)}"]`);
    if (target) {
      target.click();
      return true;
    }
    if (view === 'observability') {
      $('observabilityNavButton')?.click();
      return true;
    }
    return false;
  }

  function navItems() {
    const seen = new Set();
    return [...document.querySelectorAll('.nav-item[data-view]')].filter((item) => {
      const key = item.dataset.view;
      if (!key || seen.has(key) || item.hidden || item.offsetParent === null) return false;
      seen.add(key);
      return true;
    }).map((item) => ({
      key: item.dataset.view,
      label: (VIEW_DETAIL[item.dataset.view] || item.textContent || item.dataset.view).trim(),
      group: WORKSPACES.find((workspace) => workspace.key === workspaceForView(item.dataset.view))?.label || 'System',
      icon: item.querySelector('span')?.textContent?.trim() || '◇'
    }));
  }

  function ensurePalette() {
    if ($('nexusCommandPalette')) return;
    const palette = document.createElement('section');
    palette.id = 'nexusCommandPalette';
    palette.className = 'nexus-command-palette hidden';
    palette.setAttribute('role', 'dialog');
    palette.setAttribute('aria-modal', 'true');
    palette.setAttribute('aria-label', 'Khaos Nexus command palette');
    palette.innerHTML = `
      <div class="nexus-command-panel">
        <div class="nexus-command-search"><span>⌕</span><input id="nexusCommandInput" autocomplete="off" placeholder="Search workspaces, Discord, servers, logs, settings…"></div>
        <div class="nexus-command-results" id="nexusCommandResults"></div>
        <div class="nexus-command-footer"><span>↑ ↓ Navigate • Enter Open • Esc Close</span><span>Ctrl K • Khaos Nexus Command Search</span></div>
      </div>`;
    document.body.appendChild(palette);
    palette.addEventListener('mousedown', (event) => { if (event.target === palette) closePalette(); });
    $('nexusCommandInput').addEventListener('input', () => { state.activeCommandIndex = 0; renderPaletteResults(); });
    $('nexusCommandResults').addEventListener('click', (event) => {
      const result = event.target.closest('[data-command-view]');
      if (!result) return;
      activateView(result.dataset.commandView);
      closePalette();
    });
  }

  function filteredCommands() {
    const query = ($('nexusCommandInput')?.value || '').trim().toLowerCase();
    const items = navItems();
    if (!query) return items;
    return items.filter((item) => `${item.label} ${item.group} ${item.key}`.toLowerCase().includes(query));
  }

  function renderPaletteResults() {
    const results = filteredCommands();
    if (state.activeCommandIndex >= results.length) state.activeCommandIndex = Math.max(0, results.length - 1);
    $('nexusCommandResults').innerHTML = results.length ? results.map((item, index) => `
      <button class="nexus-command-result ${index === state.activeCommandIndex ? 'active' : ''}" data-command-view="${escapeHtml(item.key)}">
        <span>${escapeHtml(item.icon)}</span><span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.group)}</small></span><kbd>Enter</kbd>
      </button>`).join('') : '<div class="observability-empty">No matching workspace.</div>';
    $('nexusCommandResults').querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }

  function openPalette() {
    ensurePalette();
    $('nexusCommandPalette').classList.remove('hidden');
    $('nexusCommandInput').value = '';
    state.activeCommandIndex = 0;
    renderPaletteResults();
    setTimeout(() => $('nexusCommandInput').focus(), 0);
  }

  function closePalette() {
    $('nexusCommandPalette')?.classList.add('hidden');
  }

  function keydown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      $('nexusCommandPalette')?.classList.contains('hidden') === false ? closePalette() : openPalette();
      return;
    }
    if ($('nexusCommandPalette')?.classList.contains('hidden') !== false) return;
    const results = filteredCommands();
    if (event.key === 'Escape') { event.preventDefault(); closePalette(); }
    if (event.key === 'ArrowDown') { event.preventDefault(); state.activeCommandIndex = Math.min(results.length - 1, state.activeCommandIndex + 1); renderPaletteResults(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); state.activeCommandIndex = Math.max(0, state.activeCommandIndex - 1); renderPaletteResults(); }
    if (event.key === 'Enter' && results[state.activeCommandIndex]) { event.preventDefault(); activateView(results[state.activeCommandIndex].key); closePalette(); }
  }

  function taskCard(icon, title, detail, tone = '') {
    return `<article class="nexus-task ${tone}"><span class="nexus-task-icon">${icon}</span><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></span></article>`;
  }

  function renderTasks() {
    ensureTaskRail();
    const rail = $('nexusTaskRail');
    if (!rail) return;
    const app = state.app || {};
    const bot = app.bot || {};
    const access = app.autonomy?.access || {};
    const update = app.update || {};
    const obs = state.observability || {};
    const botTone = bot.status === 'online' ? 'good' : bot.status === 'error' || bot.status === 'crashed' ? 'error' : 'warning';
    const updateTone = update.status === 'error' ? 'error' : update.available ? 'warning' : 'good';
    const routed = Object.values(obs.config?.routes || {}).filter((route) => route.enabled && route.channelId).length;
    rail.innerHTML = [
      taskCard('◉', `Discord ${bot.status || 'stopped'}`, bot.ready?.username || bot.lastError?.message || 'Supervised runtime', botTone),
      taskCard('↗', update.available ? `Update ${update.latestVersion || ''} available` : `Release ${update.status || 'idle'}`, update.error || 'Stable GitHub release channel', updateTone),
      taskCard('⌁', `${routed} Discord streams routed`, `${access.role || 'local-admin'} access • ${obs.config?.lastHeartbeatAt ? 'heartbeat active' : 'heartbeat not published'}`, routed ? 'good' : 'warning')
    ].join('');
  }

  function initialize() {
    if (state.initialized) return;
    state.initialized = true;
    document.body.classList.add('nexus-shell-v14');
    removeWorkspaceRail();
    ensureTaskRail();
    ensurePalette();
    document.addEventListener('keydown', keydown);
    window.khaos.onState((next) => { state.app = next; renderTasks(); });
    window.khaos.onDiscordObservability?.((next) => { state.observability = next; renderTasks(); });
    window.khaos.invoke('app:get-state').then((next) => { state.app = next; renderTasks(); }).catch(() => {});
    window.khaos.invoke('discord-observability:get').then((next) => { state.observability = next; renderTasks(); }).catch(() => {});
    setTimeout(() => { removeWorkspaceRail(); renderTasks(); }, 1200);
  }

  initialize();
})();
