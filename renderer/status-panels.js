'use strict';

(() => {
  const state = { payload: null, resources: null, selectedId: null };
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

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
    return ['owner', 'operator', 'local-admin'].includes(state.payload?.role);
  }

  function newId() {
    return `status-panel-${crypto.randomUUID()}`;
  }

  function panels() {
    return state.payload?.statusPanels?.panels || [];
  }

  function selectedPanel() {
    return state.selectedId ? panels().find((item) => item.id === state.selectedId) || null : panels()[0] || null;
  }

  function ensureShell() {
    if ($('view-status-panels')) return;
    const anchor = document.querySelector('[data-view="discord-automation"]') || document.querySelector('[data-view="discord-studio"]') || document.querySelector('[data-view="servers"]');
    if (anchor) {
      const button = document.createElement('button');
      button.className = 'nav-item';
      button.dataset.view = 'status-panels';
      button.innerHTML = '<span>◉</span>Status Panels';
      anchor.insertAdjacentElement('afterend', button);
    }

    const view = document.createElement('section');
    view.className = 'view';
    view.id = 'view-status-panels';
    view.innerHTML = `
      <div class="status-panel-hero">
        <div><span class="eyebrow">Discord Operations</span><h2>Persistent Server Status Panels</h2><p>Publish public-safe live server cards, keep one message updated automatically, and let members request a safe refresh without exposing credentials or player IDs.</p></div>
        <div class="status-panel-hero-actions"><button class="button" id="statusPanelLoadChannels">Load Discord Channels</button><button class="button" id="statusPanelRefreshAll">Refresh All Published</button><button class="button" id="statusPanelReload">Reload</button></div>
      </div>
      <div id="statusPanelSummary" class="status-panel-summary"></div>
      <div class="status-panel-workspace">
        <aside class="panel status-panel-list-panel">
          <div class="panel-heading"><div><span class="eyebrow">Persistent messages</span><h3>Configured Panels</h3></div><button class="button primary" id="statusPanelNew">New</button></div>
          <div id="statusPanelList" class="status-panel-list"></div>
        </aside>
        <article class="panel status-panel-editor">
          <div class="panel-heading"><div><span class="eyebrow">Public-safe live card</span><h3 id="statusPanelHeading">Server Status Panel</h3></div><span id="statusPanelState" class="severity">Draft</span></div>
          <input id="statusPanelId" type="hidden">
          <div class="form-grid three">
            <label>Panel name<input id="statusPanelName" maxlength="80"></label>
            <label>Game server<select id="statusPanelServer"></select></label>
            <label>Discord channel<select id="statusPanelChannel"></select></label>
          </div>
          <div class="form-grid three">
            <label>Refresh interval<select id="statusPanelInterval"><option value="1">Every minute</option><option value="2">Every 2 minutes</option><option value="5">Every 5 minutes</option><option value="10">Every 10 minutes</option><option value="15">Every 15 minutes</option><option value="30">Every 30 minutes</option><option value="60">Every hour</option></select></label>
            <label>Embed accent<input id="statusPanelColor" type="color" value="#e3264f"></label>
            <label class="toggle-row compact"><span><strong>Automatic refresh</strong><small>Pause without deleting the message.</small></span><input id="statusPanelEnabled" type="checkbox" checked></label>
          </div>
          <label>Embed title<input id="statusPanelTitle" maxlength="256"></label>
          <label>Description<textarea id="statusPanelDescription" rows="4" maxlength="1000"></textarea></label>
          <label class="toggle-row"><span><strong>Show connected player names</strong><small>Names only. Platform IDs, user IDs, IP addresses, and credentials are never included.</small></span><input id="statusPanelShowPlayers" type="checkbox"></label>
          <div class="status-panel-safety"><strong>Safe controls only</strong><span>The Discord buttons can refresh status or show the privacy-approved player summary. They cannot save, restart, kick, ban, or run raw commands.</span></div>
          <div id="statusPanelHealth" class="status-panel-health"></div>
          <div class="form-actions">
            <button class="button primary" id="statusPanelSave">Save Panel</button>
            <button class="button primary" id="statusPanelPublish">Publish / Update</button>
            <button class="button" id="statusPanelRefreshOne">Refresh Now</button>
            <button class="button" id="statusPanelDuplicate">Duplicate</button>
            <button class="button danger" id="statusPanelUnpublish">Delete Discord Message</button>
            <button class="button danger" id="statusPanelRemove">Remove Configuration</button>
          </div>
        </article>
      </div>`;
    document.querySelector('main.content')?.appendChild(view);
    bind();
  }

  function openView() {
    document.querySelectorAll('.view').forEach((element) => element.classList.toggle('active', element.id === 'view-status-panels'));
    document.querySelectorAll('.nav-item').forEach((element) => element.classList.toggle('active', element.dataset.view === 'status-panels'));
    if ($('viewTitle')) $('viewTitle').textContent = 'Server Status Panels';
    if ($('viewSubtitle')) $('viewSubtitle').textContent = 'Persistent Discord health cards with safe live controls and automatic refresh.';
    refresh().catch(() => {});
  }

  function serverOptions(selected = '') {
    const servers = (state.payload?.servers || []).filter((server) => server.enabled !== false);
    if (selected && !servers.some((server) => server.id === selected)) servers.unshift({ id: selected, name: `Saved server (${selected})`, game: 'unknown', hasPassword: false });
    return '<option value="">Select a server</option>' + servers.map((server) => `<option value="${escapeHtml(server.id)}" ${server.id === selected ? 'selected' : ''}>${escapeHtml(server.name)} • ${escapeHtml(String(server.game || 'generic').toUpperCase())}${server.hasPassword ? '' : ' • credentials missing'}</option>`).join('');
  }

  function channelOptions(selected = '') {
    const channels = [...(state.resources?.channels || [])];
    if (selected && !channels.some((channel) => channel.id === selected)) channels.unshift({ id: selected, name: `Saved channel (${selected})`, type: 0 });
    return '<option value="">Select a channel</option>' + channels.map((channel) => `<option value="${escapeHtml(channel.id)}" ${channel.id === selected ? 'selected' : ''}>#${escapeHtml(channel.name)}${Number(channel.type) === 5 ? ' • announcements' : ''}</option>`).join('');
  }

  function renderSummary() {
    const configured = panels().length;
    const published = panels().filter((panel) => panel.messageId).length;
    const enabled = panels().filter((panel) => panel.enabled && panel.messageId).length;
    const errors = panels().filter((panel) => panel.lastError).length;
    $('statusPanelSummary').innerHTML = `
      <article><span>Configured</span><strong>${configured}</strong><small>Persistent panel definitions</small></article>
      <article><span>Published</span><strong>${published}</strong><small>${enabled} refreshing automatically</small></article>
      <article><span>Health</span><strong>${errors ? `${errors} warning${errors === 1 ? '' : 's'}` : 'Healthy'}</strong><small>${errors ? 'Open a panel for details' : 'No stored delivery errors'}</small></article>
      <article><span>Discord Runtime</span><strong>${escapeHtml(state.payload?.bot?.status || (state.payload?.botConfigured ? 'configured' : 'not configured'))}</strong><small>${state.resources ? `${state.resources.channels.length} channels loaded` : 'Load channels before publishing'}</small></article>`;
  }

  function renderList() {
    const chosen = selectedPanel();
    if (chosen) state.selectedId = chosen.id;
    $('statusPanelList').innerHTML = panels().length ? panels().map((panel) => `
      <button class="status-panel-list-card ${panel.id === state.selectedId ? 'active' : ''}" data-status-panel-id="${escapeHtml(panel.id)}">
        <span class="status-panel-glyph">${panel.enabled ? '◉' : '○'}</span>
        <span><strong>${escapeHtml(panel.name)}</strong><small>${escapeHtml((state.payload?.servers || []).find((server) => server.id === panel.serverId)?.name || 'No server selected')} • ${panel.refreshMinutes} min</small></span>
        <span class="status-panel-dot ${panel.lastError ? 'error' : panel.messageId ? 'online' : ''}"></span>
      </button>`).join('') : '<div class="status-panel-empty">No server status panels configured.</div>';
  }

  function fillPanel(panel) {
    if (!panel) panel = {
      id: newId(), name: 'New Server Status Panel', serverId: '', guildId: state.payload?.guildId || '', channelId: '', messageId: '',
      title: 'Server Status', description: 'Live status supplied by Khaos Nexus.', color: '#e3264f', refreshMinutes: 5,
      enabled: true, showPlayerNames: false, publishedAt: null, lastRefreshedAt: null, lastError: ''
    };
    state.selectedId = panel.id;
    $('statusPanelId').value = panel.id;
    $('statusPanelName').value = panel.name || '';
    $('statusPanelServer').innerHTML = serverOptions(panel.serverId || '');
    $('statusPanelChannel').innerHTML = channelOptions(panel.channelId || '');
    $('statusPanelInterval').value = String(panel.refreshMinutes || 5);
    $('statusPanelColor').value = panel.color || '#e3264f';
    $('statusPanelEnabled').checked = panel.enabled !== false;
    $('statusPanelTitle').value = panel.title || '';
    $('statusPanelDescription').value = panel.description || '';
    $('statusPanelShowPlayers').checked = Boolean(panel.showPlayerNames);
    $('statusPanelHeading').textContent = panel.name || 'Server Status Panel';
    $('statusPanelState').textContent = panel.lastError ? 'Warning' : panel.messageId ? 'Published' : 'Draft';
    $('statusPanelState').classList.toggle('healthy', Boolean(panel.messageId && !panel.lastError));
    $('statusPanelState').classList.toggle('critical', Boolean(panel.lastError));
    $('statusPanelHealth').innerHTML = panel.lastError
      ? `<strong>Last delivery warning</strong><span>${escapeHtml(panel.lastError)}</span>`
      : panel.lastRefreshedAt
        ? `<strong>Last refreshed</strong><span>${escapeHtml(new Date(panel.lastRefreshedAt).toLocaleString())}${panel.publishedAt ? ` • Published ${escapeHtml(new Date(panel.publishedAt).toLocaleString())}` : ''}</span>`
        : '<strong>Not published yet</strong><span>Save the panel, load Discord channels, then publish the persistent message.</span>';
    document.querySelectorAll('#view-status-panels input, #view-status-panels textarea, #view-status-panels select, #view-status-panels button').forEach((element) => {
      if (!['statusPanelReload'].includes(element.id)) element.disabled = !canOperate();
    });
    $('statusPanelRefreshOne').disabled = !canOperate() || !panel.messageId;
    $('statusPanelUnpublish').disabled = !canOperate() || !panel.messageId;
    renderList();
  }

  function collectPanel() {
    const existing = selectedPanel();
    return {
      id: $('statusPanelId').value || newId(),
      name: $('statusPanelName').value,
      serverId: $('statusPanelServer').value,
      guildId: state.resources?.guildId || state.payload?.guildId || '',
      channelId: $('statusPanelChannel').value,
      messageId: existing?.messageId || '',
      title: $('statusPanelTitle').value,
      description: $('statusPanelDescription').value,
      color: $('statusPanelColor').value,
      refreshMinutes: Number($('statusPanelInterval').value),
      enabled: $('statusPanelEnabled').checked,
      showPlayerNames: $('statusPanelShowPlayers').checked,
      publishedAt: existing?.publishedAt || null,
      lastRefreshedAt: existing?.lastRefreshedAt || null,
      lastError: existing?.lastError || ''
    };
  }

  function render() {
    if (!state.payload) return;
    renderSummary();
    renderList();
    fillPanel(selectedPanel());
  }

  async function refresh() {
    state.payload = await invoke('status-panels:get');
    if (!state.selectedId) state.selectedId = panels()[0]?.id || null;
    render();
  }

  async function loadChannels() {
    state.resources = await invoke('status-panels:resources', state.payload?.guildId || '');
    notify(`Loaded ${state.resources.channels.length} Discord text channels.`);
    render();
  }

  async function savePanel() {
    state.payload = await invoke('status-panels:save', collectPanel());
    state.selectedId = $('statusPanelId').value;
    render();
    notify('Status panel saved.');
  }

  function bind() {
    document.addEventListener('click', (event) => {
      const nav = event.target.closest('[data-view="status-panels"]');
      if (nav) openView();
    });
    $('statusPanelLoadChannels').addEventListener('click', loadChannels);
    $('statusPanelReload').addEventListener('click', refresh);
    $('statusPanelRefreshAll').addEventListener('click', async () => {
      const result = await invoke('status-panels:refresh-all');
      state.payload = result.state;
      render();
      const failed = result.results.filter((item) => !item.ok).length;
      notify(failed ? `Refresh finished with ${failed} warning${failed === 1 ? '' : 's'}.` : `Refreshed ${result.results.length} published panels.`);
    });
    $('statusPanelNew').addEventListener('click', () => fillPanel(null));
    $('statusPanelList').addEventListener('click', (event) => {
      const item = event.target.closest('[data-status-panel-id]');
      if (!item) return;
      state.selectedId = item.dataset.statusPanelId;
      fillPanel(selectedPanel());
    });
    $('statusPanelSave').addEventListener('click', savePanel);
    $('statusPanelPublish').addEventListener('click', async () => {
      if (!state.resources) await loadChannels();
      await savePanel();
      const result = await invoke('status-panels:publish', $('statusPanelId').value);
      state.payload = result.state;
      render();
      notify(result.result.replaced ? 'Persistent status panel published.' : 'Persistent status panel updated.');
    });
    $('statusPanelRefreshOne').addEventListener('click', async () => {
      const panel = selectedPanel();
      if (!panel?.messageId) return;
      await invoke('status-panels:refresh', panel.id);
      await refresh();
      notify('Status panel refreshed.');
    });
    $('statusPanelDuplicate').addEventListener('click', () => {
      const panel = collectPanel();
      panel.id = newId();
      panel.name = `${panel.name} Copy`;
      panel.messageId = '';
      panel.publishedAt = null;
      panel.lastRefreshedAt = null;
      panel.lastError = '';
      fillPanel(panel);
    });
    $('statusPanelUnpublish').addEventListener('click', async () => {
      const panel = selectedPanel();
      if (!panel?.messageId || !confirm(`Delete the published Discord message for ${panel.name}?`)) return;
      state.payload = await invoke('status-panels:unpublish', panel.id);
      render();
      notify('Published Discord status message deleted.');
    });
    $('statusPanelRemove').addEventListener('click', async () => {
      const panel = selectedPanel();
      if (!panel || !confirm(`Remove ${panel.name}?`)) return;
      state.payload = await invoke('status-panels:remove', panel.id);
      state.selectedId = null;
      render();
      notify('Status panel configuration removed.');
    });
  }

  async function initialize() {
    ensureShell();
    window.khaos.onStatusPanels?.((payload) => { state.payload = payload; render(); });
    await refresh();
  }

  initialize().catch((error) => notify(`Status Panels failed to initialize: ${error.message}`));
})();
