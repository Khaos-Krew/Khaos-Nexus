'use strict';

(() => {
  const state = { payload: null, selectedProviderId: null, providerFilters: new Set(), filtersInitialized: false, query: '', timer: null };
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

  function canOperate() { return ['operator', 'owner', 'local-admin'].includes(state.payload?.role); }
  function canOwn() { return ['owner', 'local-admin'].includes(state.payload?.role); }
  function providers() { return state.payload?.config?.providers || []; }
  function servers() { return state.payload?.snapshot?.servers || []; }
  function selectedProvider() { return providers().find((provider) => provider.id === state.selectedProviderId) || null; }
  function newId() { return `hosted-provider-${crypto.randomUUID()}`; }

  function defaultProvider() {
    return {
      id: newId(), name: 'Pterodactyl Panel', type: 'pterodactyl', baseUrl: 'https://panel.example.com',
      enabled: true, allowInsecureHttp: false, requestTimeoutSeconds: 12, refreshSeconds: 30,
      lastConnectedAt: null, lastError: '', hasToken: false
    };
  }

  function ensureShell() {
    if (typeof viewMeta !== 'undefined') viewMeta['hosted-servers'] = ['Hosted Server Control', 'Provider-backed discovery, resource monitoring, and guarded power controls.'];
    if (!document.querySelector('[data-view="hosted-servers"]')) {
      const players = document.querySelector('[data-view="players"]') || document.querySelector('[data-view="scheduler"]') || document.querySelector('[data-view="servers"]');
      const button = document.createElement('button');
      button.className = 'nav-item';
      button.dataset.view = 'hosted-servers';
      button.innerHTML = '<span>⬡</span>Hosted Servers';
      players?.insertAdjacentElement('afterend', button);
    }
    if ($('view-hosted-servers')) return;

    const view = document.createElement('section');
    view.className = 'view';
    view.id = 'view-hosted-servers';
    view.innerHTML = `
      <div class="hosted-intro">
        <div><span class="eyebrow">Provider Operations</span><h2>Hosted Server Control</h2><p>Connect a Pterodactyl Client API key to discover servers, inspect live resources, and use guarded provider-backed power controls.</p></div>
        <div class="hosted-header-actions"><button class="button primary" id="hostedRefresh">Refresh Servers</button><button class="button" id="hostedNewProvider">New Provider</button><button class="button" id="hostedReload">Reload</button></div>
      </div>

      <div id="hostedSummary" class="hosted-summary"></div>

      <div class="hosted-provider-workspace">
        <aside class="panel hosted-provider-list-panel">
          <div class="panel-heading"><div><span class="eyebrow">Connections</span><h3>Providers</h3></div></div>
          <div id="hostedProviderList" class="hosted-provider-list"></div>
        </aside>

        <article class="panel hosted-provider-editor">
          <div class="panel-heading"><div><span class="eyebrow">Encrypted Connection</span><h3 id="hostedProviderTitle">Provider Setup</h3></div><span class="severity" id="hostedProviderState">Draft</span></div>
          <input id="hostedProviderId" type="hidden">
          <div class="form-grid three">
            <label>Provider name<input id="hostedProviderName" maxlength="100"></label>
            <label>Provider type<select id="hostedProviderType"><option value="pterodactyl">Pterodactyl Client API</option></select></label>
            <label>Panel URL<input id="hostedProviderUrl" placeholder="https://panel.example.com"></label>
          </div>
          <div class="form-grid three">
            <label>Request timeout (seconds)<input id="hostedProviderTimeout" type="number" min="3" max="60" value="12"></label>
            <label>Automatic refresh<select id="hostedProviderRefresh"><option value="0">Off</option><option value="15">Every 15 seconds</option><option value="30">Every 30 seconds</option><option value="60">Every minute</option><option value="120">Every 2 minutes</option><option value="300">Every 5 minutes</option></select></label>
            <label class="toggle-row compact"><span><strong>Provider enabled</strong><small>Disabled providers remain saved.</small></span><input id="hostedProviderEnabled" type="checkbox" checked></label>
          </div>
          <label>Client API key<input id="hostedProviderToken" type="password" autocomplete="new-password" placeholder="Leave blank to keep the saved key"></label>
          <label class="toggle-row"><span><strong>Allow insecure HTTP</strong><small>Only use this for a trusted local-network panel. Remote panels should use HTTPS.</small></span><input id="hostedProviderInsecure" type="checkbox"></label>
          <div class="hosted-security-note"><strong>Client key only</strong><span>Create a Client API key from the Pterodactyl account that owns or can access the desired servers. The key is encrypted with Windows secure storage and is never sent to the renderer after saving.</span></div>
          <div id="hostedProviderHealth" class="hosted-provider-health"></div>
          <div class="form-actions">
            <button class="button primary" id="hostedSaveProvider">Save Provider</button>
            <button class="button" id="hostedTestProvider">Test Connection</button>
            <button class="button danger" id="hostedRemoveProvider">Remove Provider</button>
          </div>
        </article>
      </div>

      <article class="panel hosted-server-panel">
        <div class="panel-heading"><div><span class="eyebrow">Live Provider Inventory</span><h3>Hosted Servers</h3></div><span class="severity" id="hostedSnapshotTime">Not refreshed</span></div>
        <div class="form-grid two hosted-search-row"><label>Search servers<input id="hostedSearch" placeholder="Server, provider, node, or state"></label><div id="hostedProviderFilters" class="hosted-provider-filters"></div></div>
        <div id="hostedErrors" class="hosted-errors"></div>
        <div id="hostedServerGrid" class="hosted-server-grid"></div>
      </article>

      <article class="panel hosted-history-panel">
        <div class="panel-heading"><div><span class="eyebrow">Audit Trail</span><h3>Power Action History</h3></div><button class="button danger" id="hostedClearHistory">Clear</button></div>
        <div id="hostedHistory" class="hosted-history"></div>
      </article>`;
    document.querySelector('main.content')?.appendChild(view);
    bind();
  }

  function openView() {
    document.querySelectorAll('.view').forEach((element) => element.classList.toggle('active', element.id === 'view-hosted-servers'));
    document.querySelectorAll('.nav-item').forEach((element) => element.classList.toggle('active', element.dataset.view === 'hosted-servers'));
    if ($('viewTitle')) $('viewTitle').textContent = 'Hosted Server Control';
    if ($('viewSubtitle')) $('viewSubtitle').textContent = 'Provider-backed discovery, resource monitoring, and guarded power controls.';
    refreshServers().catch(() => {});
  }

  function formatDate(value, fallback = 'Never') {
    if (!value) return fallback;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : fallback;
  }

  function initializeFilters() {
    if (state.filtersInitialized || !state.payload) return;
    for (const provider of providers()) if (provider.enabled !== false) state.providerFilters.add(provider.id);
    state.filtersInitialized = true;
  }

  function filteredServers() {
    const query = state.query.trim().toLowerCase();
    return servers().filter((server) => {
      if (state.filtersInitialized && !state.providerFilters.has(server.providerId)) return false;
      if (!query) return true;
      return `${server.name} ${server.providerName} ${server.node} ${server.resources?.currentState || server.panelStatus}`.toLowerCase().includes(query);
    });
  }

  function renderSummary() {
    const snapshot = state.payload?.snapshot || {};
    const onlineProviders = (snapshot.providers || []).filter((provider) => provider.status === 'online').length;
    const liveServers = (snapshot.servers || []).filter((server) => server.resources?.currentState === 'running').length;
    const totalServers = snapshot.servers?.length || 0;
    const errors = snapshot.errors?.length || 0;
    $('hostedSummary').innerHTML = `
      <article><span>Providers</span><strong>${providers().length}</strong><small>${onlineProviders} connected</small></article>
      <article><span>Discovered Servers</span><strong>${totalServers}</strong><small>${liveServers} currently running</small></article>
      <article><span>Connection Health</span><strong>${errors ? `${errors} warning${errors === 1 ? '' : 's'}` : 'Healthy'}</strong><small>${errors ? 'Review provider errors below' : 'No provider-level errors'}</small></article>
      <article><span>Access</span><strong>${escapeHtml(state.payload?.role || 'viewer')}</strong><small>${canOwn() ? 'All power controls' : canOperate() ? 'Start, restart, and stop' : 'View only'}</small></article>`;
  }

  function renderProviderList() {
    $('hostedProviderList').innerHTML = providers().length ? providers().map((provider) => `
      <button class="hosted-provider-card ${provider.id === state.selectedProviderId ? 'active' : ''}" data-hosted-provider="${escapeHtml(provider.id)}">
        <span class="hosted-provider-icon">⬡</span>
        <span><strong>${escapeHtml(provider.name)}</strong><small>${escapeHtml(provider.baseUrl)} • ${provider.hasToken ? 'key saved' : 'key missing'}</small></span>
        <span class="hosted-dot ${provider.lastError ? 'error' : provider.lastConnectedAt ? 'online' : provider.enabled ? 'ready' : 'disabled'}"></span>
      </button>`).join('') : '<div class="hosted-empty">No hosted providers configured.</div>';
  }

  function fillProvider(providerInput) {
    const provider = providerInput || defaultProvider();
    state.selectedProviderId = provider.id;
    $('hostedProviderId').value = provider.id;
    $('hostedProviderName').value = provider.name || '';
    $('hostedProviderType').value = provider.type || 'pterodactyl';
    $('hostedProviderUrl').value = provider.baseUrl || '';
    $('hostedProviderTimeout').value = provider.requestTimeoutSeconds || 12;
    $('hostedProviderRefresh').value = String(provider.refreshSeconds ?? 30);
    $('hostedProviderEnabled').checked = provider.enabled !== false;
    $('hostedProviderInsecure').checked = Boolean(provider.allowInsecureHttp);
    $('hostedProviderToken').value = '';
    $('hostedProviderTitle').textContent = provider.name || 'Provider Setup';
    $('hostedProviderState').textContent = provider.lastError ? 'Warning' : provider.lastConnectedAt ? 'Connected' : provider.hasToken ? 'Configured' : providers().some((item) => item.id === provider.id) ? 'Key Needed' : 'Draft';
    $('hostedProviderState').className = `severity ${provider.lastError ? 'bad' : provider.lastConnectedAt ? 'good' : ''}`;
    $('hostedProviderHealth').innerHTML = provider.lastError
      ? `<strong>Last connection error</strong><span>${escapeHtml(provider.lastError)}</span>`
      : provider.lastConnectedAt
        ? `<strong>Last connected</strong><span>${escapeHtml(formatDate(provider.lastConnectedAt))}</span>`
        : `<strong>${provider.hasToken ? 'Ready to test' : 'Client API key required'}</strong><span>${provider.hasToken ? 'Test the connection or refresh hosted servers.' : 'Save the provider, then enter and save a Client API key.'}</span>`;
    applyPermissions();
    renderProviderList();
  }

  function collectProvider() {
    const existing = selectedProvider() || {};
    return {
      ...existing,
      id: $('hostedProviderId').value || newId(),
      name: $('hostedProviderName').value,
      type: $('hostedProviderType').value,
      baseUrl: $('hostedProviderUrl').value,
      requestTimeoutSeconds: Number($('hostedProviderTimeout').value),
      refreshSeconds: Number($('hostedProviderRefresh').value),
      enabled: $('hostedProviderEnabled').checked,
      allowInsecureHttp: $('hostedProviderInsecure').checked
    };
  }

  function renderProviderFilters() {
    $('hostedProviderFilters').innerHTML = providers().map((provider) => `
      <label class="hosted-provider-filter ${state.providerFilters.has(provider.id) ? 'selected' : ''}"><input type="checkbox" value="${escapeHtml(provider.id)}" ${state.providerFilters.has(provider.id) ? 'checked' : ''}><span>${escapeHtml(provider.name)}</span></label>`).join('') || '<span class="hosted-filter-empty">Add a provider to begin.</span>';
  }

  function statusTone(server) {
    if (server.suspended) return 'suspended';
    if (server.installing || server.transferring) return 'transition';
    return server.resources?.currentState || server.panelStatus || 'unknown';
  }

  function percent(value, limit) {
    const number = Number(value) || 0;
    const maximum = Number(limit) || 0;
    return maximum > 0 ? Math.min(100, Math.max(0, number / maximum * 100)) : 0;
  }

  function renderServers() {
    const list = filteredServers();
    $('hostedSnapshotTime').textContent = state.payload?.snapshot?.refreshedAt ? `Updated ${formatDate(state.payload.snapshot.refreshedAt)}` : 'Not refreshed';
    $('hostedServerGrid').innerHTML = list.length ? list.map((server) => {
      const resources = server.resources || {};
      const memoryLimitBytes = (server.limits?.memoryMb || 0) * 1024 * 1024;
      const diskLimitBytes = (server.limits?.diskMb || 0) * 1024 * 1024;
      const tone = statusTone(server);
      return `
        <article class="hosted-server-card ${escapeHtml(tone)}">
          <div class="hosted-server-heading"><span class="hosted-server-symbol">⬡</span><span><strong>${escapeHtml(server.name)}</strong><small>${escapeHtml(server.providerName)}${server.node ? ` • ${escapeHtml(server.node)}` : ''}</small></span><span class="hosted-state">${escapeHtml(tone.replaceAll('_', ' '))}</span></div>
          ${server.description ? `<p>${escapeHtml(server.description)}</p>` : ''}
          <div class="hosted-resource-grid">
            <div><span>CPU</span><strong>${resources.cpuPercent === undefined ? '—' : `${Math.round(resources.cpuPercent * 10) / 10}%`}</strong><i style="--usage:${Math.min(100, resources.cpuPercent || 0)}%"></i></div>
            <div><span>Memory</span><strong>${server.display?.memory || '—'}</strong><i style="--usage:${percent(resources.memoryBytes, memoryLimitBytes)}%"></i></div>
            <div><span>Disk</span><strong>${server.display?.disk || '—'}</strong><i style="--usage:${percent(resources.diskBytes, diskLimitBytes)}%"></i></div>
            <div><span>Uptime</span><strong>${server.display?.uptime || '—'}</strong><i style="--usage:0%"></i></div>
          </div>
          ${server.resourceError ? `<div class="hosted-resource-error">Resources unavailable: ${escapeHtml(server.resourceError)}</div>` : ''}
          <div class="hosted-server-actions">
            <button class="button" data-hosted-signal="start" data-hosted-token="${escapeHtml(server.token)}" data-hosted-name="${escapeHtml(server.name)}" ${canOperate() ? '' : 'disabled'}>Start</button>
            <button class="button" data-hosted-signal="restart" data-hosted-token="${escapeHtml(server.token)}" data-hosted-name="${escapeHtml(server.name)}" ${canOperate() ? '' : 'disabled'}>Restart</button>
            <button class="button danger-subtle" data-hosted-signal="stop" data-hosted-token="${escapeHtml(server.token)}" data-hosted-name="${escapeHtml(server.name)}" ${canOperate() ? '' : 'disabled'}>Stop</button>
            <button class="button danger" data-hosted-signal="kill" data-hosted-token="${escapeHtml(server.token)}" data-hosted-name="${escapeHtml(server.name)}" ${canOwn() ? '' : 'disabled'}>Emergency Kill</button>
          </div>
        </article>`;
    }).join('') : `<div class="hosted-empty">${state.payload?.snapshot?.refreshedAt ? 'No hosted servers match the current filters.' : 'Save a provider and refresh to discover servers.'}</div>`;
  }

  function renderErrors() {
    const errors = state.payload?.snapshot?.errors || [];
    $('hostedErrors').innerHTML = errors.length ? `<div class="hosted-error-banner"><strong>${errors.length} provider warning${errors.length === 1 ? '' : 's'}</strong>${errors.map((error) => `<span>${escapeHtml(error.providerName)}: ${escapeHtml(error.message)}</span>`).join('')}</div>` : '';
  }

  function renderHistory() {
    const history = state.payload?.history || [];
    $('hostedHistory').innerHTML = history.length ? history.map((entry) => `
      <article class="hosted-history-entry ${escapeHtml(entry.outcome)}">
        <span class="hosted-history-icon">${entry.outcome === 'success' ? '✓' : '!'}</span>
        <span><strong>${escapeHtml(entry.signal.toUpperCase())}: ${escapeHtml(entry.serverName)}</strong><small>${escapeHtml(entry.providerName)} • ${escapeHtml(formatDate(entry.time))} • ${escapeHtml(entry.actorName)}</small><p>${escapeHtml(entry.message)}</p></span>
      </article>`).join('') : '<div class="hosted-empty">No provider power actions have been recorded.</div>';
  }

  function applyPermissions() {
    document.querySelectorAll('#view-hosted-servers input, #view-hosted-servers select').forEach((element) => {
      if (!['hostedSearch'].includes(element.id) && !element.closest('#hostedProviderFilters')) element.disabled = !canOwn();
    });
    ['hostedNewProvider', 'hostedSaveProvider', 'hostedTestProvider', 'hostedRemoveProvider', 'hostedClearHistory'].forEach((id) => { if ($(id)) $(id).disabled = !canOwn(); });
  }

  function scheduleAutoRefresh() {
    clearInterval(state.timer);
    state.timer = null;
    const seconds = providers().filter((provider) => provider.enabled && state.providerFilters.has(provider.id) && provider.refreshSeconds > 0).map((provider) => provider.refreshSeconds).sort((a, b) => a - b)[0];
    if (seconds) state.timer = setInterval(() => { if ($('view-hosted-servers')?.classList.contains('active')) refreshServers().catch(() => {}); }, seconds * 1000);
  }

  function render() {
    if (!state.payload) return;
    initializeFilters();
    if (!state.selectedProviderId && providers()[0]) state.selectedProviderId = providers()[0].id;
    renderSummary();
    renderProviderList();
    fillProvider(selectedProvider() || defaultProvider());
    renderProviderFilters();
    renderErrors();
    renderServers();
    renderHistory();
    applyPermissions();
    scheduleAutoRefresh();
  }

  async function refreshState() {
    state.payload = await invoke('hosted-server:get');
    render();
  }

  async function refreshServers() {
    state.payload = await invoke('hosted-server:refresh', [...state.providerFilters]);
    render();
    notify(`Hosted inventory refreshed: ${servers().length} server${servers().length === 1 ? '' : 's'}.`);
  }

  async function saveProvider() {
    const provider = collectProvider();
    state.payload = await invoke('hosted-server:save-provider', provider);
    state.selectedProviderId = provider.id;
    state.providerFilters.add(provider.id);
    const token = $('hostedProviderToken').value.trim();
    if (token) state.payload = await invoke('hosted-server:set-token', { providerId: provider.id, token });
    render();
    notify('Hosted provider saved with protected credentials.');
  }

  async function power(signal, token, serverName) {
    if (signal === 'kill') {
      const typed = prompt(`Emergency kill immediately terminates ${serverName} and may cause data loss. Type the server name exactly to continue:`);
      if (typed !== serverName) return notify('Emergency kill cancelled; the server name did not match.');
    } else {
      const descriptions = {
        start: `Start ${serverName}?`,
        restart: `Restart ${serverName} through Pterodactyl?`,
        stop: `Stop ${serverName}? The game process will receive the configured stop command.`
      };
      if (!confirm(descriptions[signal])) return;
    }
    const result = await invoke('hosted-server:power', { token, signal, serverName });
    state.payload = result.state;
    render();
    notify(`${signal} signal accepted for ${serverName}.`);
    setTimeout(() => refreshServers().catch(() => {}), signal === 'start' ? 2500 : 1500);
  }

  function bind() {
    document.addEventListener('click', (event) => { if (event.target.closest('[data-view="hosted-servers"]')) openView(); });
    $('hostedRefresh').addEventListener('click', refreshServers);
    $('hostedReload').addEventListener('click', refreshState);
    $('hostedNewProvider').addEventListener('click', () => fillProvider(defaultProvider()));
    $('hostedProviderList').addEventListener('click', (event) => {
      const item = event.target.closest('[data-hosted-provider]');
      if (!item) return;
      state.selectedProviderId = item.dataset.hostedProvider;
      fillProvider(selectedProvider());
    });
    $('hostedSaveProvider').addEventListener('click', saveProvider);
    $('hostedTestProvider').addEventListener('click', async () => {
      const provider = selectedProvider();
      if (!provider) return notify('Save the provider before testing it.');
      const result = await invoke('hosted-server:test-provider', provider.id);
      state.payload = result.state;
      render();
      notify(`Connected to Pterodactyl and discovered ${result.result.serverCount} server${result.result.serverCount === 1 ? '' : 's'}.`);
    });
    $('hostedRemoveProvider').addEventListener('click', async () => {
      const provider = selectedProvider();
      if (!provider || !confirm(`Remove ${provider.name} and its encrypted API key?`)) return;
      state.payload = await invoke('hosted-server:remove-provider', provider.id);
      state.providerFilters.delete(provider.id);
      state.selectedProviderId = null;
      render();
      notify('Hosted provider removed.');
    });
    $('hostedSearch').addEventListener('input', (event) => { state.query = event.target.value; renderServers(); });
    $('hostedProviderFilters').addEventListener('change', (event) => {
      const checkbox = event.target.closest('input[type="checkbox"]');
      if (!checkbox) return;
      if (checkbox.checked) state.providerFilters.add(checkbox.value); else state.providerFilters.delete(checkbox.value);
      renderProviderFilters(); renderServers(); scheduleAutoRefresh();
    });
    $('hostedServerGrid').addEventListener('click', (event) => {
      const button = event.target.closest('[data-hosted-signal]');
      if (button) power(button.dataset.hostedSignal, button.dataset.hostedToken, button.dataset.hostedName).catch(() => {});
    });
    $('hostedClearHistory').addEventListener('click', async () => {
      if (!confirm('Clear all local hosted-server power history?')) return;
      state.payload = await invoke('hosted-server:clear-history');
      render(); notify('Hosted-server history cleared.');
    });
  }

  async function initialize() {
    ensureShell();
    window.khaos.onHostedServer?.((payload) => { state.payload = payload; render(); });
    await refreshState();
  }

  initialize().catch((error) => notify(`Hosted Server Control failed to initialize: ${error.message}`));
})();
