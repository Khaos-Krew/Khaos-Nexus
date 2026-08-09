'use strict';

(() => {
  const WORKSPACES = [
    { key: 'command', label: 'Command', icon: '⌂', detail: 'Overview and urgent actions' },
    { key: 'dnd', label: 'D&D', icon: '✦', detail: 'Campaign and table tools' },
    { key: 'ai', label: 'Nexus AI', icon: '◉', detail: 'Veyra, Sentinel, and services' },
    { key: 'discord', label: 'Discord & Community', icon: '⬢', detail: 'Runtime, panels, and automation' },
    { key: 'servers', label: 'Game Servers', icon: '▦', detail: 'Servers, schedules, and players' },
    { key: 'operations', label: 'Operations & Access', icon: '⚡', detail: 'Readiness and owner controls' },
    { key: 'modules', label: 'Modules & Tools', icon: '◆', detail: 'Features and companion tools' },
    { key: 'system', label: 'System', icon: '⚙', detail: 'Health, logs, updates, and settings' }
  ];
  const VIEW_DETAIL = {
    dashboard: 'Command Center', dnd: 'D&D Command Table', ai: 'Nexus AI', 'ai-services': 'AI Services',
    setup: 'Discord Runtime', 'discord-studio': 'Discord Studio', 'discord-automation': 'Discord Automation', 'status-panels': 'Status Panels', observability: 'Discord Observability',
    servers: 'Game Servers', scheduler: 'Server Scheduler', players: 'Players & Moderation', 'hosted-servers': 'Hosted Server Control',
    modules: 'Module Network', autonomy: 'Operator Console', operator: 'Operator Console', readiness: 'Readiness Center',
    monitor: 'Application Monitor', logs: 'Live Logs', mobile: 'Mobile Companion', 'mobile-companion': 'Mobile Companion', settings: 'Settings'
  };
  const state = { app: null, observability: null, initialized: false, activeCommandIndex: 0, liveStateSeen: false };
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
    if (view === 'dashboard') return 'command';
    if (view === 'dnd') return 'dnd';
    if (['ai', 'ai-services'].includes(view)) return 'ai';
    if (['setup', 'discord-studio', 'discord-automation', 'status-panels', 'observability'].includes(view)) return 'discord';
    if (['servers', 'scheduler', 'players', 'hosted-servers'].includes(view)) return 'servers';
    if (['autonomy', 'operator', 'readiness'].includes(view)) return 'operations';
    if (['monitor', 'logs', 'settings'].includes(view)) return 'system';
    return 'modules';
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
      group: WORKSPACES.find((workspace) => workspace.key === workspaceForView(item.dataset.view))?.label || 'Modules & Tools',
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
        <div class="nexus-command-search"><span>⌕</span><input id="nexusCommandInput" autocomplete="off" placeholder="Search workspaces, Discord, hosted servers, players, logs, settings…"></div>
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

  function taskCard(key, icon) {
    return `<article class="nexus-task" data-nexus-task="${escapeHtml(key)}"><span class="nexus-task-icon">${escapeHtml(icon)}</span><span><strong></strong><small></small></span></article>`;
  }

  function ensureTaskCards() {
    ensureTaskRail();
    const rail = $('nexusTaskRail');
    if (!rail) return null;
    const expected = ['discord', 'release', 'streams'];
    const current = [...rail.querySelectorAll('[data-nexus-task]')].map((card) => card.dataset.nexusTask);
    if (current.length !== expected.length || current.some((key, index) => key !== expected[index])) {
      rail.innerHTML = [taskCard('discord', '◉'), taskCard('release', '↗'), taskCard('streams', '⌁')].join('');
    }
    return rail;
  }

  function updateTaskCard(key, title, detail, tone = '') {
    const card = $('nexusTaskRail')?.querySelector(`[data-nexus-task="${CSS.escape(key)}"]`);
    if (!card) return;
    const className = `nexus-task ${tone}`.trim();
    if (card.className !== className) card.className = className;
    const strong = card.querySelector('strong');
    const small = card.querySelector('small');
    if (strong && strong.textContent !== title) strong.textContent = title;
    if (small && small.textContent !== detail) small.textContent = detail;
  }

  function applyAppState(next, source = 'live') {
    if (source === 'snapshot' && state.liveStateSeen) return;
    if (source === 'live') state.liveStateSeen = true;
    state.app = next;
    renderTasks();
  }

  function renderTasks() {
    if (!ensureTaskCards()) return;
    const app = state.app || {};
    const bot = app.bot || {};
    const access = app.autonomy?.access || {};
    const update = app.update || {};
    const obs = state.observability || {};
    const rawBotStatus = bot.status || 'stopped';
    const botStatus = bot.ready && ['starting', 'connecting'].includes(rawBotStatus) ? 'online' : rawBotStatus;
    const botTone = botStatus === 'online' ? 'good' : botStatus === 'error' || botStatus === 'crashed' ? 'error' : 'warning';
    const botDetail = botStatus === 'online'
      ? `${bot.ready?.username || 'Discord bot'} • supervised and healthy`
      : bot.ready?.username || bot.lastError?.message || 'Supervised runtime';
    const updateTone = update.status === 'error' ? 'error' : update.available ? 'warning' : 'good';
    const routed = Object.values(obs.config?.routes || {}).filter((route) => route.enabled && route.channelId).length;

    updateTaskCard('discord', `Discord ${botStatus}`, botDetail, botTone);
    updateTaskCard('release', update.available ? `Update ${update.latestVersion || ''} available` : `Release ${update.status || 'idle'}`, update.error || 'Stable GitHub release channel', updateTone);
    updateTaskCard('streams', `${routed} Discord streams routed`, `${access.role || 'local-admin'} access • ${obs.config?.lastHeartbeatAt ? 'heartbeat active' : 'heartbeat not published'}`, routed ? 'good' : 'warning');
  }

  function initialize() {
    if (state.initialized) return;
    state.initialized = true;
    document.body.classList.add('nexus-shell-v14');
    removeWorkspaceRail();
    ensureTaskRail();
    ensurePalette();
    document.addEventListener('keydown', keydown);
    window.khaosStateHub.subscribe((next) => applyAppState(next, 'live'));
    window.khaos.onDiscordObservability?.((next) => { state.observability = next; renderTasks(); });
    window.khaos.invoke('app:get-state').then((next) => applyAppState(next, 'snapshot')).catch(() => {});
    window.khaos.invoke('discord-observability:get').then((next) => { state.observability = next; renderTasks(); }).catch(() => {});
    setTimeout(() => { removeWorkspaceRail(); renderTasks(); }, 1200);
  }

  initialize();
})();