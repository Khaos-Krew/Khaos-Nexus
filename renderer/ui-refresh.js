'use strict';

(() => {
  const UI_VIEWS = {
    dnd: {
      title: 'D&D Command Table',
      subtitle: 'Campaigns, characters, sessions, encounters, homebrew, maps, and AI-assisted play in one dedicated workspace.'
    },
    ai: {
      title: 'Nexus AI',
      subtitle: 'Manage one supervised Khaos Nexus AI Runtime with Veyra and Nexus Sentinel kept inside separate security and data boundaries.'
    }
  };

  const byId = (id) => document.getElementById(id);
  const safeText = (value, fallback = 'Unavailable') => {
    const normalized = String(value ?? '').trim();
    return normalized || fallback;
  };

  function addStylesheet() {
    if (document.querySelector('link[href="ui-refresh.css"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'ui-refresh.css';
    document.head.appendChild(link);
  }

  function createNavButton(view, icon, label, description) {
    const button = document.createElement('button');
    button.className = 'nav-item nexus-nav-item';
    button.dataset.view = view;
    button.type = 'button';
    button.setAttribute('aria-label', `${label}: ${description}`);
    button.innerHTML = `<span class="nexus-nav-icon" aria-hidden="true">${icon}</span><span class="nexus-nav-copy"><strong>${label}</strong><small>${description}</small></span>`;
    return button;
  }

  function createNavGroup(label, buttons) {
    const group = document.createElement('section');
    group.className = 'nexus-nav-group';
    const heading = document.createElement('div');
    heading.className = 'nav-label nexus-nav-label';
    heading.textContent = label;
    const nav = document.createElement('nav');
    nav.setAttribute('aria-label', label);
    buttons.filter(Boolean).forEach((button) => nav.appendChild(button));
    group.append(heading, nav);
    return group;
  }

  function enhanceExistingButton(button, label, description) {
    if (!button) return null;
    const icon = button.querySelector(':scope > span')?.textContent || '◆';
    button.classList.add('nexus-nav-item');
    button.type = 'button';
    button.innerHTML = `<span class="nexus-nav-icon" aria-hidden="true">${icon}</span><span class="nexus-nav-copy"><strong>${label}</strong><small>${description}</small></span>`;
    button.setAttribute('aria-label', `${label}: ${description}`);
    return button;
  }

  function installNavigation() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar || byId('nexusNavigation')) return;

    const buttons = Object.fromEntries(
      [...sidebar.querySelectorAll('.nav-item[data-view]')].map((button) => [button.dataset.view, button])
    );

    enhanceExistingButton(buttons.dashboard, 'Command Center', 'Health, activity, and quick actions');
    enhanceExistingButton(buttons.setup, 'Discord', 'Bot identity and connection');
    enhanceExistingButton(buttons.servers, 'Game Servers', 'ARK, Palworld, and RCON');
    enhanceExistingButton(buttons.modules, 'All Modules', 'Feature switches and companion tools');
    enhanceExistingButton(buttons.monitor, 'Application Monitor', 'Recovery, reports, and diagnostics');
    enhanceExistingButton(buttons.logs, 'Live Logs', 'Runtime and desktop activity');
    enhanceExistingButton(buttons.settings, 'Settings', 'Startup, updates, and backups');

    const dndButton = createNavButton('dnd', '✦', 'D&D', 'Campaign and table command');
    const aiButton = createNavButton('ai', '◉', 'Nexus AI', 'Assistant, monitors, and services');

    const navigation = document.createElement('div');
    navigation.id = 'nexusNavigation';
    navigation.className = 'nexus-navigation';
    navigation.append(
      createNavGroup('Command', [buttons.dashboard]),
      createNavGroup('Connected Systems', [buttons.setup, buttons.servers]),
      createNavGroup('Nexus Workspaces', [dndButton, aiButton, buttons.modules]),
      createNavGroup('System', [buttons.monitor, buttons.logs, buttons.settings])
    );

    [...sidebar.children].forEach((child) => {
      if (child.matches?.('.nav-label, nav')) child.remove();
    });

    const footer = sidebar.querySelector('.sidebar-footer');
    sidebar.insertBefore(navigation, footer || null);

    const brand = sidebar.querySelector('.brand');
    if (brand) {
      brand.classList.add('nexus-brand');
      const subtitle = brand.querySelector('span');
      if (subtitle) subtitle.textContent = 'Command Network';
    }
  }

  function dndWorkspaceMarkup() {
    return `
      <div class="nexus-workspace nexus-dnd-workspace">
        <section class="nexus-hero nexus-dnd-hero">
          <div class="nexus-hero-copy">
            <span class="eyebrow">Emberforge Archive</span>
            <h2>Your campaign command table</h2>
            <p>Plan sessions, manage characters and sources, run encounters, review homebrew, work with maps, and use Veyra, the isolated D&D Lorewarden and Co-DM from one first-class destination.</p>
            <div class="nexus-action-row">
              <button class="button primary" type="button" data-khaos-open="dnd">Open Existing D&D Workspace</button>
              <button class="button" type="button" data-view-link="modules">Manage D&D Modules</button>
            </div>
          </div>
          <div class="nexus-emblem nexus-dnd-emblem" aria-hidden="true">
            <span class="nexus-orbit orbit-one"></span>
            <span class="nexus-orbit orbit-two"></span>
            <span class="nexus-die">20</span>
          </div>
        </section>

        <div class="nexus-status-strip">
          <div><span class="nexus-status-dot"></span><strong>D&D workspace</strong><small>Local campaign authority preserved</small></div>
          <div><span class="nexus-status-dot"></span><strong id="dndAiRuntimeStatus">Checking Veyra</strong><small id="dndAiRuntimeDetail">Isolated agent status</small></div>
          <div><span class="nexus-status-dot"></span><strong>Discord binding</strong><small>Existing-channel workflow retained</small></div>
        </div>

        <div class="nexus-feature-grid">
          <article class="nexus-feature-card feature-campaigns">
            <span class="nexus-feature-icon">⌘</span>
            <div><span class="eyebrow">Campaign Center</span><h3>Campaigns & Members</h3><p>Campaign setup, role-aware membership, source controls, Discord bindings, and upcoming-session readiness.</p></div>
            <button class="text-button" type="button" data-khaos-open="dnd">Open campaign tools</button>
          </article>
          <article class="nexus-feature-card feature-characters">
            <span class="nexus-feature-icon">♜</span>
            <div><span class="eyebrow">Player Records</span><h3>Characters & Content</h3><p>Character sheets, inventory, spells, licensed metadata, free content, and reviewed homebrew workflows.</p></div>
            <button class="text-button" type="button" data-khaos-open="dnd">Open character tools</button>
          </article>
          <article class="nexus-feature-card feature-encounters">
            <span class="nexus-feature-icon">⚔</span>
            <div><span class="eyebrow">Live Table</span><h3>Sessions & Encounters</h3><p>Session preparation, recaps, attendance, initiative, NPCs, loot, encounter panels, and explicit turn controls.</p></div>
            <button class="text-button" type="button" data-khaos-open="dnd">Open session tools</button>
          </article>
          <article class="nexus-feature-card feature-ai-gm">
            <span class="nexus-feature-icon">✧</span>
            <div><span class="eyebrow">AI-Assisted Play</span><h3>Co-DM, Maps & AI Game Master</h3><p>Private review drafts, safe homebrew proposals, deterministic map proposals, and explicit AI GM table turns.</p></div>
            <button class="text-button" type="button" data-view-link="ai">Review AI services</button>
          </article>
        </div>

        <div class="two-column nexus-boundary-grid">
          <article class="panel nexus-boundary-panel">
            <div class="panel-heading"><div><span class="eyebrow">Authority Boundary</span><h3>Campaign data stays with D&D</h3></div><span class="tag good">Protected</span></div>
            <ul class="nexus-check-list">
              <li>Veyra is the only AI agent allowed to receive approved campaign context.</li>
              <li>Every outgoing context package is bounded, redacted, and explicitly reviewed.</li>
              <li>AI output remains a private proposal until a user applies an approved change.</li>
              <li>No automatic Discord post, roll resolution, encounter mutation, or campaign publication.</li>
            </ul>
          </article>
          <article class="panel nexus-boundary-panel">
            <div class="panel-heading"><div><span class="eyebrow">Table Readiness</span><h3>Existing systems, new home</h3></div><span class="tag">No migration</span></div>
            <p>The dedicated tab is a presentation and navigation layer over the current D&D services. It does not duplicate campaign storage, permissions, Discord provisioning, AI processes, or schedulers.</p>
            <div class="nexus-inline-actions">
              <button class="button" type="button" data-view-link="setup">Discord Setup</button>
              <button class="button" type="button" data-view-link="monitor">Diagnostics</button>
            </div>
          </article>
        </div>
      </div>`;
  }

  function aiWorkspaceMarkup() {
    return `
      <div class="nexus-workspace nexus-ai-workspace">
        <section class="nexus-hero nexus-ai-hero">
          <div class="nexus-hero-copy">
            <span class="eyebrow">Khaos Nexus AI Runtime</span>
            <h2>One supervised runtime. Two dedicated agents.</h2>
            <p>Run Veyra and Nexus Sentinel through one protected local host while preserving separate memory, prompts, tools, credentials, endpoints, logs, and restart boundaries.</p>
            <div class="nexus-action-row">
              <button class="button primary" type="button" data-khaos-open="ai">Open AI Runtime</button>
              <button class="button" type="button" data-view-link="monitor">Open Application Monitor</button>
            </div>
          </div>
          <div class="nexus-emblem nexus-ai-emblem" aria-hidden="true">
            <span class="nexus-core-ring ring-one"></span>
            <span class="nexus-core-ring ring-two"></span>
            <span class="nexus-core-ring ring-three"></span>
            <span class="nexus-core-eye"></span>
          </div>
        </section>

        <div class="nexus-service-grid">
          <article class="nexus-service-card service-dnd-ai">
            <div class="nexus-service-heading"><span class="nexus-service-mark">D20</span><div><span class="eyebrow">D&D Lorewarden and Co-DM</span><h3>Veyra</h3></div><span class="tag" id="dndAiServiceBadge">Checking</span></div>
            <p>Co-DM drafts, copyright-safe homebrew proposals, procedural map proposals, and explicit AI Game Master sessions.</p>
            <dl class="nexus-service-details">
              <div><dt>Context</dt><dd>Approved D&D only</dd></div>
              <div><dt>Authority</dt><dd>Review and apply</dd></div>
              <div><dt>Worker</dt><dd id="dndAiServiceRuntime">Bundled / isolated</dd></div>
            </dl>
          </article>
          <article class="nexus-service-card service-core-ai">
            <div class="nexus-service-heading"><span class="nexus-service-mark">NX</span><div><span class="eyebrow">System Health and Assistance AI</span><h3>Nexus Sentinel</h3></div><span class="tag" id="nexusAiServiceBadge">Checking</span></div>
            <p>Application assistance, game and mod update monitoring, advisory maintenance proposals, and Nexus Bot integration.</p>
            <dl class="nexus-service-details">
              <div><dt>Context</dt><dd>No D&D campaign data</dd></div>
              <div><dt>Authority</dt><dd>Advisory only</dd></div>
              <div><dt>Worker</dt><dd id="nexusAiServiceRuntime">Bundled / isolated</dd></div>
            </dl>
          </article>
        </div>

        <div class="nexus-feature-grid nexus-ai-feature-grid">
          <article class="nexus-feature-card"><span class="nexus-feature-icon">◎</span><div><span class="eyebrow">Assistant</span><h3>Context-Aware Help</h3><p>Use the existing assistant surfaces with explicit context selection and service capability negotiation.</p></div><button class="text-button" type="button" data-khaos-open="ai">Open assistant controls</button></article>
          <article class="nexus-feature-card"><span class="nexus-feature-icon">⌁</span><div><span class="eyebrow">Monitors</span><h3>Game & Mod Updates</h3><p>Review manual and shared-scheduler update checks without adding an AI-owned scheduler.</p></div><button class="text-button" type="button" data-view-link="monitor">Open monitor</button></article>
          <article class="nexus-feature-card"><span class="nexus-feature-icon">⇄</span><div><span class="eyebrow">Integrations</span><h3>Nexus Bot & Modules</h3><p>Keep bot commands, module adapters, service tokens, and permission checks inside existing authorities.</p></div><button class="text-button" type="button" data-view-link="modules">Review modules</button></article>
          <article class="nexus-feature-card"><span class="nexus-feature-icon">≋</span><div><span class="eyebrow">Activity</span><h3>Health, Logs & Settings</h3><p>Use existing diagnostics, protected settings, and local logs for service troubleshooting and audit evidence.</p></div><button class="text-button" type="button" data-view-link="logs">Open logs</button></article>
        </div>

        <article class="panel nexus-boundary-panel nexus-ai-boundary">
          <div class="panel-heading"><div><span class="eyebrow">Security Contract</span><h3>Shared host, enforceable agent isolation</h3></div><span class="tag good">Local-first</span></div>
          <div class="nexus-boundary-columns">
            <ul class="nexus-check-list">
              <li>One supervised host owns two separate worker processes with independent endpoints, protected tokens, logs, readiness, and shutdown handling.</li>
              <li>No provider credentials, service tokens, or campaign records exposed to renderer state.</li>
            </ul>
            <ul class="nexus-check-list">
              <li>Nexus Sentinel remains advisory and cannot issue game-server commands directly.</li>
              <li>Recurring monitor execution remains owned by the shared Khaos Nexus scheduler.</li>
            </ul>
          </div>
          <div class="nexus-inline-actions">
            <button class="button" type="button" data-view-link="settings">AI & Desktop Settings</button>
            <button class="button" type="button" data-view-link="monitor">Service Diagnostics</button>
          </div>
        </article>
      </div>`;
  }

  function installWorkspaces() {
    const content = document.querySelector('main.content');
    if (!content) return;
    const insertionPoint = byId('view-monitor') || byId('view-logs') || byId('view-settings');

    if (!byId('view-dnd')) {
      const dnd = document.createElement('section');
      dnd.className = 'view nexus-view';
      dnd.id = 'view-dnd';
      dnd.setAttribute('aria-labelledby', 'viewTitle');
      dnd.innerHTML = dndWorkspaceMarkup();
      content.insertBefore(dnd, insertionPoint || null);
    }

    if (!byId('view-ai')) {
      const ai = document.createElement('section');
      ai.className = 'view nexus-view';
      ai.id = 'view-ai';
      ai.setAttribute('aria-labelledby', 'viewTitle');
      ai.innerHTML = aiWorkspaceMarkup();
      content.insertBefore(ai, insertionPoint || null);
    }
  }

  function installDashboardLinks() {
    const grid = document.querySelector('#view-dashboard .quick-grid');
    if (!grid || grid.querySelector('[data-view-link="dnd"]')) return;
    const dnd = document.createElement('button');
    dnd.className = 'quick-card nexus-quick-card';
    dnd.type = 'button';
    dnd.dataset.viewLink = 'dnd';
    dnd.innerHTML = '<strong>D&D Command Table</strong><span>Campaigns, sessions, encounters, maps, and AI-assisted play</span>';
    const ai = document.createElement('button');
    ai.className = 'quick-card nexus-quick-card';
    ai.type = 'button';
    ai.dataset.viewLink = 'ai';
    ai.innerHTML = '<strong>Nexus AI</strong><span>Bundled AI services, monitors, integrations, and health</span>';
    grid.prepend(ai);
    grid.prepend(dnd);
  }

  function setUiView(name) {
    const meta = UI_VIEWS[name];
    const target = byId(`view-${name}`);
    if (!meta || !target) return false;

    document.querySelectorAll('.view').forEach((element) => element.classList.toggle('active', element === target));
    document.querySelectorAll('.nav-item').forEach((element) => {
      const active = element.dataset.view === name;
      element.classList.toggle('active', active);
      if (active) element.setAttribute('aria-current', 'page');
      else element.removeAttribute('aria-current');
    });

    const title = byId('viewTitle');
    const subtitle = byId('viewSubtitle');
    if (title) title.textContent = meta.title;
    if (subtitle) subtitle.textContent = meta.subtitle;
    document.body.dataset.nexusView = name;
    document.querySelector('main.content')?.scrollTo({ top: 0, behavior: 'auto' });
    return true;
  }

  function syncActiveView() {
    const active = document.querySelector('.view.active');
    const name = active?.id?.replace(/^view-/, '') || 'dashboard';
    document.body.dataset.nexusView = name;
    document.querySelectorAll('.nav-item').forEach((element) => {
      const isActive = element.dataset.view === name;
      if (isActive) element.setAttribute('aria-current', 'page');
      else element.removeAttribute('aria-current');
    });
  }

  function showNotice(message) {
    const toast = byId('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showNotice.timer);
    showNotice.timer = setTimeout(() => toast.classList.remove('show'), 4200);
  }

  function findExistingWorkspace(kind) {
    const patterns = kind === 'dnd'
      ? [/d&d/i, /campaign/i, /tabletop/i, /game master/i, /co-dm/i]
      : [/ai services/i, /nexus ai/i, /intelligence/i, /assistant/i];
    const ownView = kind;
    return [...document.querySelectorAll('.nav-item[data-view], [data-view-link]')].find((element) => {
      const view = element.dataset.view || element.dataset.viewLink || '';
      if (!view || view === ownView) return false;
      const text = `${view} ${element.textContent || ''}`;
      return patterns.some((pattern) => pattern.test(text));
    });
  }

  function openExistingWorkspace(kind) {
    const existing = findExistingWorkspace(kind);
    if (existing) {
      existing.click();
      return;
    }
    const fallback = kind === 'dnd' ? 'modules' : 'settings';
    document.querySelector(`[data-view="${fallback}"]`)?.click();
    showNotice(kind === 'dnd'
      ? 'The D&D command tab is ready. Existing campaign controls remain under the current module workspace until their renderer extension is active.'
      : 'The Nexus AI tab is ready. Existing protected service controls remain under the current AI/desktop settings surface.');
  }

  function bindNavigation() {
    document.addEventListener('click', (event) => {
      const direct = event.target.closest('[data-view]');
      const linked = event.target.closest('[data-view-link]');
      const requested = direct?.dataset.view || linked?.dataset.viewLink;
      if (requested && UI_VIEWS[requested]) {
        event.preventDefault();
        setTimeout(() => setUiView(requested), 0);
        return;
      }

      const open = event.target.closest('[data-khaos-open]');
      if (open) {
        event.preventDefault();
        openExistingWorkspace(open.dataset.khaosOpen);
        return;
      }

      if (direct || linked) setTimeout(syncActiveView, 0);
    });
  }

  function readServiceCandidate(state, type) {
    const roots = [
      state?.aiServices,
      state?.bundledAiRuntimes,
      state?.bundledAi,
      state?.ai,
      state?.services,
      state?.runtime?.aiServices
    ].filter(Boolean);
    const keys = type === 'dnd'
      ? ['dnd', 'dndAi', 'dndAI', 'dndService', 'campaignAi']
      : ['core', 'nexus', 'nexusAi', 'nexusAI', 'aiCore', 'nexusAiCore'];
    for (const root of roots) {
      for (const key of keys) if (root?.[key]) return root[key];
    }
    return null;
  }

  function normalizeServiceStatus(service) {
    if (!service) return { label: 'Bundled', tone: '', detail: 'Status available in existing service controls' };
    const raw = service.status || service.state || service.health?.status || service.lifecycle?.status;
    const ready = service.ready ?? service.health?.ready ?? service.running;
    const label = raw ? safeText(raw) : ready === true ? 'Ready' : ready === false ? 'Stopped' : 'Bundled';
    const normalized = label.toLowerCase();
    const tone = /ready|online|healthy|running/.test(normalized) ? 'good' : /error|failed|crash|unhealthy/.test(normalized) ? 'bad' : '';
    const detail = service.version ? `Version ${service.version}` : service.endpoint ? 'Loopback service configured' : 'Isolated packaged runtime';
    return { label, tone, detail };
  }

  function applyServiceState(state) {
    const dnd = normalizeServiceStatus(readServiceCandidate(state, 'dnd'));
    const core = normalizeServiceStatus(readServiceCandidate(state, 'core'));
    const setBadge = (id, status) => {
      const badge = byId(id);
      if (!badge) return;
      badge.textContent = status.label;
      badge.className = `tag ${status.tone}`.trim();
    };
    setBadge('dndAiServiceBadge', dnd);
    setBadge('nexusAiServiceBadge', core);
    if (byId('dndAiRuntimeStatus')) byId('dndAiRuntimeStatus').textContent = `Veyra: ${dnd.label}`;
    if (byId('dndAiRuntimeDetail')) byId('dndAiRuntimeDetail').textContent = dnd.detail;
    if (byId('dndAiServiceRuntime')) byId('dndAiServiceRuntime').textContent = dnd.detail;
    if (byId('nexusAiServiceRuntime')) byId('nexusAiServiceRuntime').textContent = core.detail;
  }

  function bindServiceState() {
    window.khaos?.onState?.(applyServiceState);
    window.khaos?.invoke?.('app:get-state').then(applyServiceState).catch(() => {
      applyServiceState(null);
    });
  }

  function install() {
    if (document.body.dataset.khaosUiRefresh === 'installed') return;
    document.body.dataset.khaosUiRefresh = 'installed';
    document.body.classList.add('khaos-ui-refresh');
    addStylesheet();
    installNavigation();
    installWorkspaces();
    installDashboardLinks();
    bindNavigation();
    bindServiceState();
    syncActiveView();
    window.khaos?.reportBootStage?.('ui-refresh-ready', { views: Object.keys(UI_VIEWS) });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
