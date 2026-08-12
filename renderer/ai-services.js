'use strict';

(function installAiServices(win) {
  if (!win?.document || win.__khaosAiServices) return;
  const doc = win.document;
  const state = { payload: null, busy: false, installed: false };
  const invoke = (channel, payload) => win.khaos.invoke(channel, payload);
  const toast = (message) => typeof win.toast === 'function' ? win.toast(message) : console.info(message);
  const clean = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
      button.innerHTML = '<span>✦</span>AI Runtime';
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
      <div class="panel-heading"><div><span class="eyebrow">D&D Lorewarden and Co-DM</span><h3>Veyra</h3></div>${serviceStatus(service)}</div>
      <p>${escapeHtml(dnd.role || '')}</p>
      <div class="ai-service-boundary"><strong>Repository</strong><code>${escapeHtml(dnd.repository || '')}</code><strong>Consumers</strong><span>Desktop D&D workspace only</span></div>
      <div class="callout">Campaign context, Co-DM drafts, homebrew, maps, and AI Game Master sessions stay isolated here. Veyra's campaign context is never passed to Nexus Bot or Nexus Sentinel.</div>
      <form id="dndAiConnectionForm" class="ai-service-form">
        <label>Service endpoint<input name="endpoint" type="url" maxlength="500" value="${escapeHtml(settings.endpoint || 'http://127.0.0.1:8787')}"></label>
        <label>Optional service token<input name="serviceToken" type="password" autocomplete="off" maxlength="500" placeholder="${settings.hasServiceToken ? 'Stored — enter a replacement token' : 'Leave blank if local authentication is disabled'}"></label>
        <div class="form-actions"><button class="button" type="button" data-ai-action="check-dnd">Test Veyra</button><button class="button" type="button" data-ai-action="remove-dnd-token" ${settings.hasServiceToken ? '' : 'disabled'}>Remove Token</button><button class="button primary" type="submit">Save Veyra Connection</button></div>
      </form>
    </article>`;
  }

  function coreCard() {
    const core = state.payload?.core || {};
    const settings = core.settings || {};
    const service = core.service || {};
    const provider = service.providerStatus || {};
    const providerMode = settings.providerMode || 'deterministic-local';
    return `<article class="panel ai-service-card">
      <div class="panel-heading"><div><span class="eyebrow">System Health and Assistance AI</span><h3>Nexus Sentinel</h3></div>${serviceStatus(service)}</div>
      <p>${escapeHtml(core.role || '')}</p>
      <div class="ai-service-boundary"><strong>Repository</strong><code>${escapeHtml(core.repository || '')}</code><strong>Pinned snapshot</strong><code>${escapeHtml(core.snapshot || '')}</code></div>
      <div class="callout">Nexus Sentinel is advisory. It can return diagnostics, update intelligence, Discord-safe drafts, and maintenance proposals, but Khaos Nexus remains authoritative and performs every approved action.</div>
      <form id="aiCoreConnectionForm" class="ai-service-form">
        <label class="toggle-row"><span><strong>Enable Nexus Sentinel</strong><small>Allows desktop health and capability discovery.</small></span><input name="enabled" type="checkbox" ${settings.enabled ? 'checked' : ''}></label>
        <label class="toggle-row"><span><strong>Link to the primary Nexus Bot</strong><small>Enables the existing /nexus commands through the supervised desktop bridge. Registered secondary bots remain excluded.</small></span><input name="linkToPrimaryBot" type="checkbox" ${settings.linkToPrimaryBot ? 'checked' : ''}></label>
        <label>Service endpoint<input name="endpoint" type="url" maxlength="500" value="${escapeHtml(settings.endpoint || 'http://127.0.0.1:8790')}"></label>
        <label>Conversation provider<select name="providerMode">
          <option value="deterministic-local" ${providerMode === 'deterministic-local' ? 'selected' : ''}>Deterministic Local — $0 API cost</option>
          <option value="ollama-local" ${providerMode === 'ollama-local' ? 'selected' : ''}>Local LLM (Ollama) — $0 API cost</option>
        </select></label>
        <div class="callout"><strong>Local LLM mode does not use an OpenAI API key.</strong> It talks only to Ollama on this PC. Install Ollama and pull a local model separately, then enter that exact model name below. Your ChatGPT subscription is not used as a bot credential.</div>
        <label>Local Ollama model<input name="ollamaModel" type="text" maxlength="200" value="${escapeHtml(settings.ollamaModel || '')}" placeholder="Example: qwen3:4b"></label>
        <label>Local Ollama endpoint<input name="ollamaEndpoint" type="url" maxlength="500" value="${escapeHtml(settings.ollamaEndpoint || 'http://127.0.0.1:11434')}"></label>
        <label class="toggle-row"><span><strong>Fallback to Deterministic Local</strong><small>If Ollama is unavailable or times out, keep /nexus ask working without switching to a paid provider.</small></span><input name="fallbackToDeterministic" type="checkbox" ${settings.fallbackToDeterministic !== false ? 'checked' : ''}></label>
        <label>Optional service token<input name="serviceToken" type="password" autocomplete="off" maxlength="500" placeholder="${settings.hasServiceToken ? 'Stored — enter a replacement token' : 'Leave blank if local authentication is disabled'}"></label>
        <div class="ai-provider-summary"><span>Active provider</span><strong>${escapeHtml(provider.name || service.provider || 'Unknown')}</strong><span>Model</span><strong>${escapeHtml(provider.model || service.model || 'Not loaded')}</strong><span>Ready</span><strong>${provider.ready === false ? 'No' : service.reachable ? 'Yes' : 'Unknown'}</strong><span>Circuit</span><strong>${escapeHtml(provider.circuit?.state || 'Unknown')}</strong></div>
        <div class="ai-capabilities">${capabilityTags(service.capabilities || [])}</div>
        <div class="form-actions"><button class="button" type="button" data-ai-action="check-core">Test Nexus Sentinel</button><button class="button" type="button" data-ai-action="restart-runtime">Restart AI Runtime</button><button class="button" type="button" data-ai-action="remove-core-token" ${settings.hasServiceToken ? '' : 'disabled'}>Remove Token</button><button class="button primary" type="submit">Save Nexus Sentinel Settings</button></div>
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
    view.innerHTML = `<div class="section-intro inline"><div><h2>Khaos Nexus AI Runtime</h2><p>One supervised local host runs Veyra and Nexus Sentinel as isolated workers with separate memory, tools, credentials, endpoints, and authority.</p></div><button class="button" data-ai-action="check-all" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Checking…' : 'Test Both Agents'}</button></div>
      <div class="ai-service-policy"><span class="tag success">Shared runtime host</span><span class="tag success">Isolated agent workers</span><span class="tag success">Separate memory and tokens</span><span class="tag">No automatic execution</span></div>
      <div class="ai-services-grid">${dndCard()}${coreCard()}</div>
      <article class="panel ai-isolation-panel"><div class="panel-heading"><div><span class="eyebrow">Authority boundary</span><h3>What linking does not authorize</h3></div></div><div class="ai-boundary-grid"><span>Automatic Discord publication: <strong>${policy.automaticDiscordPublication ? 'Allowed' : 'Blocked'}</strong></span><span>Automatic server or scheduler execution: <strong>${policy.automaticExecution ? 'Allowed' : 'Blocked'}</strong></span><span>Nexus Sentinel D&D namespace: <strong>${policy.aiCoreRejectsDndNamespace ? 'Rejected' : 'Unconfirmed'}</strong></span><span>Secondary bot Nexus Sentinel access: <strong>${policy.registeredBotsReceiveAiCore ? 'Allowed' : 'Blocked'}</strong></span></div></article>
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
    if (title) title.textContent = 'AI Runtime';
    if (subtitle) subtitle.textContent = 'Manage Veyra and Nexus Sentinel inside the unified Khaos Nexus AI Runtime.';
    load(true).catch((error) => toast(error.message || String(error)));
  }

  async function check(service) {
    if (state.busy) return;
    state.busy = true;
    render();
    try {
      state.payload = await invoke('ai:connections-check', { service });
      toast(service === 'all' ? 'Both AI agents checked.' : `${service === 'dnd' ? 'Veyra' : 'Nexus Sentinel'} checked.`);
    } finally {
      state.busy = false;
      render();
    }
  }

  async function waitForSentinelReady(timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const runtime = await invoke('ai:runtimes-status', {});
      const services = Array.isArray(runtime?.services) ? runtime.services : Array.isArray(runtime?.agents) ? runtime.agents : [];
      const core = services.find((item) => item?.key === 'core' || item?.id === 'ai-core');
      if (core?.status === 'ready') return runtime;
      if (core?.status === 'failed') throw new Error(core.error || 'Nexus Sentinel failed while restarting.');
      await sleep(300);
    }
    throw new Error('Nexus Sentinel did not become ready before the restart timeout.');
  }

  async function restartRuntime() {
    if (state.busy) return;
    state.busy = true;
    render();
    try {
      // A full host cycle is intentional: provider settings are inherited when the
      // supervised runtime host starts, so restarting workers alone would retain stale settings.
      await invoke('ai:runtimes-stop', { service: 'all' });
      await invoke('ai:runtimes-start', { service: 'all' });
      await waitForSentinelReady();
      state.payload = await invoke('ai:connections-check', { service: 'core' });
      toast('AI Runtime restarted. The saved Nexus Sentinel provider is now active.');
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
    toast('Veyra connection saved.');
    render();
  }

  async function saveCore(form) {
    const result = await invoke('ai:core-set-settings', {
      enabled: Boolean(form.elements.enabled.checked),
      linkToPrimaryBot: Boolean(form.elements.linkToPrimaryBot.checked),
      endpoint: clean(form.elements.endpoint.value, 500),
      providerMode: clean(form.elements.providerMode.value, 50),
      ollamaModel: clean(form.elements.ollamaModel.value, 200),
      ollamaEndpoint: clean(form.elements.ollamaEndpoint.value, 500),
      fallbackToDeterministic: Boolean(form.elements.fallbackToDeterministic.checked)
    });
    const serviceToken = String(form.elements.serviceToken.value || '').trim();
    let restartRequired = Boolean(result.restartRequired);
    if (serviceToken) {
      const tokenResult = await invoke('ai:core-set-token', { serviceToken });
      restartRequired ||= Boolean(tokenResult.restartRequired);
    }
    form.elements.serviceToken.value = '';
    state.payload = await invoke('ai:connections-get', {});
    toast(restartRequired
      ? 'Nexus Sentinel settings saved. Restart the AI Runtime to apply the provider; restart Nexus Bot too if its link settings changed.'
      : 'Nexus Sentinel settings saved. Use Restart AI Runtime to apply provider changes.');
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
      if (action === 'restart-runtime') return restartRuntime();
      if (action === 'remove-dnd-token') {
        await invoke('dnd:co-dm-set-service-token', { serviceToken: '' });
        state.payload = await invoke('ai:connections-get', {});
        toast('Veyra token removed.');
        return render();
      }
      if (action === 'remove-core-token') {
        const result = await invoke('ai:core-set-token', { serviceToken: '' });
        state.payload = result.state;
        toast(result.restartRequired ? 'Nexus Sentinel token removed. Restart Nexus Bot to apply.' : 'Nexus Sentinel token removed.');
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
