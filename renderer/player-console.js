'use strict';

(() => {
  const state = { payload: null, selectedServers: new Set(), filtersInitialized: false, query: '', autoTimer: null };
  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  }

  function notify(message) {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = String(message || 'Done.');
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('show'), 4200);
  }

  async function invoke(channel, payload) {
    try { return await window.khaos.invoke(channel, payload); }
    catch (error) { notify(error.message || String(error)); throw error; }
  }

  function canOperate() {
    return ['operator', 'owner', 'local-admin'].includes(state.payload?.role);
  }

  function canOwn() {
    return ['owner', 'local-admin'].includes(state.payload?.role);
  }

  function players() {
    return state.payload?.snapshot?.players || [];
  }

  function initializeFilters() {
    if (state.filtersInitialized || !state.payload) return;
    for (const server of state.payload.servers || []) {
      if (server.enabled !== false) state.selectedServers.add(server.id);
    }
    state.filtersInitialized = true;
  }

  function filteredPlayers() {
    const query = state.query.trim().toLowerCase();
    return players().filter((player) => {
      if (state.filtersInitialized && !state.selectedServers.has(player.serverId)) return false;
      if (!query) return true;
      return `${player.name} ${player.serverName} ${player.game} ${player.accountType}`.toLowerCase().includes(query);
    });
  }

  function ensureShell() {
    if (typeof viewMeta !== 'undefined') {
      viewMeta.players = ['Players & Moderation', 'Cross-server player visibility and guarded moderation actions.'];
    }
    if (!document.querySelector('[data-view="players"]')) {
      const scheduler = document.querySelector('[data-view="scheduler"]') || document.querySelector('[data-view="servers"]');
      const button = document.createElement('button');
      button.className = 'nav-item';
      button.dataset.view = 'players';
      button.innerHTML = '<span>◎</span>Players & Moderation';
      scheduler?.insertAdjacentElement('afterend', button);
    }
    if ($('view-players')) return;

    const view = document.createElement('section');
    view.className = 'view';
    view.id = 'view-players';
    view.innerHTML = `
      <div class="player-console-intro">
        <div><span class="eyebrow">Server Operations</span><h2>Players & Moderation</h2><p>See connected players across configured servers and perform guarded moderation without exposing account IDs, IP addresses, credentials, or raw RCON access.</p></div>
        <div class="player-console-actions"><button class="button primary" id="playerConsoleRefresh">Refresh Players</button><button class="button" id="playerConsoleReload">Reload State</button></div>
      </div>

      <div id="playerConsoleSummary" class="player-console-summary"></div>

      <article class="panel player-console-controls">
        <div class="form-grid three">
          <label>Search players or servers<input id="playerConsoleSearch" placeholder="Name, server, or game"></label>
          <label>Automatic refresh<select id="playerConsoleAutoRefresh"><option value="0">Off</option><option value="15">Every 15 seconds</option><option value="30">Every 30 seconds</option><option value="60">Every minute</option><option value="120">Every 2 minutes</option></select></label>
          <div class="player-console-safe-note"><strong>Protected moderation</strong><span>Player entries expire after each refresh and cannot be converted into raw commands.</span></div>
        </div>
        <div id="playerConsoleServerFilters" class="player-console-server-filters"></div>
      </article>

      <div class="player-console-workspace">
        <article class="panel player-console-list-panel">
          <div class="panel-heading"><div><span class="eyebrow">Live Snapshot</span><h3>Connected Players</h3></div><span class="severity" id="playerConsoleSnapshotTime">Not refreshed</span></div>
          <div id="playerConsoleErrors" class="player-console-errors"></div>
          <div id="playerConsoleList" class="player-console-list"></div>
        </article>

        <article class="panel player-console-history-panel">
          <div class="panel-heading"><div><span class="eyebrow">Audit Trail</span><h3>Moderation History</h3></div><button class="button danger" id="playerConsoleClearHistory">Clear</button></div>
          <div id="playerConsoleHistory" class="player-console-history"></div>
        </article>
      </div>`;
    document.querySelector('main.content')?.appendChild(view);
    bind();
  }

  function openView() {
    document.querySelectorAll('.view').forEach((element) => element.classList.toggle('active', element.id === 'view-players'));
    document.querySelectorAll('.nav-item').forEach((element) => element.classList.toggle('active', element.dataset.view === 'players'));
    if ($('viewTitle')) $('viewTitle').textContent = 'Players & Moderation';
    if ($('viewSubtitle')) $('viewSubtitle').textContent = 'Cross-server player visibility and guarded moderation actions.';
    refreshPlayers().catch(() => {});
  }

  function formatDate(value, fallback = 'Never') {
    if (!value) return fallback;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : fallback;
  }

  function renderSummary() {
    const snapshot = state.payload?.snapshot || {};
    const connected = snapshot.players?.length || 0;
    const onlineServers = (snapshot.servers || []).filter((server) => server.status === 'online').length;
    const errorServers = (snapshot.errors || []).length;
    const recentActions = (state.payload?.history || []).filter((entry) => Date.now() - new Date(entry.time).getTime() < 24 * 60 * 60 * 1000).length;
    $('playerConsoleSummary').innerHTML = `
      <article><span>Connected Players</span><strong>${connected}</strong><small>Across the latest snapshot</small></article>
      <article><span>Servers Reached</span><strong>${onlineServers}</strong><small>${errorServers ? `${errorServers} warning${errorServers === 1 ? '' : 's'}` : 'All selected checks completed'}</small></article>
      <article><span>Actions Today</span><strong>${recentActions}</strong><small>Kick and ban history</small></article>
      <article><span>Access</span><strong>${escapeHtml(state.payload?.role || 'viewer')}</strong><small>${canOwn() ? 'Kick and ban enabled' : canOperate() ? 'Kick enabled; ban requires owner' : 'View only'}</small></article>`;
  }

  function renderServerFilters() {
    const servers = state.payload?.servers || [];
    $('playerConsoleServerFilters').innerHTML = servers.map((server) => `
      <label class="player-console-server-filter ${state.selectedServers.has(server.id) ? 'selected' : ''} ${server.enabled && server.hasPassword ? '' : 'unready'}">
        <input type="checkbox" value="${escapeHtml(server.id)}" ${state.selectedServers.has(server.id) ? 'checked' : ''} ${server.enabled ? '' : 'disabled'}>
        <span><strong>${escapeHtml(server.name)}</strong><small>${escapeHtml(String(server.game || 'generic').toUpperCase())}${server.hasPassword ? '' : ' • credentials missing'}</small></span>
      </label>`).join('') || '<div class="player-console-empty">No game servers are configured.</div>';
  }

  function renderErrors() {
    const errors = state.payload?.snapshot?.errors || [];
    $('playerConsoleErrors').innerHTML = errors.length ? `<div class="player-console-error-banner"><strong>${errors.length} server check${errors.length === 1 ? '' : 's'} failed</strong>${errors.map((error) => `<span>${escapeHtml(error.serverName)}: ${escapeHtml(error.message)}</span>`).join('')}</div>` : '';
  }

  function renderPlayers() {
    const list = filteredPlayers();
    $('playerConsoleSnapshotTime').textContent = state.payload?.snapshot?.refreshedAt ? `Updated ${formatDate(state.payload.snapshot.refreshedAt)}` : 'Not refreshed';
    $('playerConsoleList').innerHTML = list.length ? list.map((player) => `
      <article class="player-console-card">
        <span class="player-console-avatar">${escapeHtml(player.name.slice(0, 1).toUpperCase())}</span>
        <span class="player-console-identity"><strong>${escapeHtml(player.name)}</strong><small>${escapeHtml(player.serverName)} • ${escapeHtml(String(player.game || 'generic').toUpperCase())} • ${escapeHtml(player.accountType || 'Server account')}</small></span>
        <span class="player-console-stat"><small>Level</small><strong>${player.level === null || player.level === undefined ? '—' : escapeHtml(player.level)}</strong></span>
        <span class="player-console-stat"><small>Ping</small><strong>${player.ping === null || player.ping === undefined ? '—' : `${escapeHtml(Math.round(player.ping))} ms`}</strong></span>
        <span class="player-console-card-actions">
          <button class="button" data-player-kick="${escapeHtml(player.token)}" data-player-name="${escapeHtml(player.name)}" ${canOperate() ? '' : 'disabled'}>Kick</button>
          <button class="button danger" data-player-ban="${escapeHtml(player.token)}" data-player-name="${escapeHtml(player.name)}" ${canOwn() ? '' : 'disabled'}>Ban</button>
        </span>
      </article>`).join('') : `<div class="player-console-empty">${state.payload?.snapshot?.refreshedAt ? 'No connected players match the current server and search filters.' : 'Refresh the player list to begin.'}</div>`;
  }

  function renderHistory() {
    const history = state.payload?.history || [];
    $('playerConsoleHistory').innerHTML = history.length ? history.map((entry) => `
      <article class="player-console-history-entry ${escapeHtml(entry.outcome)}">
        <span class="player-console-history-icon">${entry.outcome === 'success' ? '✓' : '!'}</span>
        <span><strong>${escapeHtml(entry.action.toUpperCase())}: ${escapeHtml(entry.playerName)}</strong><small>${escapeHtml(entry.serverName)} • ${escapeHtml(formatDate(entry.time))} • ${escapeHtml(entry.actorName)}</small><p>${escapeHtml(entry.reason)}</p>${entry.message ? `<em>${escapeHtml(entry.message)}</em>` : ''}</span>
      </article>`).join('') : '<div class="player-console-empty">No moderation actions have been recorded.</div>';
  }

  function scheduleAutoRefresh() {
    clearInterval(state.autoTimer);
    state.autoTimer = null;
    const seconds = Number($('playerConsoleAutoRefresh')?.value || 0);
    if (seconds > 0) {
      state.autoTimer = setInterval(() => {
        if ($('view-players')?.classList.contains('active')) refreshPlayers().catch(() => {});
      }, seconds * 1000);
    }
  }

  function render() {
    if (!state.payload) return;
    initializeFilters();
    renderSummary();
    renderServerFilters();
    renderErrors();
    renderPlayers();
    renderHistory();
    const configured = state.payload?.config?.settings?.autoRefreshSeconds ?? 30;
    if ($('playerConsoleAutoRefresh') && !$('playerConsoleAutoRefresh').dataset.initialized) {
      $('playerConsoleAutoRefresh').value = String(configured);
      $('playerConsoleAutoRefresh').dataset.initialized = 'true';
      scheduleAutoRefresh();
    }
    $('playerConsoleClearHistory').disabled = !canOwn();
  }

  async function refreshState() {
    state.payload = await invoke('player-console:get');
    render();
  }

  async function refreshPlayers() {
    const selected = [...state.selectedServers];
    state.payload = await invoke('player-console:refresh', selected);
    render();
    notify(`Player snapshot refreshed: ${players().length} connected.`);
  }

  async function moderate(action, token, playerName) {
    const reason = prompt(`Reason for ${action === 'ban' ? 'banning' : 'kicking'} ${playerName}:`);
    if (reason === null) return;
    if (reason.trim().length < 3) return notify('Enter a reason of at least 3 characters.');
    const confirmation = action === 'ban'
      ? confirm(`Ban ${playerName}? This is a persistent server action and may require a separate unban workflow.`)
      : confirm(`Kick ${playerName} from the server?`);
    if (!confirmation) return;
    const result = await invoke(`player-console:${action}`, { token, reason, playerName });
    state.payload = result.state;
    render();
    notify(`${playerName} ${action === 'ban' ? 'banned' : 'kicked'}. Refreshing players…`);
    setTimeout(() => refreshPlayers().catch(() => {}), 800);
  }

  function bind() {
    document.addEventListener('click', (event) => {
      if (event.target.closest('[data-view="players"]')) openView();
    });
    $('playerConsoleRefresh').addEventListener('click', refreshPlayers);
    $('playerConsoleReload').addEventListener('click', refreshState);
    $('playerConsoleSearch').addEventListener('input', (event) => { state.query = event.target.value; renderPlayers(); });
    $('playerConsoleAutoRefresh').addEventListener('change', async (event) => {
      scheduleAutoRefresh();
      if (canOwn()) {
        state.payload = await invoke('player-console:settings', { autoRefreshSeconds: Number(event.target.value) });
        render();
      }
    });
    $('playerConsoleServerFilters').addEventListener('change', (event) => {
      const checkbox = event.target.closest('input[type="checkbox"]');
      if (!checkbox) return;
      if (checkbox.checked) state.selectedServers.add(checkbox.value);
      else state.selectedServers.delete(checkbox.value);
      renderServerFilters();
      renderPlayers();
    });
    $('playerConsoleList').addEventListener('click', (event) => {
      const kick = event.target.closest('[data-player-kick]');
      const ban = event.target.closest('[data-player-ban]');
      if (kick) moderate('kick', kick.dataset.playerKick, kick.dataset.playerName).catch(() => {});
      if (ban) moderate('ban', ban.dataset.playerBan, ban.dataset.playerName).catch(() => {});
    });
    $('playerConsoleClearHistory').addEventListener('click', async () => {
      if (!confirm('Clear all local player moderation history?')) return;
      state.payload = await invoke('player-console:clear-history');
      render();
      notify('Moderation history cleared.');
    });
  }

  async function initialize() {
    ensureShell();
    window.khaos.onPlayerConsole?.((payload) => { state.payload = payload; render(); });
    await refreshState();
  }

  initialize().catch((error) => notify(`Players & Moderation failed to initialize: ${error.message}`));
})();
