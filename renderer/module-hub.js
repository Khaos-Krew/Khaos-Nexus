'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const ui = { payload: null, selectedId: null, query: '', category: 'all', stage: 'all', workspace: 'all' };
  const stageLabels = { live: 'Operational', foundation: 'Foundation', building: 'Building', queued: 'Queued', private: 'Private' };

  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
  function notify(message) {
    const toast = $('toast'); if (!toast) return; toast.textContent = String(message || 'Done.'); toast.classList.add('show');
    clearTimeout(notify.timer); notify.timer = setTimeout(() => toast.classList.remove('show'), 4200);
  }
  async function invoke(channel, payload) { try { return await window.khaos.invoke(channel, payload); } catch (error) { notify(error.message || String(error)); throw error; } }
  function replaceText(element, value) { if (element && element.textContent !== value) element.textContent = value; }

  function sanitizeLegacyCopy() {
    document.body.classList.add('nexus-v9');
    const subtitle = $('viewSubtitle');
    if (subtitle && /lovable/i.test(subtitle.textContent || '')) subtitle.textContent = 'Operate Khaos Nexus through its local autonomous command network.';
    const banner = $('view-dashboard')?.querySelector('.local-banner');
    if (banner) {
      replaceText(banner.querySelector('strong'), 'Local Nexus command network');
      replaceText(banner.querySelector('div span'), 'Your runtime, game servers, modules, logs, backups and protected settings are managed from this PC.');
    }
    document.querySelectorAll('body *').forEach((element) => {
      if (element.children.length || !/lovable/i.test(element.textContent || '')) return;
      element.textContent = element.textContent.replace(/Lovable(?: website)?/gi, 'legacy web platform');
    });
  }

  function ensureModuleShell() {
    const view = $('view-modules');
    if (!view || $('nexusModuleCenter')) return;
    view.innerHTML = `
      <section id="nexusModuleCenter" class="nexus-module-center">
        <div class="module-hero">
          <div class="module-hero-copy"><span class="eyebrow">Desktop Migration Command</span><h2>Nexus Module Network</h2><p>Every website capability is being rebuilt as an isolated, permission-aware desktop workspace. Core systems stay stable while modules move through inventory, local data, services, interface, access and validation.</p></div>
          <div class="module-hero-actions"><button class="button" id="moduleRefreshButton">Refresh</button><button class="button primary" id="moduleExportButton">Export Roadmap</button></div>
        </div>
        <div id="moduleSummary" class="module-summary-grid"></div>
        <div class="module-toolbar panel">
          <label class="module-search">Search modules<input id="moduleSearchInput" placeholder="Search operations, Discord, companions, community…"></label>
          <label>Category<select id="moduleCategoryFilter"><option value="all">All categories</option></select></label>
          <label>Status<select id="moduleStageFilter"><option value="all">All statuses</option><option value="live">Operational</option><option value="foundation">Foundation</option><option value="building">Building</option><option value="queued">Queued</option><option value="private">Private</option></select></label>
        </div>
        <div id="moduleWorkspaceRail" class="module-workspace-rail"></div>
        <div class="module-layout"><div id="nexusModuleGrid" class="nexus-module-grid"></div><aside id="nexusModuleDetail" class="nexus-module-detail panel"></aside></div>
      </section>`;
    bindShell();
  }

  function canOwn() { return ['owner', 'local-admin'].includes(ui.payload?.role); }
  function filteredCatalog() {
    const query = ui.query.trim().toLowerCase();
    return (ui.payload?.catalog || []).filter((module) => {
      if (ui.category !== 'all' && module.category !== ui.category) return false;
      if (ui.stage !== 'all' && module.stage !== ui.stage) return false;
      if (ui.workspace !== 'all' && module.workspace !== ui.workspace) return false;
      if (!query) return true;
      return [module.name, module.description, module.category, module.workspace, ...(module.features || []), ...(module.sourceRoutes || [])].join(' ').toLowerCase().includes(query);
    });
  }
  function summaryCard(label, value, detail, tone = '') { return `<article class="module-summary-card ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></article>`; }
  function renderSummary() {
    const summary = ui.payload?.summary || {};
    $('moduleSummary').innerHTML = [
      summaryCard('Migration progress', `${summary.overallProgress || 0}%`, `${summary.completed || 0} workspaces validated`, 'progress'),
      summaryCard('Operational', summary.byStage?.live || 0, 'Ready in the desktop application', 'good'),
      summaryCard('In production', (summary.byStage?.foundation || 0) + (summary.byStage?.building || 0), 'Foundation or active build', 'warn'),
      summaryCard('Queued', summary.byStage?.queued || 0, 'Inventoried and waiting for implementation'),
      summaryCard('Enabled', `${summary.enabled || 0} / ${summary.total || 0}`, 'Visible workspaces on this PC')
    ].join('');
    if ($('metricModules')) $('metricModules').textContent = String(summary.enabled || 0);
  }
  function renderFilters() {
    const categories = [...new Set((ui.payload?.catalog || []).map((module) => module.category))].sort();
    const category = $('moduleCategoryFilter');
    category.innerHTML = '<option value="all">All categories</option>' + categories.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
    category.value = categories.includes(ui.category) ? ui.category : 'all';
    const workspaces = [...new Set((ui.payload?.catalog || []).map((module) => module.workspace))];
    $('moduleWorkspaceRail').innerHTML = ['all', ...workspaces].map((workspace) => `<button class="module-workspace-chip ${ui.workspace === workspace ? 'active' : ''}" data-module-workspace="${escapeHtml(workspace)}"><span>${workspace === 'all' ? 'All Workspaces' : escapeHtml(workspace)}</span><small>${workspace === 'all' ? ui.payload.catalog.length : ui.payload.catalog.filter((module) => module.workspace === workspace).length}</small></button>`).join('');
  }
  function dependencyText(module) {
    if (!module.dependencies?.length) return 'No module dependencies';
    return `Requires ${module.dependencies.map((id) => ui.payload.catalog.find((item) => item.id === id)?.name || id).join(', ')}`;
  }
  function renderGrid() {
    const modules = filteredCatalog();
    if (!modules.length) { $('nexusModuleGrid').innerHTML = '<article class="panel module-empty"><strong>No modules match these filters.</strong><span>Clear the search or choose another workspace.</span></article>'; return; }
    $('nexusModuleGrid').innerHTML = modules.map((module) => `
      <article class="nexus-module-card stage-${escapeHtml(module.stage)} ${module.id === ui.selectedId ? 'selected' : ''}" data-module-id="${escapeHtml(module.id)}">
        <div class="module-card-scan"></div><header><div><span class="module-workspace-label">${escapeHtml(module.workspace)}</span><h3>${escapeHtml(module.name)}</h3></div><span class="module-stage-badge">${escapeHtml(stageLabels[module.stage] || module.stage)}</span></header>
        <p>${escapeHtml(module.description)}</p><div class="module-progress-row"><span>${module.progress}% migrated</span><span>${escapeHtml(module.requiredRole || 'viewer')}</span></div><div class="module-progress-track"><div style="width:${Number(module.progress) || 0}%"></div></div>
        <div class="module-card-meta"><span>${module.features.length} functions</span><span>${escapeHtml(dependencyText(module))}</span></div>
        <footer><button class="button" data-module-details="${escapeHtml(module.id)}">Details</button>${module.launchView ? `<button class="button primary" data-module-open="${escapeHtml(module.id)}">Open</button>` : ''}<span class="module-enabled-state ${module.state?.enabled ? 'enabled' : ''}">${module.state?.enabled ? 'Enabled' : 'Disabled'}</span></footer>
      </article>`).join('');
  }
  function renderDetail() {
    const module = (ui.payload?.catalog || []).find((item) => item.id === ui.selectedId) || filteredCatalog()[0];
    if (!module) { $('nexusModuleDetail').innerHTML = '<div class="module-detail-empty"><span>◇</span><strong>Select a Nexus module</strong><p>Open a card to review its functions, dependencies and migration checklist.</p></div>'; return; }
    ui.selectedId = module.id;
    const owner = canOwn();
    const completed = new Set(module.state?.completedSteps || []);
    $('nexusModuleDetail').innerHTML = `
      <div class="module-detail-header"><div><span class="eyebrow">${escapeHtml(module.category)}</span><h3>${escapeHtml(module.name)}</h3></div><span class="module-stage-badge">${escapeHtml(stageLabels[module.stage] || module.stage)}</span></div><p>${escapeHtml(module.description)}</p>
      <div class="module-detail-stats"><div><span>Progress</span><strong>${module.progress}%</strong></div><div><span>Access</span><strong>${escapeHtml(module.requiredRole || 'viewer')}</strong></div><div><span>Functions</span><strong>${module.features.length}</strong></div></div>
      <section class="module-detail-section"><h4>Functions</h4><ul>${module.features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join('')}</ul></section>
      <section class="module-detail-section"><h4>Migration checklist</h4><div class="module-step-list">${ui.payload.steps.map((step) => `<label class="module-step ${completed.has(step.id) ? 'complete' : ''}"><input type="checkbox" data-module-step="${escapeHtml(step.id)}" ${completed.has(step.id) ? 'checked' : ''} ${owner ? '' : 'disabled'}><span><strong>${escapeHtml(step.label)}</strong><small>${escapeHtml(step.description)}</small></span></label>`).join('')}</div></section>
      <section class="module-detail-section"><h4>Dependencies</h4><p>${escapeHtml(dependencyText(module))}</p></section>
      <section class="module-detail-section"><h4>Website source map</h4><div class="module-route-list">${module.sourceRoutes.map((route) => `<code>${escapeHtml(route)}</code>`).join('')}</div></section>
      ${owner ? `<section class="module-detail-section"><h4>Migration notes</h4><textarea id="moduleNotesInput" rows="5" placeholder="Record decisions, blockers or the next implementation target.">${escapeHtml(module.state?.notes || '')}</textarea></section>` : ''}
      <div class="module-detail-actions">${module.launchView ? `<button class="button primary" data-module-open="${escapeHtml(module.id)}">Open Workspace</button>` : ''}${owner ? `<button class="button" id="moduleToggleButton">${module.state?.enabled ? 'Disable Module' : 'Enable Module'}</button><button class="button" id="moduleSaveNotesButton">Save Notes</button>` : ''}</div>`;
  }
  function render() { if (!ui.payload) return; renderSummary(); renderFilters(); renderGrid(); renderDetail(); }
  function openWorkspace(moduleId) {
    const module = ui.payload.catalog.find((item) => item.id === moduleId);
    if (!module?.launchView) { notify('This workspace is inventoried but not yet available in the desktop shell.'); return; }
    const selector = `[data-view="${CSS.escape(module.launchView)}"], [data-view-link="${CSS.escape(module.launchView)}"]`;
    const button = document.querySelector(selector);
    if (!button) { notify('The target workspace is still initializing.'); return; }
    button.click();
  }
  async function refresh() {
    ui.payload = await invoke('modules:get');
    if (!ui.selectedId || !ui.payload.catalog.some((module) => module.id === ui.selectedId)) ui.selectedId = ui.payload.catalog[0]?.id || null;
    render();
  }
  async function updateSelected(patch) { if (!ui.selectedId) return; ui.payload = await invoke('modules:update', { id: ui.selectedId, patch }); render(); }

  function bindShell() {
    $('moduleRefreshButton').addEventListener('click', refresh);
    $('moduleExportButton').addEventListener('click', async () => { const result = await invoke('modules:export-roadmap'); if (!result?.canceled) notify('Module roadmap exported.'); });
    $('moduleSearchInput').addEventListener('input', (event) => { ui.query = event.target.value; renderGrid(); renderDetail(); });
    $('moduleCategoryFilter').addEventListener('change', (event) => { ui.category = event.target.value; renderGrid(); renderDetail(); });
    $('moduleStageFilter').addEventListener('change', (event) => { ui.stage = event.target.value; renderGrid(); renderDetail(); });
    $('moduleWorkspaceRail').addEventListener('click', (event) => { const chip = event.target.closest('[data-module-workspace]'); if (!chip) return; ui.workspace = chip.dataset.moduleWorkspace; renderFilters(); renderGrid(); renderDetail(); });
    $('nexusModuleGrid').addEventListener('click', (event) => {
      const open = event.target.closest('[data-module-open]'); const details = event.target.closest('[data-module-details], [data-module-id]');
      if (open) { event.stopPropagation(); openWorkspace(open.dataset.moduleOpen); return; }
      const id = details?.dataset.moduleDetails || details?.dataset.moduleId; if (id) { ui.selectedId = id; renderGrid(); renderDetail(); }
    });
    $('nexusModuleDetail').addEventListener('click', async (event) => {
      const open = event.target.closest('[data-module-open]'); if (open) { openWorkspace(open.dataset.moduleOpen); return; }
      if (event.target.closest('#moduleToggleButton')) { const module = ui.payload.catalog.find((item) => item.id === ui.selectedId); await updateSelected({ enabled: !module.state?.enabled }); notify(`${module.name} ${module.state?.enabled ? 'disabled' : 'enabled'}.`); }
      if (event.target.closest('#moduleSaveNotesButton')) { await updateSelected({ notes: $('moduleNotesInput')?.value || '' }); notify('Migration notes saved.'); }
    });
    $('nexusModuleDetail').addEventListener('change', async (event) => {
      const step = event.target.closest('[data-module-step]'); if (!step) return;
      ui.payload = await invoke('modules:mark-step', { id: ui.selectedId, stepId: step.dataset.moduleStep, completed: step.checked }); render();
    });
  }

  async function initialize() {
    sanitizeLegacyCopy(); ensureModuleShell();
    let sanitizeQueued = false;
    const observer = new MutationObserver(() => { if (sanitizeQueued) return; sanitizeQueued = true; queueMicrotask(() => { sanitizeQueued = false; sanitizeLegacyCopy(); }); });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener('click', (event) => { if (event.target.closest('[data-view="modules"], [data-view-link="modules"]')) setTimeout(() => { sanitizeLegacyCopy(); refresh().catch(() => {}); }, 0); });
    window.khaos.onState(() => sanitizeLegacyCopy());
    await refresh();
  }

  initialize().catch((error) => notify(`Module Center failed to initialize: ${error.message}`));
})();
