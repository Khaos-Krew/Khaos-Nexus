'use strict';

(() => {
  const state = { payload: null, resources: null, selectedMenuId: null, selectedLayoutId: null, tab: 'menus', auditQuery: '' };
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  function notify(message) {
    const toast = $('toast'); if (!toast) return; toast.textContent = String(message || 'Done.'); toast.classList.add('show');
    clearTimeout(notify.timer); notify.timer = setTimeout(() => toast.classList.remove('show'), 4200);
  }
  async function invoke(channel, payload) { try { return await window.khaos.invoke(channel, payload); } catch (error) { notify(error.message || String(error)); throw error; } }
  function canOperate() { return ['owner', 'operator', 'local-admin'].includes(state.payload?.role); }
  function canOwn() { return ['owner', 'local-admin'].includes(state.payload?.role); }
  function newId(prefix) { return `${prefix}-${crypto.randomUUID()}`; }

  function ensureShell() {
    if ($('view-discord-automation')) return;
    const studioNav = document.querySelector('[data-view="discord-studio"]') || document.querySelector('[data-view="setup"]');
    if (studioNav) {
      const button = document.createElement('button'); button.className = 'nav-item'; button.dataset.view = 'discord-automation';
      button.innerHTML = '<span>⬢</span>Discord Automation'; studioNav.insertAdjacentElement('afterend', button);
    }
    const view = document.createElement('section'); view.className = 'view'; view.id = 'view-discord-automation';
    view.innerHTML = `
      <div class="automation-hero"><div><span class="eyebrow">Discord Migration</span><h2>Automation Command Center</h2><p>Publish self-service role systems, synchronize a safe additive server layout, and retain a structured operator audit trail.</p></div><div class="automation-hero-actions"><button class="button" id="automationLoadResources">Load Discord Resources</button><button class="button" id="automationRefresh">Refresh</button></div></div>
      <div id="automationSummary" class="automation-summary"></div>
      <div class="automation-tabs"><button class="active" data-automation-tab="menus">Role & Color Menus</button><button data-automation-tab="layouts">Server Layout</button><button data-automation-tab="audit">Audit Log</button></div>
      <div class="automation-tab active" id="automation-tab-menus">
        <div class="automation-layout">
          <aside class="panel automation-list"><div class="panel-heading"><div><span class="eyebrow">Self service</span><h3>Role Menus</h3></div><button class="button primary" id="automationNewMenu">New</button></div><div id="automationMenuList" class="automation-card-list"></div></aside>
          <article class="panel automation-editor">
            <div class="panel-heading"><div><span class="eyebrow">Button system</span><h3 id="automationMenuHeading">Role Menu</h3></div><span class="severity" id="automationMenuStatus">Draft</span></div>
            <input id="automationMenuId" type="hidden">
            <div class="form-grid three"><label>Menu name<input id="automationMenuName" maxlength="80"></label><label>Menu type<select id="automationMenuKind"><option value="roles">Roles</option><option value="colors">Name colors</option></select></label><label>Behavior<select id="automationMenuMode"><option value="toggle">Toggle independently</option><option value="exclusive">One option at a time</option></select></label></div>
            <div class="form-grid"><label>Discord channel<select id="automationMenuChannel"></select></label><label>Embed accent<input id="automationMenuColor" type="color" value="#e3264f"></label></div>
            <label>Embed title<input id="automationMenuTitle" maxlength="256"></label><label>Description<textarea id="automationMenuDescription" rows="4" maxlength="4000"></textarea></label>
            <section class="automation-builder-section"><div class="panel-heading"><div><span class="eyebrow">Buttons</span><h3>Role Options</h3></div><button class="button" id="automationAddOption">Add Option</button></div><div id="automationOptionRows" class="automation-option-list"></div></section>
            <div class="automation-safety"><strong>Hierarchy protection</strong><span>Only roles below the bot’s highest role and not managed by another integration can be published.</span></div>
            <div class="form-actions"><button class="button primary" id="automationSaveMenu">Save Menu</button><button class="button primary" id="automationPublishMenu">Publish / Update</button><button class="button" id="automationDuplicateMenu">Duplicate</button><button class="button danger" id="automationDeletePublishedMenu">Delete Discord Message</button><button class="button danger" id="automationRemoveMenu">Remove Configuration</button></div>
          </article>
        </div>
      </div>
      <div class="automation-tab" id="automation-tab-layouts">
        <div class="automation-layout">
          <aside class="panel automation-list"><div class="panel-heading"><div><span class="eyebrow">Blueprints</span><h3>Server Layouts</h3></div><button class="button primary" id="automationNewLayout">New</button></div><div id="automationLayoutList" class="automation-card-list"></div></aside>
          <article class="panel automation-editor">
            <div class="panel-heading"><div><span class="eyebrow">Additive synchronization</span><h3 id="automationLayoutHeading">Discord Layout</h3></div><span class="severity healthy">No deletion</span></div>
            <input id="automationLayoutId" type="hidden"><div class="form-grid"><label>Layout name<input id="automationLayoutName" maxlength="80"></label><label>Description<input id="automationLayoutDescription" maxlength="500"></label></div>
            <section class="automation-builder-section"><div class="panel-heading"><div><span class="eyebrow">Structure</span><h3>Categories & Channels</h3></div><button class="button" id="automationAddCategory">Add Category</button></div><div id="automationCategoryRows" class="automation-category-list"></div></section>
            <div id="automationLayoutPlan" class="automation-plan"><strong>Preview not run</strong><span>Load Discord resources and preview the layout before applying it.</span></div>
            <div class="form-actions"><button class="button primary" id="automationSaveLayout">Save Layout</button><button class="button" id="automationPreviewLayout">Preview Changes</button><button class="button primary" id="automationApplyLayout">Apply Missing Items</button><button class="button" id="automationDuplicateLayout">Duplicate</button><button class="button danger" id="automationRemoveLayout">Remove</button></div>
          </article>
        </div>
      </div>
      <div class="automation-tab" id="automation-tab-audit">
        <div class="automation-audit-grid">
          <article class="panel"><div class="panel-heading"><div><span class="eyebrow">Delivery</span><h3>Audit Settings</h3></div></div><label class="toggle-row"><span><strong>Publish audit entries to Discord</strong><small>Local audit storage remains active either way.</small></span><input id="automationAuditPublish" type="checkbox"></label><label>Discord audit channel<select id="automationAuditChannel"></select></label><label>Local retention<select id="automationAuditRetention"><option value="100">100 entries</option><option value="250">250 entries</option><option value="500">500 entries</option><option value="1000">1,000 entries</option></select></label><button class="button primary studio-wide" id="automationSaveAudit">Save Audit Settings</button></article>
          <article class="panel automation-audit-panel"><div class="panel-heading"><div><span class="eyebrow">Structured history</span><h3>Automation Events</h3></div><div class="automation-audit-actions"><input id="automationAuditSearch" placeholder="Filter audit history"><button class="button" id="automationExportAudit">Export</button><button class="button danger" id="automationClearAudit">Clear</button></div></div><div id="automationAuditList" class="automation-audit-list"></div></article>
        </div>
      </div>`;
    document.querySelector('main.content')?.appendChild(view); bind();
  }

  function openView() {
    document.querySelectorAll('.view').forEach((element) => element.classList.toggle('active', element.id === 'view-discord-automation'));
    document.querySelectorAll('.nav-item').forEach((element) => element.classList.toggle('active', element.dataset.view === 'discord-automation'));
    if ($('viewTitle')) $('viewTitle').textContent = 'Discord Automation';
    if ($('viewSubtitle')) $('viewSubtitle').textContent = 'Manage role menus, color roles, additive server layouts, and audit history.';
    refresh().catch(() => {});
  }
  function switchTab(tab) {
    state.tab = tab;
    document.querySelectorAll('[data-automation-tab]').forEach((button) => button.classList.toggle('active', button.dataset.automationTab === tab));
    document.querySelectorAll('.automation-tab').forEach((element) => element.classList.toggle('active', element.id === `automation-tab-${tab}`));
  }
  function menus() { return state.payload?.automation?.roleMenus || []; }
  function layouts() { return state.payload?.automation?.layouts || []; }
  function selectedMenu() { return state.selectedMenuId ? (menus().find((item) => item.id === state.selectedMenuId) || null) : (menus()[0] || null); }
  function selectedLayout() { return state.selectedLayoutId ? (layouts().find((item) => item.id === state.selectedLayoutId) || null) : (layouts()[0] || null); }
  function channelOptions(selected = '', includeVoice = false) {
    const allowed = includeVoice ? [0, 2, 5] : [0, 5];
    const items = (state.resources?.channels || []).filter((channel) => allowed.includes(Number(channel.type)));
    if (selected && !items.some((item) => item.id === selected)) items.unshift({ id: selected, name: `Saved channel (${selected})`, type: 0 });
    return '<option value="">Select a channel</option>' + items.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selected ? 'selected' : ''}>#${escapeHtml(item.name)}${Number(item.type) === 5 ? ' • announcements' : Number(item.type) === 2 ? ' • voice' : ''}</option>`).join('');
  }
  function roleOptions(selected = '') {
    const items = state.resources?.roles || [];
    if (selected && !items.some((item) => item.id === selected)) items.unshift({ id: selected, name: `Saved role (${selected})`, manageable: false, color: 0 });
    return '<option value="">Select a Discord role</option>' + items.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selected ? 'selected' : ''} ${item.manageable ? '' : 'data-unmanageable="true"'}>${escapeHtml(item.name)}${item.manageable ? '' : ' • unavailable'}</option>`).join('');
  }
  function renderSummary() {
    const audit = state.payload?.automation?.auditEntries || [];
    const published = menus().filter((item) => item.messageId).length;
    $('automationSummary').innerHTML = `<article><span>Published menus</span><strong>${published}</strong><small>${menus().length} configured</small></article><article><span>Layouts</span><strong>${layouts().length}</strong><small>Additive only</small></article><article><span>Audit entries</span><strong>${audit.length}</strong><small>Retention ${state.payload?.automation?.audit?.retention || 500}</small></article><article><span>Discord resources</span><strong>${state.resources ? 'Loaded' : 'Not loaded'}</strong><small>${state.resources ? `${state.resources.roles.length} roles • ${state.resources.channels.length} channels` : 'Required before publishing'}</small></article>`;
  }
  function renderMenuList() {
    const selected = selectedMenu(); if (selected) state.selectedMenuId = selected.id;
    $('automationMenuList').innerHTML = menus().length ? menus().map((menu) => `<button class="automation-list-card ${menu.id === state.selectedMenuId ? 'active' : ''}" data-menu-id="${escapeHtml(menu.id)}"><span class="automation-glyph">${menu.kind === 'colors' ? '◈' : '◆'}</span><span><strong>${escapeHtml(menu.name)}</strong><small>${menu.kind === 'colors' ? 'Color roles' : menu.mode === 'exclusive' ? 'Exclusive roles' : 'Toggle roles'} • ${menu.options.length} options</small></span><span class="automation-publish-dot ${menu.messageId ? 'online' : ''}"></span></button>`).join('') : '<div class="automation-empty">No role menus configured.</div>';
  }
  function optionRow(option = {}, kind = 'roles') {
    return `<div class="automation-option-row" data-option-id="${escapeHtml(option.id || newId('option'))}"><span class="automation-option-swatch" style="background:${escapeHtml(option.color || '#808080')}"></span><select data-option-role>${roleOptions(option.roleId || '')}</select><input data-option-label maxlength="80" placeholder="Button label" value="${escapeHtml(option.label || '')}"><input data-option-emoji maxlength="32" placeholder="Emoji" value="${escapeHtml(option.emoji || '')}"><select data-option-style><option value="secondary" ${option.style === 'secondary' ? 'selected' : ''}>Gray</option><option value="primary" ${option.style === 'primary' ? 'selected' : ''}>Blue</option><option value="success" ${option.style === 'success' ? 'selected' : ''}>Green</option><option value="danger" ${option.style === 'danger' ? 'selected' : ''}>Red</option></select>${kind === 'colors' ? `<input data-option-color type="color" value="${escapeHtml(option.color || '#808080')}">` : ''}<button class="icon-button danger" data-remove-option>×</button></div>`;
  }
  function fillMenu(menu) {
    if (!menu) {
      menu = { id: newId('menu'), name: 'New Role Menu', kind: 'roles', mode: 'toggle', title: 'Choose Your Roles', description: 'Use the buttons below to update your roles.', color: '#e3264f', channelId: '', options: [] };
    }
    state.selectedMenuId = menu.id; $('automationMenuId').value = menu.id; $('automationMenuName').value = menu.name || ''; $('automationMenuKind').value = menu.kind || 'roles'; $('automationMenuMode').value = menu.kind === 'colors' ? 'exclusive' : menu.mode || 'toggle'; $('automationMenuMode').disabled = menu.kind === 'colors';
    $('automationMenuChannel').innerHTML = channelOptions(menu.channelId || ''); $('automationMenuColor').value = menu.color || '#e3264f'; $('automationMenuTitle').value = menu.title || ''; $('automationMenuDescription').value = menu.description || '';
    $('automationOptionRows').innerHTML = (menu.options || []).map((option) => optionRow(option, menu.kind)).join(''); $('automationMenuHeading').textContent = menu.name || 'Role Menu'; $('automationMenuStatus').textContent = menu.messageId ? 'Published' : 'Draft'; $('automationMenuStatus').classList.toggle('healthy', Boolean(menu.messageId));
    document.querySelectorAll('#automation-tab-menus input, #automation-tab-menus textarea, #automation-tab-menus select, #automation-tab-menus button').forEach((element) => { if (!['automationLoadResources', 'automationRefresh'].includes(element.id)) element.disabled = !canOperate(); });
    renderMenuList();
  }
  function collectMenu() {
    const kind = $('automationMenuKind').value;
    return {
      id: $('automationMenuId').value || newId('menu'), name: $('automationMenuName').value, kind, mode: kind === 'colors' ? 'exclusive' : $('automationMenuMode').value,
      title: $('automationMenuTitle').value, description: $('automationMenuDescription').value, color: $('automationMenuColor').value,
      guildId: state.resources?.guildId || state.payload?.guildId || '', channelId: $('automationMenuChannel').value,
      messageId: selectedMenu()?.messageId || '', publishedAt: selectedMenu()?.publishedAt || null, enabled: true,
      options: [...document.querySelectorAll('.automation-option-row')].map((row) => ({ id: row.dataset.optionId, roleId: row.querySelector('[data-option-role]').value, label: row.querySelector('[data-option-label]').value, emoji: row.querySelector('[data-option-emoji]').value, style: row.querySelector('[data-option-style]').value, color: row.querySelector('[data-option-color]')?.value || '#808080' }))
    };
  }
  function renderLayoutList() {
    const selected = selectedLayout(); if (selected) state.selectedLayoutId = selected.id;
    $('automationLayoutList').innerHTML = layouts().map((layout) => `<button class="automation-list-card ${layout.id === state.selectedLayoutId ? 'active' : ''}" data-layout-id="${escapeHtml(layout.id)}"><span class="automation-glyph">▦</span><span><strong>${escapeHtml(layout.name)}</strong><small>${layout.categories.length} categories • ${layout.categories.reduce((sum, item) => sum + item.channels.length, 0)} channels</small></span></button>`).join('');
  }
  function channelRow(channel = {}) { return `<div class="automation-channel-row" data-channel-id="${escapeHtml(channel.id || newId('channel'))}"><input data-channel-name maxlength="100" placeholder="channel-name" value="${escapeHtml(channel.name || '')}"><select data-channel-type><option value="text" ${channel.type === 'text' ? 'selected' : ''}>Text</option><option value="announcement" ${channel.type === 'announcement' ? 'selected' : ''}>Announcement</option><option value="voice" ${channel.type === 'voice' ? 'selected' : ''}>Voice</option></select><input data-channel-topic maxlength="1024" placeholder="Topic or purpose" value="${escapeHtml(channel.topic || '')}"><button class="icon-button danger" data-remove-channel>×</button></div>`; }
  function categoryRow(category = {}) { return `<section class="automation-category-row" data-category-id="${escapeHtml(category.id || newId('category'))}"><header><input data-category-name maxlength="100" placeholder="CATEGORY NAME" value="${escapeHtml(category.name || '')}"><button class="button" data-add-channel>Add Channel</button><button class="icon-button danger" data-remove-category>×</button></header><div data-category-channels>${(category.channels || []).map(channelRow).join('')}</div></section>`; }
  function fillLayout(layout) {
    if (!layout) layout = { id: newId('layout'), name: 'New Discord Layout', description: 'Safe additive layout.', categories: [] };
    state.selectedLayoutId = layout.id; $('automationLayoutId').value = layout.id; $('automationLayoutName').value = layout.name || ''; $('automationLayoutDescription').value = layout.description || ''; $('automationCategoryRows').innerHTML = (layout.categories || []).map(categoryRow).join(''); $('automationLayoutHeading').textContent = layout.name || 'Discord Layout';
    $('automationLayoutPlan').innerHTML = `<strong>${layout.lastAppliedAt ? 'Last applied' : 'Preview not run'}</strong><span>${layout.lastAppliedAt ? new Date(layout.lastAppliedAt).toLocaleString() : 'Existing Discord content will never be removed.'}</span>`;
    document.querySelectorAll('#automation-tab-layouts input, #automation-tab-layouts textarea, #automation-tab-layouts select, #automation-tab-layouts button').forEach((element) => { element.disabled = !canOperate() || (element.id === 'automationApplyLayout' && !canOwn()); });
    renderLayoutList();
  }
  function collectLayout() {
    return { id: $('automationLayoutId').value || newId('layout'), name: $('automationLayoutName').value, description: $('automationLayoutDescription').value, guildId: state.resources?.guildId || state.payload?.guildId || '', enabled: true, lastAppliedAt: selectedLayout()?.lastAppliedAt || null,
      categories: [...document.querySelectorAll('.automation-category-row')].map((category) => ({ id: category.dataset.categoryId, name: category.querySelector('[data-category-name]').value, channels: [...category.querySelectorAll('.automation-channel-row')].map((channel) => ({ id: channel.dataset.channelId, name: channel.querySelector('[data-channel-name]').value, type: channel.querySelector('[data-channel-type]').value, topic: channel.querySelector('[data-channel-topic]').value })) })) };
  }
  function renderAudit() {
    const audit = state.payload?.automation?.audit || {}; $('automationAuditPublish').checked = Boolean(audit.publishToDiscord); $('automationAuditChannel').innerHTML = channelOptions(audit.channelId || ''); $('automationAuditRetention').value = String(audit.retention || 500);
    const query = state.auditQuery.toLowerCase(); const entries = [...(state.payload?.automation?.auditEntries || [])].reverse().filter((entry) => !query || [entry.action, entry.actorName, entry.targetName, entry.summary, entry.outcome].join(' ').toLowerCase().includes(query));
    $('automationAuditList').innerHTML = entries.length ? entries.map((entry) => `<article class="automation-audit-entry outcome-${escapeHtml(entry.outcome)}"><div><strong>${escapeHtml(entry.action)}</strong><span>${escapeHtml(entry.summary)}</span></div><div><span>${escapeHtml(entry.actorName)} • ${escapeHtml(entry.actorRole)}</span><span>${escapeHtml(entry.targetName || entry.targetType || 'Khaos Nexus')}</span><time>${escapeHtml(new Date(entry.time).toLocaleString())}</time></div></article>`).join('') : '<div class="automation-empty">No matching audit entries.</div>';
    $('automationSaveAudit').disabled = !canOwn(); $('automationClearAudit').disabled = !canOwn(); $('automationExportAudit').disabled = !canOperate();
  }
  function render() { if (!state.payload) return; renderSummary(); renderMenuList(); fillMenu(selectedMenu()); renderLayoutList(); fillLayout(selectedLayout()); renderAudit(); }
  async function refresh() { state.payload = await invoke('discord-automation:get'); if (!state.selectedMenuId) state.selectedMenuId = menus()[0]?.id || null; if (!state.selectedLayoutId) state.selectedLayoutId = layouts()[0]?.id || null; render(); }
  async function loadResources() { state.resources = await invoke('discord-automation:resources', state.payload?.guildId || ''); notify(`Loaded ${state.resources.roles.length} roles and ${state.resources.channels.length} channels.`); render(); }
  async function saveMenu() { state.payload = await invoke('discord-automation:save-menu', collectMenu()); state.selectedMenuId = $('automationMenuId').value; render(); notify('Role menu saved.'); }
  async function saveLayout() { state.payload = await invoke('discord-automation:save-layout', collectLayout()); state.selectedLayoutId = $('automationLayoutId').value; render(); notify('Discord layout saved.'); }

  function bind() {
    document.addEventListener('click', (event) => { const nav = event.target.closest('[data-view="discord-automation"]'); if (nav) openView(); });
    document.querySelectorAll('[data-automation-tab]').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.automationTab)));
    $('automationLoadResources').addEventListener('click', loadResources); $('automationRefresh').addEventListener('click', refresh);
    $('automationNewMenu').addEventListener('click', () => fillMenu(null));
    $('automationMenuList').addEventListener('click', (event) => { const item = event.target.closest('[data-menu-id]'); if (!item) return; state.selectedMenuId = item.dataset.menuId; fillMenu(selectedMenu()); });
    $('automationMenuKind').addEventListener('change', () => { const menu = collectMenu(); menu.kind = $('automationMenuKind').value; if (menu.kind === 'colors') menu.mode = 'exclusive'; fillMenu(menu); });
    $('automationAddOption').addEventListener('click', () => $('automationOptionRows').insertAdjacentHTML('beforeend', optionRow({}, $('automationMenuKind').value)));
    $('automationOptionRows').addEventListener('click', (event) => { if (event.target.closest('[data-remove-option]')) event.target.closest('.automation-option-row')?.remove(); });
    $('automationOptionRows').addEventListener('input', (event) => { if (event.target.matches('[data-option-color]')) event.target.closest('.automation-option-row')?.querySelector('.automation-option-swatch')?.style.setProperty('background', event.target.value); });
    $('automationSaveMenu').addEventListener('click', saveMenu);
    $('automationPublishMenu').addEventListener('click', async () => { if (!state.resources) await loadResources(); await saveMenu(); const result = await invoke('discord-automation:publish-menu', $('automationMenuId').value); state.payload = result.state; render(); notify('Role menu published to Discord.'); });
    $('automationDuplicateMenu').addEventListener('click', () => { const menu = collectMenu(); menu.id = newId('menu'); menu.name = `${menu.name} Copy`; menu.messageId = ''; menu.publishedAt = null; menu.options = menu.options.map((item) => ({ ...item, id: newId('option') })); fillMenu(menu); });
    $('automationDeletePublishedMenu').addEventListener('click', async () => { if (!selectedMenu()?.messageId || !confirm('Delete the published Discord role-menu message?')) return; state.payload = await invoke('discord-automation:delete-published-menu', selectedMenu().id); render(); notify('Published role menu deleted.'); });
    $('automationRemoveMenu').addEventListener('click', async () => { const menu = selectedMenu(); if (!menu || !confirm(`Remove ${menu.name}?`)) return; state.payload = await invoke('discord-automation:remove-menu', menu.id); state.selectedMenuId = null; render(); notify('Role menu configuration removed.'); });
    $('automationNewLayout').addEventListener('click', () => fillLayout(null));
    $('automationLayoutList').addEventListener('click', (event) => { const item = event.target.closest('[data-layout-id]'); if (!item) return; state.selectedLayoutId = item.dataset.layoutId; fillLayout(selectedLayout()); });
    $('automationAddCategory').addEventListener('click', () => $('automationCategoryRows').insertAdjacentHTML('beforeend', categoryRow({ channels: [] })));
    $('automationCategoryRows').addEventListener('click', (event) => { const category = event.target.closest('.automation-category-row'); if (event.target.closest('[data-remove-category]')) category?.remove(); if (event.target.closest('[data-add-channel]')) category?.querySelector('[data-category-channels]')?.insertAdjacentHTML('beforeend', channelRow({ type: 'text' })); if (event.target.closest('[data-remove-channel]')) event.target.closest('.automation-channel-row')?.remove(); });
    $('automationSaveLayout').addEventListener('click', saveLayout);
    $('automationPreviewLayout').addEventListener('click', async () => { if (!state.resources) await loadResources(); await saveLayout(); const result = await invoke('discord-automation:preview-layout', $('automationLayoutId').value); $('automationLayoutPlan').innerHTML = `<strong>${result.plan.createCount} items to create • ${result.plan.unchangedCount} already present</strong><span>No channels or categories will be deleted. ${result.plan.operations.filter((item) => item.action === 'create').slice(0, 12).map((item) => `${item.kind}: ${item.name}`).join(' • ') || 'Layout is already synchronized.'}</span>`; });
    $('automationApplyLayout').addEventListener('click', async () => { if (!canOwn() || !confirm('Create the missing categories and channels? Existing Discord content will not be deleted.')) return; if (!state.resources) await loadResources(); await saveLayout(); const result = await invoke('discord-automation:apply-layout', $('automationLayoutId').value); state.payload = result.state; render(); notify(`Created ${result.result.created.length} Discord items.`); });
    $('automationDuplicateLayout').addEventListener('click', () => { const layout = collectLayout(); layout.id = newId('layout'); layout.name = `${layout.name} Copy`; layout.lastAppliedAt = null; layout.categories = layout.categories.map((category) => ({ ...category, id: newId('category'), channels: category.channels.map((channel) => ({ ...channel, id: newId('channel') })) })); fillLayout(layout); });
    $('automationRemoveLayout').addEventListener('click', async () => { const layout = selectedLayout(); if (!layout || !confirm(`Remove ${layout.name}?`)) return; state.payload = await invoke('discord-automation:remove-layout', layout.id); state.selectedLayoutId = null; render(); notify('Layout configuration removed.'); });
    $('automationSaveAudit').addEventListener('click', async () => { state.payload = await invoke('discord-automation:save-audit', { publishToDiscord: $('automationAuditPublish').checked, channelId: $('automationAuditChannel').value, retention: Number($('automationAuditRetention').value) }); render(); notify('Audit settings saved.'); });
    $('automationAuditSearch').addEventListener('input', (event) => { state.auditQuery = event.target.value; renderAudit(); });
    $('automationExportAudit').addEventListener('click', async () => { const result = await invoke('discord-automation:export-audit'); if (!result.canceled) notify('Audit log exported.'); });
    $('automationClearAudit').addEventListener('click', async () => { if (!confirm('Clear the local Discord automation audit history?')) return; state.payload = await invoke('discord-automation:clear-audit'); render(); notify('Audit history cleared.'); });
  }

  async function initialize() {
    ensureShell(); window.khaos.onDiscordAutomation?.((payload) => { state.payload = payload; render(); }); await refresh();
  }
  initialize().catch((error) => notify(`Discord Automation failed to initialize: ${error.message}`));
})();
