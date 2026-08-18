'use strict';

(() => {
  if (window.__nexusSentinelRoadmapInstalled) return;
  window.__nexusSentinelRoadmapInstalled = true;

  const ACTIVE_MODULES = new Set([
    'discord-runtime',
    'game-server-control',
    'palworld-operations',
    'operator-console',
    'application-monitor',
    'backup-update-center',
    'players-console',
    'server-status-panels',
    'embed-studio',
    'role-menus',
    'color-roles',
    'discord-organization',
    'discord-audit-logging',
    'discord-observability',
    'palworld-companion',
    'admin-command-center'
  ]);

  const STATUS_META = Object.freeze({
    operational: { label: 'Operational', detail: 'Enabled and ready to run' },
    migrating: { label: 'Migrate in progress', detail: 'Available foundation still being completed' },
    disabled: { label: 'Disabled', detail: 'Turned off by the owner' },
    blocked: { label: 'Blocked', detail: 'Waiting on an enabled dependency' }
  });

  let appState = null;
  let modulePayload = null;
  let moduleRefreshPromise = null;
  let renderTimer = null;
  let observer = null;

  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[character]));
  }

  function notify(message) {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = String(message || 'Done.');
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('show'), 3800);
  }

  async function invoke(channel, payload) {
    try { return await window.khaos.invoke(channel, payload); }
    catch (error) { notify(error.message || String(error)); throw error; }
  }

  function canOwn() {
    const access = appState?.autonomy?.access;
    if (!access) return true;
    return Boolean(access.canOwn);
  }

  function moduleStatus(module) {
    if (!module?.state?.enabled) return 'disabled';
    const runtime = module.runtime || {};
    if (runtime.blockedBy?.length || runtime.reason === 'dependency-disabled' || runtime.reason === 'dependency-cycle') return 'blocked';
    if (module.availability !== 'implemented') return 'migrating';
    if (runtime.effectiveEnabled) return 'operational';
    return 'blocked';
  }

  function visibleModules() {
    return (modulePayload?.catalog || [])
      .filter((module) => ACTIVE_MODULES.has(String(module.id || '')))
      .sort((left, right) => Number(left.priority || 999) - Number(right.priority || 999));
  }

  function statusCounts(modules) {
    const counts = { operational: 0, migrating: 0, disabled: 0, blocked: 0 };
    modules.forEach((module) => { counts[moduleStatus(module)] += 1; });
    return counts;
  }

  function ensureDashboardRoadmap() {
    const dashboard = $('view-dashboard');
    if (!dashboard || $('sentinelTestRoadmap')) return;
    const panel = document.createElement('article');
    panel.id = 'sentinelTestRoadmap';
    panel.className = 'panel sentinel-test-roadmap';
    const quickLaunch = dashboard.querySelector('.quick-launch-panel');
    if (quickLaunch) dashboard.insertBefore(panel, quickLaunch);
    else dashboard.appendChild(panel);
    panel.addEventListener('click', (event) => {
      const target = event.target.closest('[data-sentinel-open]');
      if (!target) return;
      openView(target.dataset.sentinelOpen);
    });
  }

  function dashboardStatusCard(label, value, detail, tone = '') {
    return `<div class="sentinel-roadmap-status ${escapeHtml(tone)}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></div>`;
  }

  function renderDashboardRoadmap() {
    ensureDashboardRoadmap();
    const panel = $('sentinelTestRoadmap');
    if (!panel) return;
    const config = appState?.config || {};
    const bot = appState?.bot || {};
    const servers = Array.isArray(config.servers) ? config.servers : [];
    const modules = visibleModules();
    const counts = statusCounts(modules);
    const discordReady = Boolean(config.hasDiscordToken && config.discord?.guildId && config.discord?.ownerUserId);
    const botOnline = Boolean(bot.ready || bot.status === 'online');
    const access = appState?.autonomy?.access || {};
    const accessLabel = access.role || 'local-admin';

    panel.innerHTML = `
      <div class="panel-heading sentinel-roadmap-heading">
        <div><span class="eyebrow">Acceptance roadmap</span><h3>Nexus Sentinel test path</h3><p>Work left-to-right. The controls below open safe workspaces; destructive Palworld actions remain inside their guarded panels.</p></div>
        <span class="tag ${discordReady ? 'good' : ''}">${discordReady ? 'Setup detected' : 'Setup needed'}</span>
      </div>
      <div class="sentinel-roadmap-status-grid">
        ${dashboardStatusCard('Sentinel runtime', botOnline ? 'Online' : (bot.status || 'Stopped'), botOnline ? 'Discord worker is supervised' : 'Start after Discord setup', botOnline ? 'good' : 'warn')}
        ${dashboardStatusCard('Discord', discordReady ? 'Configured' : 'Needs setup', discordReady ? 'Token, guild and owner are present' : 'Complete protected Discord setup', discordReady ? 'good' : 'warn')}
        ${dashboardStatusCard('Palworld', `${servers.length} server${servers.length === 1 ? '' : 's'}`, servers.length ? 'Only Palworld targets are exposed' : 'Add a Palworld server when ready', servers.length ? 'good' : '')}
        ${dashboardStatusCard('Modules', `${counts.operational} operational`, `${counts.migrating} in progress • ${counts.disabled} disabled • ${counts.blocked} blocked`, counts.blocked ? 'warn' : 'good')}
        ${dashboardStatusCard('Desktop access', accessLabel, canOwn() ? 'Owner controls available' : 'Owner-only surfaces are hidden', canOwn() ? 'good' : '')}
      </div>
      <div class="sentinel-test-steps">
        <button class="sentinel-test-step" data-sentinel-open="setup"><b>1</b><span><strong>Discord</strong><small>Credentials, OAuth and Sentinel start</small></span></button>
        <button class="sentinel-test-step" data-sentinel-open="servers"><b>2</b><span><strong>Palworld</strong><small>Connection, status, players and safe controls</small></span></button>
        <button class="sentinel-test-step" data-sentinel-open="readiness"><b>3</b><span><strong>Readiness</strong><small>Run local checks, then explicit live tests</small></span></button>
        <button class="sentinel-test-step" data-sentinel-open="modules"><b>4</b><span><strong>Modules</strong><small>Confirm operational, disabled and blocked states</small></span></button>
        ${canOwn() ? '<button class="sentinel-test-step" data-sentinel-open="monitor"><b>5</b><span><strong>Diagnostics</strong><small>Owner-only Application Monitor and reports</small></span></button>' : ''}
      </div>`;
  }

  function ensureModuleCenter() {
    const view = $('view-modules');
    if (!view) return null;
    const legacy = $('nexusModuleCenter');
    if (legacy) legacy.classList.add('sentinel-hidden');
    let center = $('sentinelModuleCenter');
    if (center) return center;
    center = document.createElement('section');
    center.id = 'sentinelModuleCenter';
    center.className = 'sentinel-module-center';
    view.appendChild(center);
    center.addEventListener('click', handleModuleClick);
    return center;
  }

  function moduleCard(module) {
    const status = moduleStatus(module);
    const meta = STATUS_META[status];
    const blockedBy = module.runtime?.blockedBy || [];
    const detail = status === 'blocked' && blockedBy.length
      ? `Requires ${blockedBy.map((id) => modulePayload?.catalog?.find((item) => item.id === id)?.name || id).join(', ')}`
      : meta.detail;
    const toggleAllowed = canOwn() && module.availability !== 'planned';
    const featureText = (module.features || []).slice(0, 4).map((feature) => `<span>${escapeHtml(feature)}</span>`).join('');
    return `
      <article class="sentinel-module-card status-${status}" data-sentinel-module="${escapeHtml(module.id)}">
        <header><div><span class="sentinel-module-workspace">${escapeHtml(module.workspace || module.category || 'Nexus')}</span><h3>${escapeHtml(module.name)}</h3></div><span class="sentinel-module-status">${escapeHtml(meta.label)}</span></header>
        <p>${escapeHtml(module.description)}</p>
        <div class="sentinel-module-features">${featureText}</div>
        <div class="sentinel-module-state-detail">${escapeHtml(detail)}</div>
        <footer>
          ${module.launchView ? `<button class="button" data-sentinel-module-open="${escapeHtml(module.id)}">Open</button>` : ''}
          ${toggleAllowed ? `<button class="button ${module.state?.enabled ? 'danger' : 'primary'}" data-sentinel-module-toggle="${escapeHtml(module.id)}">${module.state?.enabled ? 'Disable' : 'Enable'}</button>` : ''}
        </footer>
      </article>`;
  }

  function renderModuleCenter() {
    const center = ensureModuleCenter();
    if (!center || !modulePayload) return;
    const modules = visibleModules();
    const counts = statusCounts(modules);
    center.innerHTML = `
      <div class="sentinel-module-hero">
        <div><span class="eyebrow">Runtime modules</span><h2>Nexus Sentinel Modules</h2><p>Only Discord, Palworld and the supporting desktop systems in this test product are shown. Implemented modules can be turned on or off by the owner.</p></div>
        <button class="button" id="sentinelModuleRefreshButton">Refresh</button>
      </div>
      <div class="sentinel-module-summary">
        ${dashboardStatusCard('Operational', counts.operational, 'Enabled and ready', 'good')}
        ${dashboardStatusCard('Migrate in progress', counts.migrating, 'Usable foundation still being completed', 'warn')}
        ${dashboardStatusCard('Disabled', counts.disabled, 'Turned off by owner')}
        ${dashboardStatusCard('Blocked', counts.blocked, 'Dependency is disabled', counts.blocked ? 'warn' : 'good')}
      </div>
      <div class="sentinel-module-help"><strong>Status model:</strong> Operational = ready now • Migrate in progress = partial feature set • Disabled = owner choice • Blocked = dependency unavailable.</div>
      <div class="sentinel-module-grid">${modules.map(moduleCard).join('')}</div>`;
    $('sentinelModuleRefreshButton')?.addEventListener('click', () => refreshModules(true));
  }

  async function handleModuleClick(event) {
    const open = event.target.closest('[data-sentinel-module-open]');
    if (open) {
      const module = visibleModules().find((item) => item.id === open.dataset.sentinelModuleOpen);
      if (module?.launchView) openView(module.launchView);
      return;
    }
    const toggle = event.target.closest('[data-sentinel-module-toggle]');
    if (!toggle || !canOwn()) return;
    const module = visibleModules().find((item) => item.id === toggle.dataset.sentinelModuleToggle);
    if (!module) return;
    toggle.disabled = true;
    try {
      modulePayload = await invoke('modules:update', { id: module.id, patch: { enabled: !module.state?.enabled } });
      renderAll();
    } finally {
      toggle.disabled = false;
    }
  }

  async function refreshModules(force = false) {
    if (moduleRefreshPromise && !force) return moduleRefreshPromise;
    moduleRefreshPromise = invoke('modules:get')
      .then((payload) => {
        if (payload?.catalog) modulePayload = payload;
        renderAll();
        return modulePayload;
      })
      .catch(() => modulePayload)
      .finally(() => { moduleRefreshPromise = null; });
    return moduleRefreshPromise;
  }

  function openView(view) {
    const target = document.querySelector(`[data-view="${CSS.escape(view)}"], [data-view-link="${CSS.escape(view)}"]`);
    if (target && !target.classList.contains('sentinel-hidden')) {
      target.click();
      if (view === 'modules') setTimeout(() => refreshModules(true), 0);
      return true;
    }
    notify(`${view} is not available in the current Nexus Sentinel scope.`);
    return false;
  }

  function scopeOwnerOnlyMonitor() {
    const owner = canOwn();
    document.querySelectorAll('[data-view="monitor"], [data-view-link="monitor"], #view-monitor').forEach((node) => {
      node.classList.toggle('sentinel-owner-only-hidden', !owner);
    });
    const active = document.querySelector('.view.active');
    if (!owner && active?.id === 'view-monitor') openView('dashboard');
  }

  function replaceReadinessText(value) {
    return String(value || '')
      .replace(/First-run Readiness Center/g, 'Nexus Sentinel Readiness')
      .replace(/Checking Khaos Nexus/g, 'Checking Nexus Sentinel')
      .replace(/Game servers and reporting/g, 'Palworld & reporting')
      .replace(/Game-server RCON/g, 'Palworld server connectivity')
      .replace(/Check All Servers/g, 'Check Palworld Servers')
      .replace(/every enabled configured server/g, 'every enabled Palworld server')
      .replace(/read-only RCON checks/g, 'read-only Palworld connection checks')
      .replace(/Configured game servers/g, 'Configured Palworld servers')
      .replace(/RCON passwords/g, 'Palworld server credentials')
      .replace(/RCON addresses/g, 'Palworld server addresses')
      .replace(/enabled RCON target\(s\)/g, 'enabled Palworld server(s)')
      .replace(/Add your wife’s Discord user ID before enabling access control\./g, 'Add an additional trusted operator Discord user ID before enabling access control.');
  }

  function scopeReadinessCopy() {
    const view = $('view-readiness');
    if (!view) return;
    view.querySelectorAll('h2,h3,h4,p,span,strong,small,button').forEach((node) => {
      if (node.children.length) return;
      const next = replaceReadinessText(node.textContent);
      if (next !== node.textContent) node.textContent = next;
    });
  }

  function scopeStaticCopy() {
    const banner = $('view-dashboard')?.querySelector('.local-banner');
    if (banner) {
      const strong = banner.querySelector('strong');
      const detail = banner.querySelector('div span');
      if (strong) strong.textContent = 'Nexus Sentinel local command network';
      if (detail) detail.textContent = 'Discord, Palworld, modules, logs, backups and protected operator settings run from this PC.';
    }
    const quickServer = [...document.querySelectorAll('#view-dashboard .quick-card')].find((card) => /Game Servers|Palworld Servers/i.test(card.textContent || ''));
    if (quickServer) {
      const strong = quickServer.querySelector('strong');
      const detail = quickServer.querySelector('span');
      if (strong) strong.textContent = 'Palworld Servers';
      if (detail) detail.textContent = 'Status, players, settings, saves and guarded moderation';
    }
  }

  function renderAll() {
    scopeStaticCopy();
    scopeOwnerOnlyMonitor();
    scopeReadinessCopy();
    renderDashboardRoadmap();
    renderModuleCenter();
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderTimer = null;
      renderAll();
    }, 60);
  }

  function relevantMutation(mutation) {
    return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => {
      if (!node || node.nodeType !== 1) return false;
      return Boolean(node.matches?.('#view-readiness,#view-modules,#nexusModuleCenter,.nav-item,.quick-card')
        || node.querySelector?.('#view-readiness,#view-modules,#nexusModuleCenter,.nav-item,.quick-card'));
    });
  }

  async function initialize() {
    if (window.khaosStateHub?.subscribe) {
      window.khaosStateHub.subscribe((next) => {
        appState = next;
        renderAll();
      });
    }
    try { appState = await invoke('app:get-state'); } catch {}
    await refreshModules();
    renderAll();

    document.addEventListener('click', (event) => {
      if (event.target.closest('[data-view="modules"], [data-view-link="modules"]')) setTimeout(() => refreshModules(true), 0);
      if (event.target.closest('[data-view="readiness"], [data-view-link="readiness"]')) setTimeout(scopeReadinessCopy, 0);
    });

    observer = new MutationObserver((mutations) => {
      if (mutations.some(relevantMutation)) scheduleRender();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('beforeunload', () => {
      observer?.disconnect();
      clearTimeout(renderTimer);
    }, { once: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initialize().catch(() => {}), { once: true });
  else initialize().catch(() => {});
})();
