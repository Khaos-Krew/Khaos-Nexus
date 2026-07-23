'use strict';

(() => {
  const studio = {
    payload: null,
    channels: [],
    selectedTemplateId: null,
    selectedPanelId: null,
    activeTab: 'embeds',
    initialized: false
  };
  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
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

  function canEdit() {
    return ['owner', 'operator', 'local-admin'].includes(studio.payload?.role);
  }

  function newId(prefix) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  function ensureShell() {
    if ($('view-discord-studio')) return;
    const discordNav = document.querySelector('[data-view="setup"]');
    if (discordNav) {
      const button = document.createElement('button');
      button.className = 'nav-item';
      button.dataset.view = 'discord-studio';
      button.innerHTML = '<span>⬡</span>Discord Studio';
      discordNav.insertAdjacentElement('afterend', button);
    }

    const view = document.createElement('section');
    view.className = 'view';
    view.id = 'view-discord-studio';
    view.innerHTML = `
      <div class="studio-hero">
        <div><span class="eyebrow">Discord Automation</span><h2>Embed & Status Studio</h2><p>Design reusable Nexus embeds, discover bot-accessible channels, and maintain persistent public-safe game-server status panels.</p></div>
        <div class="studio-hero-actions"><button class="button" id="studioLoadChannels">Load Channels</button><button class="button" id="studioRefreshAll">Refresh All Panels</button></div>
      </div>
      <div class="studio-tabs"><button class="active" data-studio-tab="embeds">Embed Studio</button><button data-studio-tab="panels">Server Status Panels</button></div>
      <div class="studio-tab active" id="studio-tab-embeds">
        <div class="studio-layout">
          <aside class="panel studio-list-panel"><div class="panel-heading"><div><span class="eyebrow">Library</span><h3>Embed Templates</h3></div><button class="button primary" id="studioNewTemplate">New</button></div><div id="studioTemplateList" class="studio-card-list"></div></aside>
          <article class="panel studio-editor-panel">
            <div class="panel-heading"><div><span class="eyebrow">Builder</span><h3 id="studioTemplateHeading">Embed Template</h3></div><span class="severity" id="studioTemplateKindBadge">Custom</span></div>
            <input id="studioTemplateId" type="hidden">
            <div class="form-grid three"><label>Template name<input id="studioTemplateName" maxlength="80"></label><label>Type<select id="studioTemplateKind"><option value="custom">Custom</option><option value="announcement">Announcement</option><option value="server-status">Server status</option></select></label><label>Accent color<input id="studioTemplateColor" type="color" value="#e3264f"></label></div>
            <label>Message text <small>Optional text above the embed.</small><textarea id="studioTemplateContent" rows="2" maxlength="2000"></textarea></label>
            <label>Embed title<input id="studioTemplateTitle" maxlength="256" placeholder="{{server.name}}"></label>
            <label>Description<textarea id="studioTemplateDescription" rows="5" maxlength="4096"></textarea></label>
            <div class="form-grid"><label>Thumbnail URL<input id="studioTemplateThumbnail" placeholder="https://..."></label><label>Banner image URL<input id="studioTemplateImage" placeholder="https://..."></label></div>
            <div class="form-grid"><label>Footer text<input id="studioTemplateFooter" maxlength="2048"></label><label>Footer icon URL<input id="studioTemplateFooterIcon" placeholder="https://..."></label></div>
            <div class="studio-toggle-grid"><label class="toggle-row"><span><strong>Use live status color</strong><small>Green online and red offline for server panels.</small></span><input id="studioTemplateStatusColor" type="checkbox"></label><label class="toggle-row"><span><strong>Add timestamp</strong><small>Shows when the message was generated.</small></span><input id="studioTemplateTimestamp" type="checkbox"></label></div>
            <section class="studio-builder-section"><div class="panel-heading"><div><span class="eyebrow">Structured content</span><h3>Fields</h3></div><button class="button" id="studioAddField">Add Field</button></div><div id="studioFieldRows" class="studio-row-list"></div></section>
            <section class="studio-builder-section"><div class="panel-heading"><div><span class="eyebrow">Components</span><h3>Link Buttons</h3></div><button class="button" id="studioAddButton">Add Button</button></div><div id="studioButtonRows" class="studio-row-list"></div></section>
            <div class="studio-placeholder-help"><strong>Server placeholders:</strong> {{server.name}}, {{server.game}}, {{server.connection}}, {{server.version}}, {{status.label}}, {{status.summary}}, {{status.uptime}}, {{status.performance}}, {{players.current}}, {{players.max}}, {{players.summary}}, {{status.checkedAt}}</div>
            <div class="form-actions"><button class="button primary" id="studioSaveTemplate">Save Template</button><button class="button" id="studioDuplicateTemplate">Duplicate</button><button class="button danger" id="studioRemoveTemplate">Remove</button></div>
          </article>
          <aside class="panel studio-preview-panel"><div class="panel-heading"><div><span class="eyebrow">Live Preview</span><h3>Discord Message</h3></div></div><div id="studioDiscordPreview" class="discord-message-preview"></div><label>Preview channel<select id="studioPreviewChannel"></select></label><button class="button primary studio-wide" id="studioSendPreview">Send Discord Preview</button><p class="privacy-note">Previews are real Discord messages. Generated messages disable mentions.</p></aside>
        </div>
      </div>
      <div class="studio-tab" id="studio-tab-panels">
        <div class="studio-layout panels-layout">
          <aside class="panel studio-list-panel"><div class="panel-heading"><div><span class="eyebrow">Published network</span><h3>Status Panels</h3></div><button class="button primary" id="studioNewPanel">New</button></div><div id="studioPanelList" class="studio-card-list"></div></aside>
          <article class="panel studio-editor-panel">
            <div class="panel-heading"><div><span class="eyebrow">Persistent Discord message</span><h3 id="studioPanelHeading">Status Panel</h3></div><span class="severity" id="studioPanelRuntimeBadge">Not published</span></div>
            <input id="studioPanelId" type="hidden">
            <div class="form-grid"><label>Panel name<input id="studioPanelName" maxlength="80"></label><label>Game server<select id="studioPanelServer"></select></label></div>
            <div class="form-grid"><label>Discord channel<select id="studioPanelChannel"></select></label><label>Embed template<select id="studioPanelTemplate"></select></label></div>
            <div class="form-grid three"><label>Refresh interval<select id="studioPanelInterval"><option value="60">1 minute</option><option value="120">2 minutes</option><option value="300">5 minutes</option><option value="600">10 minutes</option><option value="900">15 minutes</option><option value="1800">30 minutes</option><option value="3600">1 hour</option></select></label><label class="toggle-row compact"><span><strong>Enabled</strong><small>Allow scheduled refresh.</small></span><input id="studioPanelEnabled" type="checkbox"></label><label class="toggle-row compact"><span><strong>Player totals</strong><small>Public-safe counts and names.</small></span><input id="studioPanelPlayers" type="checkbox"></label></div>
            <div class="studio-panel-location" id="studioPanelLocation"></div>
            <div class="form-actions"><button class="button primary" id="studioSavePanel">Save Panel</button><button class="button primary" id="studioPublishPanel">Publish / Update</button><button class="button" id="studioRefreshPanel">Refresh Now</button><button class="button danger" id="studioDeletePublished">Delete Discord Message</button><button class="button danger" id="studioRemovePanel">Remove Configuration</button></div>
          </article>
          <aside class="panel studio-preview-panel"><div class="panel-heading"><div><span class="eyebrow">Runtime</span><h3>Panel Health</h3></div></div><div id="studioPanelRuntime" class="studio-runtime-card"></div><div class="studio-safety-note"><strong>Public-safe by design</strong><span>Status panels never expose RCON passwords, AdminPasswords, IP addresses, player platform IDs, or moderation controls.</span></div></aside>
        </div>
      </div>`;
    document.querySelector('main.content')?.appendChild(view);
    bindShell();
  }

  function openStudio() {
    document.querySelectorAll('.view').forEach((element) => element.classList.toggle('active', element.id === 'view-discord-studio'));
    document.querySelectorAll('.nav-item').forEach((element) => element.classList.toggle('active', element.dataset.view === 'discord-studio'));
    if ($('viewTitle')) $('viewTitle').textContent = 'Discord Studio';
    if ($('viewSubtitle')) $('viewSubtitle').textContent = 'Build embeds and persistent game-server status panels from the local Nexus command network.';
    refresh().catch(() => {});
  }

  function switchTab(tab) {
    studio.activeTab = tab;
    document.querySelectorAll('[data-studio-tab]').forEach((button) => button.classList.toggle('active', button.dataset.studioTab === tab));
    document.querySelectorAll('.studio-tab').forEach((element) => element.classList.toggle('active', element.id === `studio-tab-${tab}`));
  }

  function templates() { return studio.payload?.studio?.templates || []; }
  function panels() { return studio.payload?.studio?.panels || []; }
  function servers() { return studio.payload?.servers || []; }
  function selectedTemplate() { return templates().find((item) => item.id === studio.selectedTemplateId) || templates()[0] || null; }
  function selectedPanel() { return panels().find((item) => item.id === studio.selectedPanelId) || panels()[0] || null; }

  function channelOptions(selected = '') {
    const items = [...studio.channels];
    if (selected && !items.some((channel) => channel.id === selected)) items.unshift({ id: selected, name: `Saved channel (${selected})`, type: 'text' });
    return '<option value="">Select a channel</option>' + items.map((channel) => `<option value="${escapeHtml(channel.id)}" ${channel.id === selected ? 'selected' : ''}>#${escapeHtml(channel.name)}${channel.type === 'announcement' ? ' • announcements' : ''}</option>`).join('');
  }

  function renderTemplateList() {
    const selected = selectedTemplate();
    if (selected) studio.selectedTemplateId = selected.id;
    $('studioTemplateList').innerHTML = templates().map((template) => `<button class="studio-list-card ${template.id === studio.selectedTemplateId ? 'active' : ''}" data-studio-template="${escapeHtml(template.id)}"><span class="studio-list-glyph">${template.kind === 'server-status' ? '▦' : template.kind === 'announcement' ? '!' : '◆'}</span><span><strong>${escapeHtml(template.name)}</strong><small>${escapeHtml(template.kind.replace('-', ' '))} • ${template.fields.length} fields</small></span></button>`).join('');
  }

  function fieldRow(field = {}) {
    return `<div class="studio-field-row"><input data-field-name maxlength="256" placeholder="Field name" value="${escapeHtml(field.name || '')}"><textarea data-field-value rows="2" maxlength="1024" placeholder="Field value">${escapeHtml(field.value || '')}</textarea><label class="studio-inline-check"><input data-field-inline type="checkbox" ${field.inline ? 'checked' : ''}> Inline</label><button class="icon-button danger" data-remove-row title="Remove">×</button></div>`;
  }

  function buttonRow(button = {}) {
    return `<div class="studio-button-row"><input data-button-label maxlength="80" placeholder="Button label" value="${escapeHtml(button.label || '')}"><input data-button-url placeholder="https://..." value="${escapeHtml(button.url || '')}"><input data-button-emoji maxlength="32" placeholder="Emoji" value="${escapeHtml(button.emoji || '')}"><button class="icon-button danger" data-remove-row title="Remove">×</button></div>`;
  }

  function fillTemplate(template) {
    if (!template) return;
    studio.selectedTemplateId = template.id;
    $('studioTemplateId').value = template.id;
    $('studioTemplateName').value = template.name || '';
    $('studioTemplateKind').value = template.kind || 'custom';
    $('studioTemplateColor').value = template.color || '#e3264f';
    $('studioTemplateContent').value = template.content || '';
    $('studioTemplateTitle').value = template.title || '';
    $('studioTemplateDescription').value = template.description || '';
    $('studioTemplateThumbnail').value = template.thumbnailUrl || '';
    $('studioTemplateImage').value = template.imageUrl || '';
    $('studioTemplateFooter').value = template.footerText || '';
    $('studioTemplateFooterIcon').value = template.footerIconUrl || '';
    $('studioTemplateStatusColor').checked = Boolean(template.useStatusColor);
    $('studioTemplateTimestamp').checked = Boolean(template.timestamp);
    $('studioFieldRows').innerHTML = (template.fields || []).map(fieldRow).join('');
    $('studioButtonRows').innerHTML = (template.buttons || []).map(buttonRow).join('');
    $('studioTemplateHeading').textContent = template.name || 'Embed Template';
    $('studioTemplateKindBadge').textContent = (template.kind || 'custom').replace('-', ' ');
    document.querySelectorAll('#studio-tab-embeds input, #studio-tab-embeds textarea, #studio-tab-embeds select, #studio-tab-embeds button').forEach((element) => {
      if (!element.closest('.studio-tabs')) element.disabled = !canEdit() && !['studioPreviewChannel'].includes(element.id);
    });
    $('studioRemoveTemplate').disabled = ['default-server-status', 'default-announcement'].includes(template.id) || !canEdit();
    renderTemplateList();
    renderPreview();
  }

  function collectTemplate() {
    return {
      id: $('studioTemplateId').value || newId('template'),
      name: $('studioTemplateName').value,
      kind: $('studioTemplateKind').value,
      color: $('studioTemplateColor').value,
      content: $('studioTemplateContent').value,
      title: $('studioTemplateTitle').value,
      description: $('studioTemplateDescription').value,
      thumbnailUrl: $('studioTemplateThumbnail').value,
      imageUrl: $('studioTemplateImage').value,
      footerText: $('studioTemplateFooter').value,
      footerIconUrl: $('studioTemplateFooterIcon').value,
      useStatusColor: $('studioTemplateStatusColor').checked,
      timestamp: $('studioTemplateTimestamp').checked,
      fields: [...$('studioFieldRows').querySelectorAll('.studio-field-row')].map((row) => ({ name: row.querySelector('[data-field-name]').value, value: row.querySelector('[data-field-value]').value, inline: row.querySelector('[data-field-inline]').checked })),
      buttons: [...$('studioButtonRows').querySelectorAll('.studio-button-row')].map((row) => ({ label: row.querySelector('[data-button-label]').value, url: row.querySelector('[data-button-url]').value, emoji: row.querySelector('[data-button-emoji]').value }))
    };
  }

  function previewContext() {
    return {
      online: true,
      server: { name: 'Khaos Nexus Palworld', game: 'PALWORLD', connection: 'Palworld REST API', version: '1.0 Preview' },
      status: { label: '🟢 Online', summary: 'Server is online and responding to Khaos Nexus health checks.', uptime: '2h 2m', performance: '60.0 FPS • 16.7 ms', checkedAt: new Date().toLocaleString(), checkedAtIso: new Date().toISOString() },
      players: { current: 7, max: 32, summary: 'Khaos Kirito, Khaos Asuna' }
    };
  }

  function pathValue(source, path) { return path.split('.').reduce((value, key) => value?.[key], source); }
  function interpolate(value, context) { return String(value || '').replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, path) => pathValue(context, path) ?? '—'); }

  function renderPreview() {
    const template = collectTemplate();
    const context = previewContext();
    const color = template.useStatusColor ? '#2ecc71' : template.color;
    const fields = template.fields.filter((field) => field.name && field.value);
    $('studioDiscordPreview').innerHTML = `
      ${template.content ? `<div class="discord-content">${escapeHtml(interpolate(template.content, context))}</div>` : ''}
      <div class="discord-embed" style="--embed-color:${escapeHtml(color)}">
        <div class="discord-embed-body"><div class="discord-embed-copy">${template.title ? `<strong>${escapeHtml(interpolate(template.title, context))}</strong>` : ''}${template.description ? `<p>${escapeHtml(interpolate(template.description, context)).replace(/\n/g, '<br>')}</p>` : ''}<div class="discord-field-grid">${fields.map((field) => `<div class="${field.inline ? 'inline' : ''}"><strong>${escapeHtml(interpolate(field.name, context))}</strong><span>${escapeHtml(interpolate(field.value, context)).replace(/\n/g, '<br>')}</span></div>`).join('')}</div>${template.footerText ? `<small>${escapeHtml(interpolate(template.footerText, context))}${template.timestamp ? ` • ${new Date().toLocaleTimeString()}` : ''}</small>` : ''}</div>${template.thumbnailUrl ? `<img src="${escapeHtml(template.thumbnailUrl)}" alt="">` : ''}</div>${template.imageUrl ? `<img class="discord-banner" src="${escapeHtml(template.imageUrl)}" alt="">` : ''}
      </div>
      ${template.buttons.filter((button) => button.label && button.url).length ? `<div class="discord-button-row">${template.buttons.filter((button) => button.label && button.url).map((button) => `<span>${escapeHtml(button.emoji || '')} ${escapeHtml(button.label)}</span>`).join('')}</div>` : ''}`;
  }

  function renderChannels() {
    const previewValue = $('studioPreviewChannel').value;
    const panelValue = $('studioPanelChannel').value;
    $('studioPreviewChannel').innerHTML = channelOptions(previewValue);
    $('studioPanelChannel').innerHTML = channelOptions(panelValue || selectedPanel()?.channelId || '');
  }

  function renderPanelList() {
    const selected = selectedPanel();
    if (selected) studio.selectedPanelId = selected.id;
    const runtime = studio.payload?.runtime?.panels || {};
    $('studioPanelList').innerHTML = panels().length ? panels().map((panel) => {
      const live = runtime[panel.id] || {};
      const server = servers().find((item) => item.id === panel.serverId);
      return `<button class="studio-list-card ${panel.id === studio.selectedPanelId ? 'active' : ''}" data-studio-panel="${escapeHtml(panel.id)}"><span class="studio-list-glyph ${live.online ? 'online' : ''}">▦</span><span><strong>${escapeHtml(panel.name)}</strong><small>${escapeHtml(server?.name || 'Missing server')} • ${live.status || (panel.messageId ? 'published' : 'draft')}</small></span></button>`;
    }).join('') : '<div class="studio-empty">No status panels configured.</div>';
  }

  function fillPanel(panel) {
    if (!panel) {
      panel = { id: newId('panel'), name: 'Server Status Panel', serverId: servers()[0]?.id || '', channelId: '', templateId: 'default-server-status', refreshSeconds: 300, enabled: true, includePlayers: true };
    }
    studio.selectedPanelId = panel.id;
    $('studioPanelId').value = panel.id;
    $('studioPanelName').value = panel.name || '';
    $('studioPanelServer').innerHTML = '<option value="">Select a server</option>' + servers().map((server) => `<option value="${escapeHtml(server.id)}" ${server.id === panel.serverId ? 'selected' : ''}>${escapeHtml(server.name)} • ${escapeHtml(server.game)}</option>`).join('');
    $('studioPanelChannel').innerHTML = channelOptions(panel.channelId || '');
    $('studioPanelTemplate').innerHTML = templates().map((template) => `<option value="${escapeHtml(template.id)}" ${template.id === panel.templateId ? 'selected' : ''}>${escapeHtml(template.name)}</option>`).join('');
    $('studioPanelInterval').value = String(panel.refreshSeconds || 300);
    $('studioPanelEnabled').checked = panel.enabled !== false;
    $('studioPanelPlayers').checked = panel.includePlayers !== false;
    $('studioPanelHeading').textContent = panel.name || 'Status Panel';
    const runtime = studio.payload?.runtime?.panels?.[panel.id] || {};
    $('studioPanelRuntimeBadge').textContent = runtime.status || (panel.messageId ? 'Published' : 'Not published');
    $('studioPanelRuntimeBadge').className = `severity ${runtime.online ? 'good' : runtime.error ? 'bad' : ''}`;
    $('studioPanelLocation').innerHTML = panel.messageId ? `<strong>Published message</strong><span>Channel ${escapeHtml(panel.channelId)} • Message ${escapeHtml(panel.messageId)}</span>` : '<strong>Not published</strong><span>Save the panel, then publish it to create the persistent Discord message.</span>';
    $('studioPanelRuntime').innerHTML = `<div><span>Status</span><strong>${escapeHtml(runtime.status || 'Idle')}</strong></div><div><span>Last attempt</span><strong>${runtime.lastAttemptAt ? escapeHtml(new Date(runtime.lastAttemptAt).toLocaleString()) : 'Never'}</strong></div><div><span>Last success</span><strong>${runtime.lastSuccessAt ? escapeHtml(new Date(runtime.lastSuccessAt).toLocaleString()) : 'Never'}</strong></div><div><span>Next refresh</span><strong>${runtime.nextRefreshAt ? escapeHtml(new Date(runtime.nextRefreshAt).toLocaleString()) : 'After publication'}</strong></div>${runtime.error ? `<p class="studio-runtime-error">${escapeHtml(runtime.error)}</p>` : ''}`;
    document.querySelectorAll('#studio-tab-panels input, #studio-tab-panels select, #studio-tab-panels button').forEach((element) => { element.disabled = !canEdit(); });
    $('studioDeletePublished').disabled = !panel.messageId || !canEdit();
    renderPanelList();
  }

  function collectPanel() {
    const previous = panels().find((item) => item.id === $('studioPanelId').value) || {};
    return {
      ...previous,
      id: $('studioPanelId').value || newId('panel'),
      name: $('studioPanelName').value,
      serverId: $('studioPanelServer').value,
      guildId: studio.payload?.guildId || '',
      channelId: $('studioPanelChannel').value,
      templateId: $('studioPanelTemplate').value,
      refreshSeconds: Number($('studioPanelInterval').value),
      enabled: $('studioPanelEnabled').checked,
      includePlayers: $('studioPanelPlayers').checked,
      includeMetrics: true
    };
  }

  function render() {
    if (!studio.payload) return;
    $('studioLoadChannels').disabled = !canEdit();
    $('studioRefreshAll').disabled = !canEdit() || !panels().length;
    renderTemplateList();
    fillTemplate(selectedTemplate());
    renderPanelList();
    fillPanel(selectedPanel());
    renderChannels();
  }

  async function refresh() {
    studio.payload = await invoke('discord-studio:get');
    if (!studio.selectedTemplateId) studio.selectedTemplateId = templates()[0]?.id || null;
    if (!studio.selectedPanelId) studio.selectedPanelId = panels()[0]?.id || null;
    render();
  }

  async function loadChannels() {
    studio.channels = await invoke('discord-studio:list-channels', studio.payload?.guildId || '');
    renderChannels();
    notify(`${studio.channels.length} Discord channels loaded.`);
  }

  function bindShell() {
    document.addEventListener('click', (event) => {
      const studioView = event.target.closest('[data-view="discord-studio"]');
      if (studioView) openStudio();
      const tab = event.target.closest('[data-studio-tab]');
      if (tab) switchTab(tab.dataset.studioTab);
    });
    $('studioLoadChannels').addEventListener('click', loadChannels);
    $('studioRefreshAll').addEventListener('click', async () => { const response = await invoke('discord-studio:refresh-all'); studio.payload = response.state; render(); notify('Status panels refreshed.'); });
    $('studioTemplateList').addEventListener('click', (event) => { const item = event.target.closest('[data-studio-template]'); if (!item) return; studio.selectedTemplateId = item.dataset.studioTemplate; fillTemplate(selectedTemplate()); });
    $('studioPanelList').addEventListener('click', (event) => { const item = event.target.closest('[data-studio-panel]'); if (!item) return; studio.selectedPanelId = item.dataset.studioPanel; fillPanel(selectedPanel()); });
    $('studioNewTemplate').addEventListener('click', () => fillTemplate({ id: newId('template'), name: 'New Nexus Embed', kind: 'custom', color: '#e3264f', content: '', title: 'Khaos Nexus', description: '', thumbnailUrl: '', imageUrl: '', footerText: 'Where chaos meets control.', footerIconUrl: '', useStatusColor: false, timestamp: true, fields: [], buttons: [] }));
    $('studioDuplicateTemplate').addEventListener('click', () => { const copy = collectTemplate(); copy.id = newId('template'); copy.name = `${copy.name || 'Embed'} Copy`; fillTemplate(copy); });
    $('studioAddField').addEventListener('click', () => { if ($('studioFieldRows').children.length >= 25) return notify('Discord embeds support up to 25 fields.'); $('studioFieldRows').insertAdjacentHTML('beforeend', fieldRow()); renderPreview(); });
    $('studioAddButton').addEventListener('click', () => { if ($('studioButtonRows').children.length >= 5) return notify('Discord supports up to five link buttons in this row.'); $('studioButtonRows').insertAdjacentHTML('beforeend', buttonRow()); renderPreview(); });
    for (const container of [$('studioFieldRows'), $('studioButtonRows')]) {
      container.addEventListener('click', (event) => { const remove = event.target.closest('[data-remove-row]'); if (remove) { remove.parentElement.remove(); renderPreview(); } });
      container.addEventListener('input', renderPreview);
      container.addEventListener('change', renderPreview);
    }
    for (const id of ['studioTemplateName', 'studioTemplateKind', 'studioTemplateColor', 'studioTemplateContent', 'studioTemplateTitle', 'studioTemplateDescription', 'studioTemplateThumbnail', 'studioTemplateImage', 'studioTemplateFooter', 'studioTemplateFooterIcon', 'studioTemplateStatusColor', 'studioTemplateTimestamp']) {
      $(id).addEventListener('input', renderPreview); $(id).addEventListener('change', renderPreview);
    }
    $('studioSaveTemplate').addEventListener('click', async () => { const template = collectTemplate(); studio.payload = await invoke('discord-studio:save-template', template); studio.selectedTemplateId = template.id; render(); notify('Embed template saved.'); });
    $('studioRemoveTemplate').addEventListener('click', async () => { if (!confirm('Remove this embed template? Status panels using it will switch to the default status template.')) return; studio.payload = await invoke('discord-studio:remove-template', studio.selectedTemplateId); studio.selectedTemplateId = studio.payload.studio.templates[0]?.id || null; render(); notify('Embed template removed.'); });
    $('studioSendPreview').addEventListener('click', async () => { await invoke('discord-studio:preview', { channelId: $('studioPreviewChannel').value, template: collectTemplate() }); notify('Discord preview published.'); });
    $('studioNewPanel').addEventListener('click', () => { studio.selectedPanelId = null; fillPanel(null); });
    $('studioSavePanel').addEventListener('click', async () => { const panel = collectPanel(); studio.payload = await invoke('discord-studio:save-panel', panel); studio.selectedPanelId = panel.id; render(); notify('Status panel saved.'); });
    $('studioPublishPanel').addEventListener('click', async () => { const panel = collectPanel(); studio.payload = await invoke('discord-studio:save-panel', panel); const response = await invoke('discord-studio:publish-panel', panel.id); studio.payload = response.state; studio.selectedPanelId = panel.id; render(); notify('Persistent status panel published.'); });
    $('studioRefreshPanel').addEventListener('click', async () => { const panel = collectPanel(); studio.payload = await invoke('discord-studio:save-panel', panel); const response = await invoke('discord-studio:refresh-panel', panel.id); studio.payload = response.state; studio.selectedPanelId = panel.id; render(); notify('Status panel refreshed.'); });
    $('studioDeletePublished').addEventListener('click', async () => { if (!confirm('Delete the published Discord status message? The local panel configuration will remain.')) return; const response = await invoke('discord-studio:delete-published-panel', studio.selectedPanelId); studio.payload = response.state; render(); notify('Published Discord message deleted.'); });
    $('studioRemovePanel').addEventListener('click', async () => { if (!confirm('Remove this local status-panel configuration? Delete its Discord message separately first if needed.')) return; studio.payload = await invoke('discord-studio:remove-panel', studio.selectedPanelId); studio.selectedPanelId = studio.payload.studio.panels[0]?.id || null; render(); notify('Status-panel configuration removed.'); });
  }

  async function initialize() {
    ensureShell();
    await refresh();
    setInterval(() => {
      if ($('view-discord-studio')?.classList.contains('active')) refresh().catch(() => {});
    }, 30000);
    studio.initialized = true;
  }

  initialize().catch((error) => notify(`Discord Studio failed to initialize: ${error.message}`));
})();
