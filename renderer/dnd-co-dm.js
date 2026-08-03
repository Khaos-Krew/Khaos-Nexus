'use strict';

(function bootstrapDndCoDm(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) api.install(root);
})(typeof window !== 'undefined' ? window : null, function dndCoDmFactory() {
  const clean = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const bool = (form, name) => Boolean(form.elements[name]?.checked);

  function contextOptions(form) {
    return {
      includeGmNotes: bool(form, 'includeGmNotes'),
      includeApprovedHomebrew: bool(form, 'includeApprovedHomebrew'),
      includePublicRolls: bool(form, 'includePublicRolls'),
      includeSessionRecaps: bool(form, 'includeSessionRecaps'),
      includeEncounterDetails: bool(form, 'includeEncounterDetails'),
      includeCharacterDetails: bool(form, 'includeCharacterDetails')
    };
  }

  function install(win) {
    if (!win?.document || win.__khaosDndCoDm) return win?.__khaosDndCoDm || null;
    const doc = win.document;
    const state = {
      active: false,
      busy: false,
      payload: null,
      context: null,
      observer: null,
      attachTimer: null,
      renderScheduled: false
    };
    const invoke = (channel, payload) => win.khaos.invoke(channel, payload);
    const notify = (message) => typeof win.toast === 'function' ? win.toast(message) : console.info(message);
    const selectedCampaignId = () => clean(doc.getElementById('dndCampaignSelect')?.value || state.payload?.selectedCampaignId, 100);

    function scheduleRender() {
      if (state.renderScheduled) return;
      state.renderScheduled = true;
      win.setTimeout(() => {
        state.renderScheduled = false;
        enhance();
      }, 0);
    }

    function workflowOptions() {
      return Object.entries(state.payload?.workflows || {}).map(([id, item]) => `<option value="${escapeHtml(id)}">${escapeHtml(item.label || id)}</option>`).join('');
    }

    function ensureTab(rootElement) {
      const tabs = rootElement.querySelector('.dnd-tabs');
      if (!tabs) return null;
      let button = tabs.querySelector('[data-dnd-co-dm-tab="co-dm"]');
      if (!button) {
        button = doc.createElement('button');
        button.type = 'button';
        button.className = 'dnd-tab';
        button.dataset.dndCoDmTab = 'co-dm';
        button.textContent = 'Co-DM';
        tabs.appendChild(button);
      }
      button.classList.toggle('active', state.active);
      return button;
    }

    function readinessHtml() {
      const readiness = state.payload?.readiness || { checks: [], readyCount: 0, totalCount: 0 };
      return `<article class="panel dnd-co-dm-readiness"><div class="panel-heading"><div><span class="eyebrow">Campaign readiness</span><h3>${readiness.readyCount}/${readiness.totalCount} ready</h3></div><span class="tag ${readiness.ready ? 'success' : 'warning'}">${readiness.ready ? 'Ready' : 'Needs setup'}</span></div><div class="dnd-co-dm-checks">${(readiness.checks || []).map((item) => `<div class="dnd-co-dm-check ${item.ready ? 'ready' : 'missing'}"><span aria-hidden="true">${item.ready ? '✓' : '!'}</span><div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></div></div>`).join('')}</div></article>`;
    }

    function serviceSummary() {
      const service = state.payload?.service || {};
      if (!service.reachable) return escapeHtml(service.error || 'Connection has not been checked.');
      const parts = [service.service, service.version && `v${service.version}`, service.provider, service.model].filter(Boolean);
      const mode = service.dedicatedDrafts ? 'Dedicated draft mode' : service.legacyCampaignTurns ? 'Campaign-turn compatibility mode' : 'Unsupported capability';
      return `${escapeHtml(parts.join(' · ') || 'Khaos Nexus AI')}<br><small>${escapeHtml(mode)}</small>`;
    }

    function settingsHtml() {
      const settings = state.payload?.settings || {};
      const service = state.payload?.service || {};
      const legacyWarning = service.reachable && service.legacyCampaignTurns && !service.dedicatedDrafts
        ? '<div class="callout warning"><strong>Compatibility storage:</strong> The current AI MVP stores a synchronized campaign copy and generated turn history in the Khaos Nexus AI service. Each generation requires confirmation until the dedicated stateless draft endpoint is available.</div>'
        : '';
      return `<article class="panel dnd-co-dm-settings"><div class="panel-heading"><div><span class="eyebrow">Separate AI runtime</span><h3>Khaos Nexus AI Service</h3></div><span class="tag ${service.reachable ? 'success' : 'warning'}">${service.reachable ? 'Connected' : 'Not connected'}</span></div><div class="callout">AI providers and provider credentials are owned by the separate <strong>Khaos-Nexus-AI</strong> service. The desktop stores no OpenAI key and sends campaign context only after an explicit generation action.</div>${legacyWarning}<div class="dnd-co-dm-service-summary">${serviceSummary()}</div><form id="dndCoDmSettingsForm" class="dnd-co-dm-settings-form"><label>Service endpoint<input name="serviceEndpoint" type="url" maxlength="500" value="${escapeHtml(settings.serviceEndpoint || 'http://127.0.0.1:8787')}" placeholder="http://127.0.0.1:8787"></label><label>Optional service token<input name="serviceToken" type="password" autocomplete="off" maxlength="500" placeholder="${settings.hasServiceToken ? 'Stored — enter a new token to replace' : 'Leave blank when local service authentication is disabled'}"></label><div class="form-grid three"><label>Preferred model alias<input name="model" maxlength="120" value="${escapeHtml(settings.model || 'default')}"><small>The current MVP chooses its model server-side.</small></label><label>Maximum draft characters<input name="maxOutputCharacters" type="number" min="1000" max="40000" value="${Number(settings.maxOutputCharacters || 40000)}"></label><label>Context character limit<input name="contextCharacterLimit" type="number" min="8000" max="100000" value="${Number(settings.contextCharacterLimit || 48000)}"></label></div><div class="form-grid"><label>Local draft history limit<input name="historyLimit" type="number" min="5" max="100" value="${Number(settings.historyLimit || 40)}"></label><div class="form-actions dnd-co-dm-key-actions"><button class="button" type="button" data-dnd-co-dm-action="service-check">Test Connection</button><button class="button" type="button" data-dnd-co-dm-action="remove-token" ${settings.hasServiceToken ? '' : 'disabled'}>Remove Token</button><button class="button primary" type="submit">Save Settings</button></div></div></form></article>`;
    }

    function contextPreviewHtml() {
      if (!state.context) return '<div class="callout">Preview shows exactly which local sections will be included before a request is sent to Khaos Nexus AI.</div>';
      return `<article class="dnd-co-dm-context-preview"><div class="panel-heading"><div><span class="eyebrow">Context preview</span><h4>${state.context.characters.toLocaleString()} / ${state.context.characterLimit.toLocaleString()} characters</h4></div></div><div class="dnd-co-dm-context-sections">${(state.context.sections || []).map((item) => `<span class="tag ${item.reason === 'included' ? 'success' : item.reason.startsWith('truncated') ? 'warning' : ''}" title="${escapeHtml(item.reason)}">${escapeHtml(item.label)} · ${Number(item.count || 0)}</span>`).join('')}</div><details><summary>Review redacted context text</summary><pre>${escapeHtml(state.context.preview || '')}</pre></details></article>`;
    }

    function generatorHtml() {
      const service = state.payload?.service || {};
      const supported = service.reachable && (service.dedicatedDrafts || service.legacyCampaignTurns);
      return `<article class="panel dnd-co-dm-generator"><div class="panel-heading"><div><span class="eyebrow">Explicit draft generation</span><h3>Create a Co-DM Draft</h3></div><span class="tag">No autonomous actions</span></div><form id="dndCoDmGenerateForm"><label>Workflow<select name="workflow">${workflowOptions()}</select></label><label>What should the Co-DM prepare?<textarea name="prompt" rows="6" maxlength="8000" placeholder="Prepare the next session around the unresolved faction conflict, with three flexible scenes and one optional encounter." required></textarea></label><fieldset><legend>Campaign context</legend><div class="dnd-co-dm-options"><label class="toggle-row"><span><strong>Character details</strong><small>Names, classes, levels, HP, conditions, and notes.</small></span><input name="includeCharacterDetails" type="checkbox" checked></label><label class="toggle-row"><span><strong>Encounter details</strong><small>Current campaign encounter summaries.</small></span><input name="includeEncounterDetails" type="checkbox" checked></label><label class="toggle-row"><span><strong>Session recaps</strong><small>Recent session recap drafts and summaries.</small></span><input name="includeSessionRecaps" type="checkbox" checked></label><label class="toggle-row"><span><strong>GM notes and secrets</strong><small>Explicitly include protected campaign notes.</small></span><input name="includeGmNotes" type="checkbox"></label><label class="toggle-row"><span><strong>Approved homebrew text</strong><small>Include locally approved homebrew bodies.</small></span><input name="includeApprovedHomebrew" type="checkbox"></label><label class="toggle-row"><span><strong>Recent public rolls</strong><small>Blind and DM-only rolls remain excluded.</small></span><input name="includePublicRolls" type="checkbox"></label></div></fieldset>${contextPreviewHtml()}<div class="form-actions"><button class="button" type="button" data-dnd-co-dm-action="preview-context">Preview Context</button><button class="button primary" type="submit" ${state.busy || !supported ? 'disabled' : ''}>${state.busy ? 'Generating…' : supported ? 'Generate Draft' : 'Connect AI Service First'}</button></div></form></article>`;
    }

    function draftCard(draft) {
      const workflow = state.payload?.workflows?.[draft.workflow]?.label || draft.workflow;
      const runtime = [draft.provider, draft.model].filter(Boolean).join(' / ') || 'Khaos Nexus AI';
      return `<article class="panel dnd-co-dm-draft" data-draft-id="${escapeHtml(draft.id)}"><div class="panel-heading"><div><span class="eyebrow">${escapeHtml(workflow)} · ${escapeHtml(runtime)}</span><h3>${escapeHtml(draft.title)}</h3><small>${escapeHtml(draft.updatedAt || draft.createdAt || '')}${draft.serviceVersion ? ` · AI v${escapeHtml(draft.serviceVersion)}` : ''}${draft.pinned ? ' · Pinned' : ''}</small></div><div class="server-actions"><button class="button" data-dnd-co-dm-action="copy-draft" data-draft-id="${escapeHtml(draft.id)}">Copy</button><button class="button" data-dnd-co-dm-action="rename-draft" data-draft-id="${escapeHtml(draft.id)}">Rename</button><button class="button" data-dnd-co-dm-action="pin-draft" data-draft-id="${escapeHtml(draft.id)}">${draft.pinned ? 'Unpin' : 'Pin'}</button><button class="button danger" data-dnd-co-dm-action="delete-draft" data-draft-id="${escapeHtml(draft.id)}">Delete</button></div></div><pre class="dnd-co-dm-draft-text">${escapeHtml(draft.content)}</pre><div class="form-actions"><button class="button" data-dnd-co-dm-action="apply-recap" data-draft-id="${escapeHtml(draft.id)}">Copy to Session Recap</button><button class="button" data-dnd-co-dm-action="apply-notes" data-draft-id="${escapeHtml(draft.id)}">Copy to Campaign Notes</button></div></article>`;
    }

    function draftsHtml() {
      const drafts = state.payload?.drafts || [];
      return `<section class="dnd-co-dm-history"><div class="panel-heading"><div><span class="eyebrow">Protected local history</span><h2>Co-DM Drafts</h2></div><span class="tag">${drafts.length} saved</span></div>${drafts.length ? drafts.map(draftCard).join('') : '<article class="panel empty-state"><h3>No Co-DM drafts yet</h3><p>Connect Khaos Nexus AI, preview the campaign context, then explicitly generate a session, encounter, NPC, world, recap, or rules draft.</p></article>'}</section>`;
    }

    function render(rootElement) {
      if (!state.active) return;
      const panel = rootElement.querySelector('.dnd-tab-panel');
      if (!panel) return;
      rootElement.querySelectorAll('[data-dnd-tab],[data-dnd-owner-tab],[data-dnd-world-tab],[data-dnd-map-tab]').forEach((item) => item.classList.remove('active'));
      ensureTab(rootElement)?.classList.add('active');
      panel.innerHTML = `<div class="dnd-co-dm"><div class="dnd-co-dm-hero"><div><span class="eyebrow">D&D private workspace</span><h2>AI Co-DM</h2><p>Build redacted campaign context, send explicit requests to the separate Khaos Nexus AI runtime, and review every result before copying it into campaign records.</p></div><div class="dnd-co-dm-policy"><span class="tag success">Explicit only</span><span class="tag">Separate AI service</span><span class="tag">No Discord posting</span><span class="tag">No automatic campaign changes</span></div></div><div class="dnd-co-dm-grid">${readinessHtml()}${settingsHtml()}</div>${generatorHtml()}${draftsHtml()}</div>`;
    }

    async function load(force = false) {
      if (!force && state.payload) return state.payload;
      state.payload = await invoke('dnd:co-dm-get', { campaignId: selectedCampaignId() });
      scheduleRender();
      return state.payload;
    }

    async function refresh() {
      await load(true);
      scheduleRender();
    }

    async function checkService() {
      const result = await invoke('dnd:co-dm-service-check', { campaignId: selectedCampaignId() });
      state.payload = result.state;
      scheduleRender();
      return result.service;
    }

    function enhance() {
      const rootElement = doc.getElementById('view-dnd');
      if (!rootElement) return;
      ensureTab(rootElement);
      render(rootElement);
    }

    async function saveSettings(form) {
      const serviceEndpoint = String(form.elements.serviceEndpoint.value || '').trim();
      const model = clean(form.elements.model.value, 120);
      const maxOutputCharacters = Number(form.elements.maxOutputCharacters.value);
      const contextCharacterLimit = Number(form.elements.contextCharacterLimit.value);
      const historyLimit = Number(form.elements.historyLimit.value);
      await invoke('dnd:co-dm-set-settings', { campaignId: selectedCampaignId(), serviceEndpoint, model, maxOutputCharacters, contextCharacterLimit, historyLimit });
      const serviceToken = String(form.elements.serviceToken.value || '').trim();
      if (serviceToken) await invoke('dnd:co-dm-set-service-token', { campaignId: selectedCampaignId(), serviceToken });
      form.elements.serviceToken.value = '';
      notify('Co-DM service settings saved.');
      await checkService();
    }

    async function preview(form) {
      state.context = await invoke('dnd:co-dm-preview-context', { campaignId: selectedCampaignId(), contextOptions: contextOptions(form) });
      scheduleRender();
    }

    async function generate(form) {
      if (state.busy) return;
      const service = state.payload?.service || {};
      let allowLegacyCampaignPersistence = false;
      if (service.legacyCampaignTurns && !service.dedicatedDrafts) {
        allowLegacyCampaignPersistence = win.confirm('The current Khaos Nexus AI compatibility mode stores a synchronized campaign copy and generated turn history inside the AI service. Continue with this generation?');
        if (!allowLegacyCampaignPersistence) return;
      }
      state.busy = true;
      scheduleRender();
      try {
        const result = await invoke('dnd:co-dm-generate', {
          campaignId: selectedCampaignId(),
          workflow: form.elements.workflow.value,
          prompt: form.elements.prompt.value,
          contextOptions: contextOptions(form),
          allowLegacyCampaignPersistence
        });
        state.payload = result.state;
        state.context = result.context;
        notify('Co-DM draft generated by Khaos Nexus AI and saved locally.');
      } finally {
        state.busy = false;
        scheduleRender();
      }
    }

    function draftById(draftId) {
      return (state.payload?.drafts || []).find((item) => item.id === draftId);
    }

    async function handleAction(button) {
      const action = button.dataset.dndCoDmAction;
      const draftId = button.dataset.draftId;
      const draft = draftById(draftId);
      if (action === 'preview-context') return preview(doc.getElementById('dndCoDmGenerateForm'));
      if (action === 'service-check') {
        const service = await checkService();
        notify(service.reachable ? 'Khaos Nexus AI connection succeeded.' : service.error || 'Khaos Nexus AI is unavailable.');
        return;
      }
      if (action === 'remove-token') {
        if (!win.confirm('Remove the protected Khaos Nexus AI service token from this desktop installation?')) return;
        await invoke('dnd:co-dm-set-service-token', { campaignId: selectedCampaignId(), serviceToken: '' });
        notify('Khaos Nexus AI service token removed.');
        return refresh();
      }
      if (!draft) return;
      if (action === 'copy-draft') {
        await win.navigator.clipboard.writeText(draft.content);
        return notify('Co-DM draft copied.');
      }
      if (action === 'rename-draft') {
        const title = win.prompt('Rename this Co-DM draft:', draft.title);
        if (!title?.trim()) return;
        await invoke('dnd:co-dm-draft-save', { ...draft, title: title.trim() });
        notify('Draft renamed.');
        return refresh();
      }
      if (action === 'pin-draft') {
        await invoke('dnd:co-dm-draft-save', { ...draft, pinned: !draft.pinned });
        return refresh();
      }
      if (action === 'delete-draft') {
        if (!win.confirm(`Delete “${draft.title}”?`)) return;
        await invoke('dnd:co-dm-draft-delete', { draftId, campaignId: selectedCampaignId() });
        notify('Co-DM draft deleted.');
        return refresh();
      }
      if (action === 'apply-recap' || action === 'apply-notes') {
        const destination = action === 'apply-recap' ? 'session-recap' : 'campaign-notes';
        if (!win.confirm(`Copy “${draft.title}” into ${destination === 'session-recap' ? 'the current or latest session recap' : 'campaign Co-DM notes'}? Existing text will be replaced.`)) return;
        await invoke('dnd:co-dm-draft-apply', { draftId, campaignId: selectedCampaignId(), destination, mode: 'replace', confirmed: true });
        notify('Co-DM draft copied into the campaign record.');
        return refresh();
      }
    }

    function attach() {
      const rootElement = doc.getElementById('view-dnd');
      if (!rootElement || !win.khaos?.invoke) {
        state.attachTimer = win.setTimeout(attach, 50);
        return;
      }
      ensureTab(rootElement);
      state.observer = new win.MutationObserver(() => scheduleRender());
      state.observer.observe(rootElement, { childList: true, subtree: true });
      doc.addEventListener('click', async (event) => {
        const tab = event.target.closest?.('[data-dnd-co-dm-tab="co-dm"]');
        if (tab) {
          event.preventDefault();
          event.stopImmediatePropagation();
          state.active = true;
          try {
            await refresh();
            if (!state.payload?.service?.reachable && /not been checked/i.test(state.payload?.service?.error || '')) await checkService();
          } catch (error) { notify(error.message || String(error)); }
          return;
        }
        if (event.target.closest?.('#view-dnd .dnd-tabs button:not([data-dnd-co-dm-tab])')) state.active = false;
        const button = event.target.closest?.('[data-dnd-co-dm-action]');
        if (!button) return;
        event.preventDefault();
        try { await handleAction(button); } catch (error) { notify(error.message || String(error)); }
      }, true);
      doc.addEventListener('submit', async (event) => {
        if (event.target.id === 'dndCoDmSettingsForm') {
          event.preventDefault();
          try { await saveSettings(event.target); } catch (error) { notify(error.message || String(error)); }
        }
        if (event.target.id === 'dndCoDmGenerateForm') {
          event.preventDefault();
          try { await generate(event.target); } catch (error) { notify(error.message || String(error)); }
        }
      }, true);
      doc.addEventListener('change', (event) => {
        if (event.target.id === 'dndCampaignSelect' && state.active) {
          state.context = null;
          refresh().catch((error) => notify(error.message || String(error)));
        }
      }, true);
      win.__khaosDndCoDm = {
        state,
        refresh,
        disconnect() {
          state.observer?.disconnect();
          if (state.attachTimer) win.clearTimeout(state.attachTimer);
          delete win.__khaosDndCoDm;
        }
      };
    }

    attach();
    return win.__khaosDndCoDm;
  }

  return { install, contextOptions };
});
