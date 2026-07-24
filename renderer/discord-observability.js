'use strict';

(() => {
  const TYPES = ['releases', 'errors', 'heartbeat', 'health'];
  const META = {
    releases: { icon: '↗', title: 'Release Feed', description: 'Stable versions, release notes, availability, and installed-version confirmations.' },
    errors: { icon: '!', title: 'Error Feed', description: 'Redacted error IDs, sources, severity, safe summaries, and report links.' },
    heartbeat: { icon: '⌁', title: 'Heartbeat Panel', description: 'One persistent Discord message edited on schedule with live operational state.' },
    health: { icon: '◇', title: 'Health Events', description: 'Only meaningful runtime transitions such as online, stopped, degraded, error, and recovered.' }
  };
  const ui = { payload: null, channels: [], appState: null, initialized: false };
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

  function canOwn() {
    const role = ui.appState?.autonomy?.access?.role || 'local-admin';
    return role === 'owner' || role === 'local-admin';
  }

  function canOperate() {
    const role = ui.appState?.autonomy?.access?.role || 'local-admin';
    return ['operator', 'owner', 'local-admin'].includes(role);
  }

  function ensureNavigation() {
    if ($('observabilityNavButton')) return;
    const reference = document.querySelector('[data-view="discord-automation"]') || document.querySelector('[data-view="setup"]');
    if (!reference) return;
    const button = document.createElement('button');
    button.id = 'observabilityNavButton';
    button.className = 'nav-item';
    button.dataset.view = 'observability';
    button.innerHTML = '<span>◉</span>Discord Observability';
    reference.insertAdjacentElement('afterend', button);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      openView();
    }, true);
  }

  function ensureView() {
    if ($('view-observability')) return;
    const section = document.createElement('section');
    section.className = 'view';
    section.id = 'view-observability';
    section.innerHTML = `
      <div class="observability-center">
        <section class="observability-hero">
          <div>
            <span class="eyebrow">Discord Operations Network</span>
            <h2>Observability & Delivery</h2>
            <p>Route releases, redacted errors, heartbeat state, and live health transitions to independent Discord channels. Each stream has its own channel, role mention, severity threshold, cooldown, test, and delivery history.</p>
          </div>
          <div class="observability-master">
            <label class="toggle-row"><span><strong>Enable Discord observability</strong><small>The master switch must be active before automatic deliveries are sent.</small></span><input id="observabilityEnabled" type="checkbox"></label>
            <div class="observability-master-grid">
              <label>Heartbeat interval<select id="observabilityHeartbeatInterval"><option value="1">Every minute</option><option value="5">Every 5 minutes</option><option value="15">Every 15 minutes</option><option value="30">Every 30 minutes</option><option value="60">Hourly</option><option value="360">Every 6 hours</option><option value="1440">Daily</option></select></label>
              <label>Server names<select id="observabilityServerNames"><option value="true">Show configured names</option><option value="false">Show totals only</option></select></label>
            </div>
          </div>
        </section>
        <div class="observability-summary" id="observabilitySummary"></div>
        <div class="observability-toolbar panel">
          <button class="button" id="observabilityLoadChannels">Load Discord Channels</button>
          <button class="button" id="observabilityRefreshHeartbeat">Refresh Heartbeat</button>
          <button class="button" id="observabilityRecreateHeartbeat">Recreate Heartbeat Message</button>
          <span class="spacer"></span>
          <button class="button" id="observabilityClearHistory">Clear History</button>
          <button class="button primary" id="observabilitySave">Save Routing</button>
        </div>
        <div class="observability-route-grid" id="observabilityRoutes"></div>
        <article class="panel observability-history">
          <div class="panel-heading"><div><span class="eyebrow">Delivery Audit</span><h3>Recent Discord deliveries</h3><p>Safe local history of sent, edited, tested, skipped, and failed deliveries.</p></div><span class="severity" id="observabilityHistoryCount">0 records</span></div>
          <div class="observability-history-list" id="observabilityHistory"></div>
        </article>
      </div>`;
    document.querySelector('main.content')?.appendChild(section);
    bindView();
  }

  function openView() {
    ensureNavigation();
    ensureView();
    document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === 'view-observability'));
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === 'observability'));
    if ($('viewTitle')) $('viewTitle').textContent = 'Discord Observability';
    if ($('viewSubtitle')) $('viewSubtitle').textContent = 'Route releases, errors, heartbeat, and health events to dedicated Discord channels.';
    refresh().catch(() => {});
  }

  function channelOptions(selected) {
    const options = ['<option value="">Choose a Discord channel</option>'];
    for (const channel of ui.channels) {
      options.push(`<option class="observability-channel-option" value="${escapeHtml(channel.id)}" ${channel.id === selected ? 'selected' : ''}>#${escapeHtml(channel.name)}${channel.type === 'announcement' ? ' • announcement' : ''}</option>`);
    }
    if (selected && !ui.channels.some((channel) => channel.id === selected)) options.push(`<option value="${escapeHtml(selected)}" selected>Saved channel • ${escapeHtml(selected)}</option>`);
    return options.join('');
  }

  function routeCard(type) {
    const config = ui.payload?.config || {};
    const route = config.routes?.[type] || {};
    const runtime = ui.payload?.runtime?.[type] || {};
    const meta = META[type];
    const disableOwner = canOwn() ? '' : 'disabled';
    const disableOperator = canOperate() ? '' : 'disabled';
    return `
      <article class="observability-route ${route.enabled ? 'enabled' : ''}" data-observability-route="${type}">
        <div class="observability-route-header">
          <div class="observability-route-title"><span class="observability-route-icon">${meta.icon}</span><div><h3>${meta.title}</h3><p>${meta.description}</p></div></div>
          <label class="compact-toggle"><input type="checkbox" data-route-field="enabled" ${route.enabled ? 'checked' : ''} ${disableOwner}><span></span></label>
        </div>
        <div class="observability-route-grid-fields">
          <label class="wide">Discord channel<select data-route-field="channelId" ${disableOwner}>${channelOptions(route.channelId || '')}</select></label>
          <label>Optional mention role<input data-route-field="mentionRoleId" inputmode="numeric" value="${escapeHtml(route.mentionRoleId || '')}" placeholder="Role ID or blank" ${disableOwner}></label>
          <label>Minimum severity<select data-route-field="minimumSeverity" ${disableOwner}><option value="info" ${route.minimumSeverity === 'info' ? 'selected' : ''}>Information</option><option value="warning" ${route.minimumSeverity === 'warning' ? 'selected' : ''}>Warning</option><option value="error" ${route.minimumSeverity === 'error' ? 'selected' : ''}>Error</option><option value="critical" ${route.minimumSeverity === 'critical' ? 'selected' : ''}>Critical</option></select></label>
          <label>Duplicate cooldown<input data-route-field="cooldownSeconds" type="number" min="0" max="86400" value="${Number(route.cooldownSeconds || 0)}" ${disableOwner}></label>
          <label>Persistent message<input value="${escapeHtml(type === 'heartbeat' ? (route.messageId || 'Not published') : 'Feed messages') }" disabled></label>
        </div>
        <div class="observability-route-footer">
          <button class="button" data-observability-test="${type}" ${disableOperator}>Send Test</button>
          ${type === 'heartbeat' ? `<button class="button" data-observability-heartbeat="refresh" ${disableOperator}>Refresh Now</button>` : ''}
          <span class="observability-route-runtime ${escapeHtml(runtime.status || 'idle')}">${escapeHtml(runtime.status || 'idle')}${runtime.lastError ? ` • ${escapeHtml(runtime.lastError)}` : ''}</span>
        </div>
      </article>`;
  }

  function renderSummary() {
    const config = ui.payload?.config || {};
    const runtime = ui.payload?.runtime || {};
    const enabledRoutes = TYPES.filter((type) => config.routes?.[type]?.enabled && config.routes?.[type]?.channelId).length;
    const failures = (config.deliveryHistory || []).filter((entry) => entry.status === 'failed').length;
    const ready = TYPES.filter((type) => runtime[type]?.status === 'ready').length;
    $('observabilitySummary').innerHTML = `
      <article><span>Master state</span><strong>${config.enabled ? 'Enabled' : 'Disabled'}</strong><small>${enabledRoutes} routed streams</small></article>
      <article><span>Healthy routes</span><strong>${ready} / 4</strong><small>Last runtime delivery state</small></article>
      <article><span>Heartbeat</span><strong>${config.heartbeatIntervalMinutes || 15}m</strong><small>${config.lastHeartbeatAt ? `Last ${new Date(config.lastHeartbeatAt).toLocaleString()}` : 'Not published yet'}</small></article>
      <article><span>Delivery failures</span><strong>${failures}</strong><small>Within the retained local history</small></article>`;
  }

  function renderHistory() {
    const history = [...(ui.payload?.config?.deliveryHistory || [])].reverse();
    $('observabilityHistoryCount').textContent = `${history.length} record${history.length === 1 ? '' : 's'}`;
    $('observabilityHistory').innerHTML = history.length ? history.map((entry) => `
      <div class="observability-history-row">
        <span class="observability-history-type">${escapeHtml(META[entry.type]?.title || entry.type)}</span>
        <span class="observability-history-status ${escapeHtml(entry.status)}">${escapeHtml(entry.status)}</span>
        <span>${escapeHtml(entry.error || entry.summary || 'Delivery recorded')}</span>
        <small>${escapeHtml(new Date(entry.createdAt).toLocaleString())}</small>
      </div>`).join('') : '<div class="observability-empty">No Discord observability deliveries have been recorded.</div>';
  }

  function render() {
    if (!ui.payload) return;
    const config = ui.payload.config || {};
    $('observabilityEnabled').checked = Boolean(config.enabled);
    $('observabilityHeartbeatInterval').value = String(config.heartbeatIntervalMinutes || 15);
    $('observabilityServerNames').value = config.includeServerNames === false ? 'false' : 'true';
    $('observabilityRoutes').innerHTML = TYPES.map(routeCard).join('');
    $('observabilitySave').disabled = !canOwn();
    $('observabilityClearHistory').disabled = !canOwn();
    $('observabilityRefreshHeartbeat').disabled = !canOperate();
    $('observabilityRecreateHeartbeat').disabled = !canOperate();
    renderSummary();
    renderHistory();
  }

  function collectConfig() {
    const current = JSON.parse(JSON.stringify(ui.payload?.config || {}));
    current.enabled = $('observabilityEnabled').checked;
    current.heartbeatIntervalMinutes = Number($('observabilityHeartbeatInterval').value || 15);
    current.includeServerNames = $('observabilityServerNames').value !== 'false';
    current.routes ||= {};
    document.querySelectorAll('[data-observability-route]').forEach((card) => {
      const type = card.dataset.observabilityRoute;
      current.routes[type] ||= {};
      card.querySelectorAll('[data-route-field]').forEach((input) => {
        const field = input.dataset.routeField;
        current.routes[type][field] = input.type === 'checkbox' ? input.checked : field === 'cooldownSeconds' ? Number(input.value || 0) : input.value;
      });
    });
    return current;
  }

  async function loadChannels() {
    const channels = await invoke('discord-observability:list-channels');
    ui.channels = Array.isArray(channels) ? channels : [];
    render();
    notify(`Loaded ${ui.channels.length} Discord channel${ui.channels.length === 1 ? '' : 's'}.`);
  }

  async function save() {
    ui.payload = await invoke('discord-observability:save', collectConfig());
    render();
    notify('Discord observability routing saved.');
  }

  async function refresh() {
    ui.payload = await invoke('discord-observability:get');
    render();
  }

  function bindView() {
    $('observabilityLoadChannels').addEventListener('click', loadChannels);
    $('observabilitySave').addEventListener('click', save);
    $('observabilityRefreshHeartbeat').addEventListener('click', async () => { await invoke('discord-observability:heartbeat', { recreate: false }); await refresh(); notify('Heartbeat panel refreshed.'); });
    $('observabilityRecreateHeartbeat').addEventListener('click', async () => { await invoke('discord-observability:heartbeat', { recreate: true }); await refresh(); notify('Heartbeat message recreated.'); });
    $('observabilityClearHistory').addEventListener('click', async () => {
      if (!window.confirm('Clear the local Discord observability delivery history? Published Discord messages are not deleted.')) return;
      ui.payload = await invoke('discord-observability:clear-history'); render(); notify('Delivery history cleared.');
    });
    $('observabilityRoutes').addEventListener('click', async (event) => {
      const test = event.target.closest('[data-observability-test]');
      const heartbeat = event.target.closest('[data-observability-heartbeat]');
      if (test) { await invoke('discord-observability:test', test.dataset.observabilityTest); await refresh(); notify(`${META[test.dataset.observabilityTest].title} test sent.`); }
      if (heartbeat) { await invoke('discord-observability:heartbeat', { recreate: false }); await refresh(); notify('Heartbeat panel refreshed.'); }
    });
    $('observabilityRoutes').addEventListener('change', (event) => {
      const card = event.target.closest('[data-observability-route]');
      if (card && event.target.dataset.routeField === 'enabled') card.classList.toggle('enabled', event.target.checked);
    });
  }

  async function initialize() {
    if (ui.initialized) return;
    ui.initialized = true;
    ensureNavigation();
    ensureView();
    window.khaos.onState((state) => { ui.appState = state; if ($('view-observability')?.classList.contains('active')) render(); });
    window.khaos.onDiscordObservability?.((payload) => { ui.payload = payload; if ($('view-observability')?.classList.contains('active')) render(); });
    ui.appState = await invoke('app:get-state').catch(() => null);
    await refresh();
  }

  initialize().catch((error) => notify(`Discord Observability failed to initialize: ${error.message}`));
})();
