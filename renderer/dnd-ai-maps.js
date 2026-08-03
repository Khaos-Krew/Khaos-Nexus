'use strict';

(function bootstrapDndAiMaps(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) api.install(root);
})(typeof window !== 'undefined' ? window : null, function dndAiMapsFactory() {
  const MAP_TYPES = ['encounter', 'dungeon', 'settlement', 'region', 'travel'];
  const GRID_TYPES = ['square', 'hex', 'none'];
  const DENSITIES = ['sparse', 'standard', 'dense'];
  const THEMES = ['parchment', 'blueprint', 'dark', 'minimal'];
  const clean = (value, maximum = 4000) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, maximum);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const lines = (value) => String(value || '').split(/[\r\n]+/).map((item) => item.trim()).filter(Boolean);
  const optionList = (values, selected) => values.map((value) => `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(value.replace(/-/g, ' '))}</option>`).join('');

  function svgDataUrl(svg) {
    const bytes = new TextEncoder().encode(String(svg || ''));
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return `data:image/svg+xml;base64,${btoa(binary)}`;
  }

  function defaultDraft(campaignId = '') {
    return {
      campaignId,
      mapType: 'dungeon',
      prompt: '',
      seed: `khaos-map-${Date.now()}`,
      width: 36,
      height: 28,
      gridType: 'square',
      scale: '5 feet per cell',
      density: 'standard',
      theme: 'dark',
      biomes: '',
      features: '',
      constraints: ''
    };
  }

  function collectForm(form, campaignId) {
    const data = new FormData(form);
    return {
      campaignId,
      mapType: clean(data.get('mapType'), 40),
      prompt: clean(data.get('prompt'), 4000),
      seed: clean(data.get('seed'), 128),
      width: Number(data.get('width')),
      height: Number(data.get('height')),
      gridType: clean(data.get('gridType'), 20),
      scale: clean(data.get('scale'), 80),
      density: clean(data.get('density'), 20),
      theme: clean(data.get('theme'), 20),
      biomes: lines(data.get('biomes')),
      features: lines(data.get('features')),
      constraints: lines(data.get('constraints'))
    };
  }

  function install(win) {
    if (!win?.document || win.__khaosDndAiMaps) return win?.__khaosDndAiMaps || null;
    const doc = win.document;
    const state = {
      payload: null,
      campaignId: '',
      draft: defaultDraft(),
      preview: null,
      detail: null,
      loading: false,
      scheduled: false,
      observer: null
    };
    const invoke = (channel, payload) => win.khaos.invoke(channel, payload);
    const notify = (message) => typeof win.toast === 'function' ? win.toast(message) : undefined;
    const selectedCampaignId = () => clean(doc.getElementById('dndCampaignSelect')?.value, 100);

    function schedule() {
      if (state.scheduled) return;
      state.scheduled = true;
      win.requestAnimationFrame(() => {
        state.scheduled = false;
        enhance();
      });
    }

    function setBusy(value) {
      state.loading = Boolean(value);
      schedule();
    }

    async function refresh(force = false) {
      const campaignId = selectedCampaignId();
      if (!campaignId) return;
      if (!force && state.payload && state.campaignId === campaignId) return;
      state.campaignId = campaignId;
      state.draft = { ...defaultDraft(campaignId), ...(state.draft.campaignId === campaignId ? state.draft : {}) };
      state.preview = null;
      state.detail = null;
      state.payload = await invoke('dnd:ai-maps-get', { campaignId });
      schedule();
    }

    function proposalCard(proposal) {
      const review = proposal.originality?.status === 'needs-review';
      return `<article class="dnd-ai-map-proposal-card">
        <div>
          <span class="eyebrow">${escapeHtml(proposal.mapType)} · seed ${escapeHtml(proposal.seed)}</span>
          <h4>${escapeHtml(proposal.title)}</h4>
          <p>${escapeHtml(proposal.summary)}</p>
          <div class="dnd-ai-map-tags">
            <span class="tag">${proposal.grid?.width || 0}×${proposal.grid?.height || 0} ${escapeHtml(proposal.grid?.type || '')}</span>
            <span class="tag">${proposal.zones || 0} zones</span>
            <span class="tag">${proposal.visiblePoints || 0} public POIs</span>
            <span class="tag">${proposal.secretPoints || 0} secret POIs</span>
            ${review ? '<span class="tag warning">Originality review</span>' : '<span class="tag">Original</span>'}
          </div>
        </div>
        <div class="server-actions">
          <button class="button" data-dnd-ai-map-action="review" data-proposal-id="${escapeHtml(proposal.id)}">Review</button>
          <button class="button danger" data-dnd-ai-map-action="delete" data-proposal-id="${escapeHtml(proposal.id)}">Delete</button>
        </div>
      </article>`;
    }

    function previewPanel() {
      if (!state.preview) return '<div class="dnd-ai-map-preview empty-state"><p>Preview the exact normalized request before anything is sent to Khaos Nexus AI.</p></div>';
      const request = state.preview.request;
      return `<div class="dnd-ai-map-preview">
        <div class="panel-heading"><div><span class="eyebrow">Exact outgoing request</span><h4>Ready for confirmation</h4></div><span class="tag">${state.preview.metrics.requestBytes} bytes</span></div>
        <dl class="dnd-ai-map-request-summary">
          <div><dt>Type</dt><dd>${escapeHtml(request.mapType)}</dd></div>
          <div><dt>Seed</dt><dd>${escapeHtml(request.seed)}</dd></div>
          <div><dt>Grid</dt><dd>${request.width}×${request.height} ${escapeHtml(request.gridType)}</dd></div>
          <div><dt>Scale</dt><dd>${escapeHtml(request.scale)}</dd></div>
          <div><dt>Density</dt><dd>${escapeHtml(request.density)}</dd></div>
          <div><dt>Theme</dt><dd>${escapeHtml(request.theme)}</dd></div>
        </dl>
        <details><summary>Review complete JSON request</summary><pre>${escapeHtml(JSON.stringify(request, null, 2))}</pre></details>
        <div class="callout warning">No current map file, screenshot, protected asset, campaign secret, Discord data, or GM note is included. Generation creates a private proposal only.</div>
        <button class="button primary" data-dnd-ai-map-action="generate" ${state.loading ? 'disabled' : ''}>${state.loading ? 'Generating…' : 'Confirm and Generate Private Proposal'}</button>
      </div>`;
    }

    function detailPanel() {
      const proposal = state.detail;
      if (!proposal) return '';
      const result = proposal.result || {};
      const needsReview = result.originality?.status === 'needs-review';
      const gmNotes = Array.isArray(result.gmNotes) ? result.gmNotes : [];
      return `<article class="panel dnd-ai-map-review">
        <div class="panel-heading">
          <div><span class="eyebrow">Private AI map proposal</span><h3>${escapeHtml(result.title)}</h3><p>${escapeHtml(result.summary)}</p></div>
          <button class="button" data-dnd-ai-map-action="close-review">Close</button>
        </div>
        <div class="dnd-ai-map-preview-grid">
          <section><h4>Player-safe preview</h4><img src="${svgDataUrl(proposal.playerSvg)}" alt="Player-safe preview of ${escapeHtml(result.title)}"></section>
          <section><h4>GM preview</h4><img src="${svgDataUrl(proposal.gmSvg)}" alt="GM preview of ${escapeHtml(result.title)}"></section>
        </div>
        <div class="dnd-ai-map-tags">
          <span class="tag">${result.grid?.width || 0}×${result.grid?.height || 0} ${escapeHtml(result.grid?.type || '')}</span>
          <span class="tag">${result.zones?.length || 0} zones</span>
          <span class="tag">${result.connections?.length || 0} connections</span>
          <span class="tag">${result.encounters?.length || 0} encounters</span>
          <span class="tag">${result.hazards?.length || 0} hazards</span>
        </div>
        <details open><summary>Structured zones and points</summary><pre>${escapeHtml(JSON.stringify({ zones: result.zones || [], connections: result.connections || [], pointsOfInterest: result.pointsOfInterest || [], exits: result.exits || [] }, null, 2))}</pre></details>
        <details><summary>Encounter and hazard suggestions</summary><pre>${escapeHtml(JSON.stringify({ encounters: result.encounters || [], hazards: result.hazards || [] }, null, 2))}</pre></details>
        <details ${gmNotes.length ? '' : 'hidden'}><summary>GM notes (${gmNotes.length})</summary><ul>${gmNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul></details>
        ${needsReview ? `<div class="callout warning"><strong>Originality review required.</strong><ul>${(result.originality.concerns || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul><label class="toggle-row"><span>I reviewed and accept these originality concerns before import.</span><input type="checkbox" id="dndAiMapOriginalityAck"></label></div>` : '<div class="callout">The service marked this proposal original. Review it before importing.</div>'}
        <div class="callout">Import creates a new protected local SVG from validated structured data. It starts <strong>inactive</strong> and <strong>GM hidden</strong>. It does not replace, reveal, or activate an existing map.</div>
        <div class="form-actions"><button class="button primary" data-dnd-ai-map-action="import" data-proposal-id="${escapeHtml(proposal.id)}" ${state.loading ? 'disabled' : ''}>Import as Hidden Campaign Map</button></div>
      </article>`;
    }

    function studioHtml() {
      const draft = state.draft;
      const proposals = state.payload?.proposals || [];
      return `<article class="panel dnd-ai-map-studio" data-dnd-ai-map-studio>
        <div class="panel-heading">
          <div><span class="eyebrow">Separate Khaos Nexus AI runtime</span><h3>AI Map Studio</h3><p>Create original structured map proposals, then review and import them explicitly.</p></div>
          <div class="dnd-ai-map-service"><span class="tag">${escapeHtml(state.payload?.service?.endpoint || 'Not loaded')}</span><button class="button" data-dnd-ai-map-action="refresh">Refresh</button></div>
        </div>
        <div class="callout">Existing uploaded and locally generated maps remain unchanged. The AI service receives only the form below—never an existing map image, scan, screenshot, protected asset, or campaign map file.</div>
        <div class="dnd-ai-map-columns">
          <form class="dnd-ai-map-form" id="dndAiMapForm" novalidate>
            <div class="form-grid three">
              <label>Map type<select name="mapType">${optionList(MAP_TYPES, draft.mapType)}</select></label>
              <label>Grid<select name="gridType">${optionList(GRID_TYPES, draft.gridType)}</select></label>
              <label>Density<select name="density">${optionList(DENSITIES, draft.density)}</select></label>
            </div>
            <label>Original map concept<textarea name="prompt" maxlength="4000" rows="5" required placeholder="Describe terrain, routes, encounter goals, atmosphere, and a new original layout.">${escapeHtml(draft.prompt)}</textarea></label>
            <div class="form-grid three">
              <label>Seed<input name="seed" maxlength="128" value="${escapeHtml(draft.seed)}"></label>
              <label>Width (cells)<input name="width" type="number" min="12" max="80" value="${draft.width}"></label>
              <label>Height (cells)<input name="height" type="number" min="12" max="80" value="${draft.height}"></label>
            </div>
            <div class="form-grid">
              <label>Scale<input name="scale" maxlength="80" value="${escapeHtml(draft.scale)}"></label>
              <label>Theme<select name="theme">${optionList(THEMES, draft.theme)}</select></label>
            </div>
            <div class="form-grid three">
              <label>Biomes <small>one per line</small><textarea name="biomes" rows="4" maxlength="1200">${escapeHtml(Array.isArray(draft.biomes) ? draft.biomes.join('\n') : draft.biomes)}</textarea></label>
              <label>Desired features <small>one per line</small><textarea name="features" rows="4" maxlength="7200">${escapeHtml(Array.isArray(draft.features) ? draft.features.join('\n') : draft.features)}</textarea></label>
              <label>Constraints <small>one per line</small><textarea name="constraints" rows="4" maxlength="8000">${escapeHtml(Array.isArray(draft.constraints) ? draft.constraints.join('\n') : draft.constraints)}</textarea></label>
            </div>
            <div class="form-actions"><button class="button primary" type="button" data-dnd-ai-map-action="preview" ${state.loading ? 'disabled' : ''}>Preview Exact Request</button></div>
          </form>
          ${previewPanel()}
        </div>
        <div class="panel-heading"><div><span class="eyebrow">Private review queue</span><h4>Generated proposals</h4></div><span class="tag">${proposals.length}</span></div>
        <div class="dnd-ai-map-proposals">${proposals.length ? proposals.map(proposalCard).join('') : '<div class="empty-state"><p>No private AI map proposals for this campaign.</p></div>'}</div>
      </article>${detailPanel()}`;
    }

    function enhance() {
      const root = doc.getElementById('view-dnd');
      const mapsView = root?.querySelector('.dnd-live-maps');
      if (!root || !mapsView) return;
      const campaignId = selectedCampaignId();
      if (campaignId && (state.campaignId !== campaignId || !state.payload)) refresh().catch((error) => notify(error.message || String(error)));
      if (!state.payload || state.campaignId !== campaignId) return;
      const existing = mapsView.querySelector('[data-dnd-ai-map-studio]');
      const review = mapsView.querySelector('.dnd-ai-map-review');
      const html = studioHtml();
      const holder = doc.createElement('div');
      holder.className = 'dnd-ai-map-extension';
      holder.innerHTML = html;
      if (existing) {
        const extension = existing.closest('.dnd-ai-map-extension');
        if (extension) extension.replaceWith(holder);
      } else {
        const library = mapsView.querySelector('.dnd-map-library');
        if (library) library.insertAdjacentElement('afterend', holder);
        else mapsView.prepend(holder);
      }
      if (review && !state.detail) review.remove();
    }

    function updateDraftFromForm() {
      const form = doc.getElementById('dndAiMapForm');
      if (!form) return;
      state.draft = collectForm(form, selectedCampaignId());
      state.preview = null;
    }

    async function handleAction(button) {
      const action = button.dataset.dndAiMapAction;
      try {
        if (action === 'refresh') {
          setBusy(true); await refresh(true); setBusy(false); return;
        }
        if (action === 'preview') {
          const form = doc.getElementById('dndAiMapForm');
          state.draft = collectForm(form, selectedCampaignId());
          setBusy(true); state.preview = await invoke('dnd:ai-map-preview', state.draft); setBusy(false); return;
        }
        if (action === 'generate') {
          if (!state.preview) throw new Error('Preview the exact request before generation.');
          setBusy(true);
          const response = await invoke('dnd:ai-map-generate', { campaignId: state.preview.campaignId, ...state.preview.request, confirmed: true });
          state.payload = response.state; state.preview = null; state.detail = null; state.draft = defaultDraft(selectedCampaignId());
          setBusy(false); notify('Private AI map proposal generated for review.'); return;
        }
        if (action === 'review') {
          setBusy(true); state.detail = await invoke('dnd:ai-map-proposal-get', { proposalId: button.dataset.proposalId }); setBusy(false); return;
        }
        if (action === 'close-review') { state.detail = null; schedule(); return; }
        if (action === 'import') {
          const proposalId = button.dataset.proposalId;
          const acknowledgedOriginality = Boolean(doc.getElementById('dndAiMapOriginalityAck')?.checked);
          if (!win.confirm('Import this proposal as a new inactive, GM-hidden campaign map? Existing maps will not be replaced.')) return;
          setBusy(true);
          const response = await invoke('dnd:ai-map-import', { proposalId, acknowledgedOriginality, confirmed: true });
          state.payload = response.state; state.detail = null; setBusy(false);
          notify('AI map imported as an inactive, GM-hidden campaign map.');
          await invoke('dnd:maps-get');
          return;
        }
        if (action === 'delete') {
          if (!win.confirm('Delete this private AI map proposal? No saved campaign map will be changed.')) return;
          setBusy(true);
          const response = await invoke('dnd:ai-map-proposal-remove', { proposalId: button.dataset.proposalId, confirmed: true });
          state.payload = response.state; if (state.detail?.id === button.dataset.proposalId) state.detail = null; setBusy(false);
          notify('AI map proposal deleted.');
        }
      } catch (error) {
        state.loading = false;
        schedule();
        notify(error.message || String(error));
      }
    }

    const rootNode = doc.getElementById('view-dnd');
    if (!rootNode) return null;
    rootNode.addEventListener('click', (event) => {
      const button = event.target.closest?.('[data-dnd-ai-map-action]');
      if (!button) return;
      event.preventDefault();
      handleAction(button);
    });
    rootNode.addEventListener('input', (event) => {
      if (!event.target.closest?.('#dndAiMapForm')) return;
      updateDraftFromForm();
    });
    doc.getElementById('dndCampaignSelect')?.addEventListener('change', () => {
      state.payload = null; state.preview = null; state.detail = null; state.campaignId = '';
      schedule();
    });
    state.observer = new MutationObserver(() => schedule());
    state.observer.observe(rootNode, { childList: true, subtree: true });
    schedule();

    const api = { state, refresh, collectForm, svgDataUrl, schedule };
    win.__khaosDndAiMaps = api;
    return api;
  }

  return { install, defaultDraft, collectForm, svgDataUrl };
});
