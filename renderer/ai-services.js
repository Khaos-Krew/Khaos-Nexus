'use strict';

(function installAiServices(win) {
  if (!win?.document || win.__khaosAiServices) return;
  const doc = win.document;
  const state = { payload: null, busy: false, installed: false };
  const invoke = (channel, payload) => win.khaos.invoke(channel, payload);
  const toast = (message) => typeof win.toast === 'function' ? win.toast(message) : console.info(message);
  const clean = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

  function ensureNavigation() {
    const systemLabel = [...doc.querySelectorAll('.nav-label')].find((item) => item.textContent.trim() === 'System');
    const nav = systemLabel?.nextElementSibling;
    if (!nav) return null;
    let button = nav.querySelector('[data-view="ai-services"]');
    if (!button) {
      button = doc.createElement('button');
      button.className = 'nav-item';
      button.type = 'button';
      button.dataset.view = 'ai-services';
      button.innerHTML = '<span>✦</span>AI Services';
      nav.insertBefore(button, nav.querySelector('[data-view="monitor"]') || nav.firstChild);
    }
    return button;
  }

  function ensureView() {
    let view = doc.getElementById('view-ai-services');
    if (view) return view;
    view = doc.createElement('section');
    view.className = 'view';
    view.id = 'view-ai-services';
    const content = doc.querySelector('main.content');
    content?.appendChild(view);
    return view;
  }

  function serviceStatus(service = {}) {
    if (!service.reachable) return `<span class="tag warning">Not connected</span><p class="ai-service-error">${escapeHtml(service.error || 'Connection has not been checked.')}</p>`;
    const identity = [service.service, service.version && `v${service.version}`, service.provider, service.model].filter(Boolean).join(' · ');
    return `<span class="tag success">Connected</span><p>${escapeHtml(identity || 'Connected')}</p>`;
  }

  function capabilityTags(capabilities = []) {
    if (!capabilities.length) return '<span class="tag">No validated capabilities loaded</span>';
    return capabilities.map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join('');
  }

  function dndCard() {
    const dnd = state.payload?.dnd || {};
    const settings = dnd.settings || {};
    const service = dnd.service || {};
    return `<article class="panel ai-service-card">
      <div class="panel-heading"><div><span class="eyebrow">Desktop D&D only</span><h3>Khaos Nexus D&D AI</h3></div>${serviceStatus(service)}</div>
      <p>${escapeHtml(dnd.role || '')}</p>
      <div class="ai-service-boundary"><strong>Repository</strong><code>${escapeHtml(dnd.repository || '')}</code><strong>Consumers</strong><span>Desktop D&D workspace only</span></div>
      <div class="callout">Campaign context, Co-DM drafts, homebrew, maps, and AI Game Master sessions stay isolated here. This service is never passed to Nexus Bot or Nexus AI Core.</div>
      <form id="dndAiConnectionForm" class="ai-service-form">
        <label>Service endpoint<input name="endpoint" type="url" maxlength="500" value="${escapeHtml(settings.endpoint || 'http://127.0.0.1:8787')}"></label>
        <label>Optional service token<input name="serviceToken" type="password" autocomplete="off" maxlength="500" placeholder="${settings.hasServiceToken ? 'Stored — enter a replacement token' : 'Leave blank if local authentication is disabled'}"></label>
        <div class="form-actions"><button class="button" type="button" data-ai-action="check-dnd">Test D&D AI</button><button class="button" type="button" data-ai-action="remove-dnd-token" ${settings.hasServiceToken ? '' : 'disabled'}>Remove Token</button><button class="button primary" type="submit">Save D&D Connection</button></div>
      </form>
    </article>`;
  }

  function coreCard() {
    const core = state.payload?.core || {};
    const settings = core.settings || {};
    const service = core.service || {};
    const provider = service.providerStatus || {};
    return `<article class="panel ai-service-card">
      <div class="panel-heading"><div><span class="eyebrow">App and primary Nexus Bot</span><h3>Nexus AI Core</h3></div>${serviceStatus(service)}</div>
      <p>${escapeHtml(core.role || '')}</p>
      <div class="ai-service-boundary"><strong>Repository</strong><code>${escapeHtml(core.repository || '')}</code><strong>Pinned snapshot</strong><code>${escapeHtml(core.snapshot || '')}</code></div>
      <div class="callout">AI Core is advisory. It can return diagnostics, update intelligence, Discord-safe drafts, and maintenance proposals, but Khaos Nexus remains authoritative and performs every approved action.</div>
      <form id="aiCoreConnectionForm" class="ai-service-form">
        <label class="toggle-row"><span><strong>Enable Nexus AI Core</strong><small>Allows desktop health and capability discovery.</small></span><input name="enabled" type="checkbox" ${settings.enabled ? 'checked' : ''}></label>
        <label class="toggle-row"><span><strong>Link to the primary Nexus Bot</strong><small>Passes only the bounded endpoint/token contract to the supervised primary bot. Registered secondary bots remain excluded.</small></span><input name="linkToPrimaryBot" type="checkbox" ${settings.linkToPrimaryBot ? 'checked' : ''}></label>
        <label>Service endpoint<input name="endpoint" type="url" maxlength="500" value="${escapeHtml(settings.endpoint || 'http://127.0.0.1:8790')}"></label>
        <label>Optional service token<input name="serviceToken" type="password" autocomplete="off" maxlength="500" placeholder="${settings.hasServiceToken ? 'Stored — enter a replacement token' : 'Leave blank if local authentication is disabled'}"></label>
        <div class="ai-provider-summary"><span>Provider</span><strong>${escapeHtml(provider.name || service.provider || 'Unknown')}</strong><span>Model</span><strong>${escapeHtml(provider.model || service.model || 'Server controlled')}</strong><span>Ready</span><strong>${provider.ready === false ? 'No' : service.reachable ? 'Yes' : 'Unknown'}</strong><span>Circuit</span><strong>${escapeHtml(provider.circuit?.state || 'Unknown')}</strong></div>
        <div class="ai-capabilities">${capabilityTags(service.capabilities || [])}</div>
        <div class="form-actions"><button class="button" type="button" data-ai-action="check-core">Test AI Core</button><button class="button" type="button" data-ai-action="remove-core-token" ${settings.hasServiceToken ? '' : 'disabled'}>Remove Token</button><button class="button primary" type="submit">Save AI Core Connection</button></div>
      </form>
    </article>`;
  }

  function auditHtml() {
    const entries = state.payload?.audit || [];
    return `<article class="panel ai-service-audit"><div class="panel-heading"><div><span class="eyebrow">Local control record</span><h3>Recent AI Connection Activity</h3></div><span class="tag">${entries.length}</span></div>${entries.length ? `<div class="activity-list">${entries.slice(0, 10).map((item) => `<div class="activity info"><span class="activity-dot"></span><div>${escapeHtml(item.action)}</div><small>${escapeHtml(item.time)}</small></div>`).join('')}</div>` : '<p>No AI connection changes have been recorded.</p>'}</article>`;
  }

  function render() {
    const view = ensureView();
    if (!view) return;
    const policy = state.payload?.policy || {};
    view.innerHTML = `<div class="section-intro inline"><div><h2>AI Services</h2><p>Connect the two isolated Khaos Nexus AI runtimes without sharing credentials, data, or authority.</p></div><button class="button" data-ai-action="check-all" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Checking…' : 'Test Both Services'}</button></div>
      <div class="ai-service-policy"><span class="tag success">Independent tokens</span><span class="tag success">D&D isolated</span><span class="tag success">Provider keys stay server-side</span><span class="tag">No automatic execution</span></div>
      <div class="ai-services-grid">${dndCard()}${coreCard()}</div>
      <article class="panel ai-isolation-panel"><div class="panel-heading"><div><span class="eyebrow">Authority boundary</span><h3>What linking does not authorize</h3></div></div><div class="ai-boundary-grid"><span>Automatic Discord publication: <strong>${policy.automaticDiscordPublication ? 'Allowed' : 'Blocked'}</strong></span><span>Automatic server or scheduler execution: <strong>${policy.automaticExecution ? 'Allowed' : 'Blocked'}</strong></span><span>AI Core D&D namespace: <strong>${policy.aiCoreRejectsDndNamespace ? 'Rejected' : 'Unconfirmed'}</strong></span><span>Secondary bot AI Core access: <strong>${policy.registeredBotsReceiveAiCore ? 'Allowed' : 'Blocked'}</strong></span></div></article>
      ${auditHtml()}`;
  }

  async function load(force = false) {
    if (!force && state.payload) return state.payload;
    state.payload = await invoke('ai:connections-get', {});
    render();
    return state.payload;
  }

  function activate() {
    ensureNavigation();
    const view = ensureView();
    doc.querySelectorAll('.view').forEach((item) => item.classList.toggle('active', item === view));
    doc.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === 'ai-services'));
    const title = doc.getElementById('viewTitle');
    const subtitle = doc.getElementById('viewSubtitle');
    if (title) title.textContent = 'AI Services';
    if (subtitle) subtitle.textContent = 'Manage isolated D&D AI and Nexus AI Core connections.';
    load(true).catch((error) => toast(error.message || String(error)));
  }

  async function check(service) {
    if (state.busy) return;
    state.busy = true;
    render();
    try {
      state.payload = await invoke('ai:connections-check', { service });
      toast(service === 'all' ? 'Both AI connections checked.' : `${service === 'dnd' ? 'D&D AI' : 'Nexus AI Core'} checked.`);
    } finally {
      state.busy = false;
      render();
    }
  }

  async function saveDnd(form) {
    const endpoint = clean(form.elements.endpoint.value, 500);
    await invoke('dnd:co-dm-set-settings', { serviceEndpoint: endpoint });
    const serviceToken = String(form.elements.serviceToken.value || '').trim();
    if (serviceToken) await invoke('dnd:co-dm-set-service-token', { serviceToken });
    form.elements.serviceToken.value = '';
    state.payload = await invoke('ai:connections-check', { service: 'dnd' });
    toast('D&D AI connection saved.');
    render();
  }

  async function saveCore(form) {
    const result = await invoke('ai:core-set-settings', {
      enabled: Boolean(form.elements.enabled.checked),
      linkToPrimaryBot: Boolean(form.elements.linkToPrimaryBot.checked),
      endpoint: clean(form.elements.endpoint.value, 500)
    });
    const serviceToken = String(form.elements.serviceToken.value || '').trim();
    let restartRequired = Boolean(result.restartRequired);
    if (serviceToken) {
      const tokenResult = await invoke('ai:core-set-token', { serviceToken });
      restartRequired ||= Boolean(tokenResult.restartRequired);
    }
    form.elements.serviceToken.value = '';
    state.payload = await invoke('ai:connections-check', { service: 'core' });
    toast(restartRequired ? 'AI Core saved. Restart Nexus Bot to apply the bot link.' : 'AI Core connection saved.');
    render();
  }

  doc.addEventListener('click', (event) => {
    const nav = event.target.closest?.('[data-view="ai-services"]');
    if (nav) {
      event.preventDefault();
      event.stopImmediatePropagation();
      activate();
      return;
    }
    const action = event.target.closest?.('[data-ai-action]')?.dataset.aiAction;
    if (!action) return;
    event.preventDefault();
    const run = async () => {
      if (action === 'check-all') return check('all');
      if (action === 'check-dnd') return check('dnd');
      if (action === 'check-core') return check('core');
      if (action === 'remove-dnd-token') {
        await invoke('dnd:co-dm-set-service-token', { serviceToken: '' });
        state.payload = await invoke('ai:connections-get', {});
        toast('D&D AI token removed.');
        return render();
      }
      if (action === 'remove-core-token') {
        const result = await invoke('ai:core-set-token', { serviceToken: '' });
        state.payload = result.state;
        toast(result.restartRequired ? 'AI Core token removed. Restart Nexus Bot to apply.' : 'AI Core token removed.');
        return render();
      }
    };
    run().catch((error) => toast(error.message || String(error)));
  }, true);

  doc.addEventListener('submit', (event) => {
    if (event.target.id === 'dndAiConnectionForm') {
      event.preventDefault();
      saveDnd(event.target).catch((error) => toast(error.message || String(error)));
    }
    if (event.target.id === 'aiCoreConnectionForm') {
      event.preventDefault();
      saveCore(event.target).catch((error) => toast(error.message || String(error)));
    }
  });

  ensureNavigation();
  ensureView();
  state.installed = true;
  win.__khaosAiServices = { activate, load, state };
})(window);
