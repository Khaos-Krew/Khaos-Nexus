'use strict';

(function bootstrapDndLiveMaps(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) api.install(root);
})(typeof window !== 'undefined' ? window : null, function dndLiveMapsFactory() {
  const MAP_MODES = ['blank_grid', 'overworld', 'dungeon'];
  const GRID_TYPES = ['none', 'square', 'hex'];
  const MARKER_TYPES = ['party', 'character', 'npc', 'location', 'encounter', 'quest', 'loot', 'note', 'custom'];
  const clean = (value, max = 200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const numeric = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, numeric(value, minimum)));
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const fail = (message, field = '') => Object.assign(new Error(message), { code: 'DND_FORM_VALIDATION', field });

  function validateGenerationDraft(input = {}) {
    const name = clean(input.name, 180);
    if (!clean(input.campaignId, 100)) throw fail('Select a campaign before generating a map.', 'campaignId');
    if (!name) throw fail('Map name is required.', 'name');
    const width = Math.trunc(numeric(input.width, 1600));
    const height = Math.trunc(numeric(input.height, 900));
    if (width < 128 || height < 128 || width > 8192 || height > 8192) throw fail('Map dimensions must be between 128 and 8192 pixels.', 'width');
    return {
      campaignId: clean(input.campaignId, 100), name,
      mode: MAP_MODES.includes(input.mode) ? input.mode : 'blank_grid',
      width, height,
      gridType: GRID_TYPES.includes(input.gridType) ? input.gridType : 'square',
      gridSize: Math.max(16, Math.min(256, Math.trunc(numeric(input.gridSize, 64)))),
      seed: clean(input.seed || `${Date.now()}`, 160), theme: clean(input.theme || 'dark-fantasy', 80),
      scaleLabel: clean(input.scaleLabel, 120), active: input.active !== false, revealed: Boolean(input.revealed)
    };
  }

  function validateMarkerDraft(input = {}) {
    const label = clean(input.label, 160);
    if (!clean(input.campaignId, 100) || !clean(input.mapId, 100)) throw fail('Marker map and campaign are required.', 'mapId');
    if (!label) throw fail('Marker label is required.', 'label');
    return {
      ...(input.id ? { id: clean(input.id, 100) } : {}),
      campaignId: clean(input.campaignId, 100), mapId: clean(input.mapId, 100),
      markerType: MARKER_TYPES.includes(input.markerType) ? input.markerType : 'custom',
      linkedId: clean(input.linkedId, 100), label,
      publicDescription: clean(input.publicDescription, 2000), gmNotes: clean(input.gmNotes, 5000),
      x: clamp(input.x, 0, 1), y: clamp(input.y, 0, 1), visible: input.visible !== false,
      locked: Boolean(input.locked), icon: clean(input.icon, 30), color: clean(input.color, 30)
    };
  }

  function normalizedPosition(clientX, clientY, rectangle, transform = {}) {
    const zoom = Math.max(.1, numeric(transform.zoom, 1));
    const x = (clientX - rectangle.left - numeric(transform.panX)) / zoom;
    const y = (clientY - rectangle.top - numeric(transform.panY)) / zoom;
    return { x: clamp(x / Math.max(1, rectangle.width / zoom), 0, 1), y: clamp(y / Math.max(1, rectangle.height / zoom), 0, 1) };
  }

  function install(win) {
    if (!win?.document || win.__khaosDndLiveMaps) return win?.__khaosDndLiveMaps || null;
    const doc = win.document;
    const state = {
      payload: null, dnd: null, activeTab: false, selectedMapId: '', assetCache: new Map(),
      zoom: 1, panX: 0, panY: 0, scheduled: false, busy: false, observer: null, drag: null
    };
    const invoke = (channel, payload) => win.khaos.invoke(channel, payload);
    const notify = (message) => typeof win.toast === 'function' && win.toast(message);
    const campaignId = () => clean(doc.getElementById('dndCampaignSelect')?.value, 100);
    const maps = () => (state.payload?.maps || []).filter((item) => item.campaignId === campaignId() && !item.archived);
    const selectedMap = () => maps().find((item) => item.id === state.selectedMapId) || null;
    const markers = () => (state.payload?.markers || []).filter((item) => item.mapId === state.selectedMapId);

    function schedule() { if (state.scheduled) return; state.scheduled = true; win.setTimeout(() => { state.scheduled = false; enhance(); }, 0); }
    async function load(force = false) {
      if (!force && state.payload && state.dnd) return;
      [state.payload, state.dnd] = await Promise.all([invoke('dnd:maps-get'), invoke('dnd:get')]);
      const available = maps();
      if (!available.some((item) => item.id === state.selectedMapId)) state.selectedMapId = available.find((item) => item.active)?.id || available[0]?.id || '';
      schedule();
    }
    function closeModal() { doc.getElementById('dndMapModal')?.remove(); }
    function modalError(error) {
      const target = doc.getElementById('dndMapModalError');
      if (!target) return;
      target.textContent = error?.message || String(error); target.hidden = false;
      if (error?.field) doc.querySelector(`[name="${error.field}"]`)?.focus();
    }
    function showModal(title, body, saveLabel, action) {
      closeModal(); const wrapper = doc.createElement('div'); wrapper.id = 'dndMapModal'; wrapper.className = 'dnd-map-modal-backdrop';
      wrapper.innerHTML = `<section class="dnd-map-modal" role="dialog" aria-modal="true"><div class="panel-heading"><div><span class="eyebrow">D&D Maps</span><h2>${escapeHtml(title)}</h2></div><button class="button" data-dnd-map-action="close-modal">Close</button></div><div id="dndMapModalError" class="dnd-map-modal-error" hidden></div>${body}<div class="form-actions"><button class="button" data-dnd-map-action="close-modal">Cancel</button><button class="button primary" data-dnd-map-action="${action}">${escapeHtml(saveLabel)}</button></div></section>`;
      doc.body.appendChild(wrapper); wrapper.querySelector('input,select,textarea')?.focus();
    }

    function ensureTab(root) {
      const tabs = root.querySelector('.dnd-tabs'); if (!tabs) return;
      let button = tabs.querySelector('[data-dnd-map-tab="maps"]');
      if (!button) { button = doc.createElement('button'); button.className = 'dnd-tab'; button.dataset.dndMapTab = 'maps'; button.textContent = 'Maps'; const world = tabs.querySelector('[data-dnd-world-tab="world"]'); tabs.insertBefore(button, world || null); }
      button.classList.toggle('active', state.activeTab);
    }

    function mapCard(map) {
      return `<article class="dnd-map-card ${map.id === state.selectedMapId ? 'selected' : ''}"><button class="dnd-map-card-main" data-dnd-map-action="select-map" data-map-id="${escapeHtml(map.id)}"><span class="eyebrow">${map.sourceType} · ${map.gridType} grid</span><strong>${escapeHtml(map.name)}</strong><small>${map.width}×${map.height}${map.active ? ' · Active' : ''}${map.revealed ? ' · Revealed' : ' · GM hidden'}</small></button><div class="server-actions"><button class="button" data-dnd-map-action="edit-map" data-map-id="${escapeHtml(map.id)}">Edit</button><button class="button danger" data-dnd-map-action="archive-map" data-map-id="${escapeHtml(map.id)}">Archive</button></div></article>`;
    }
    function iconFor(marker) {
      if (marker.icon) return marker.icon;
      return ({ party: '◆', character: '●', npc: '♟', location: '⌂', encounter: '⚔', quest: '!', loot: '◆', note: '✎', custom: '●' })[marker.markerType] || '●';
    }
    function markerHtml(marker) {
      return `<button class="dnd-map-marker ${marker.visible ? '' : 'hidden-marker'}" style="left:${marker.x * 100}%;top:${marker.y * 100}%;--marker-color:${escapeHtml(marker.color || '#d13b3b')}" data-marker-id="${escapeHtml(marker.id)}" title="${escapeHtml(marker.label)}"><span>${escapeHtml(iconFor(marker))}</span><small>${escapeHtml(marker.label)}</small></button>`;
    }
    function gridClass(map) { return map.gridType === 'square' ? 'square-grid' : map.gridType === 'hex' ? 'hex-grid' : 'no-grid'; }

    function viewer(map) {
      if (!map) return '<article class="panel empty-state"><h3>Select or create a map</h3><p>Upload a raster map or generate a deterministic local map.</p></article>';
      const asset = state.assetCache.get(map.id);
      return `<article class="panel dnd-map-viewer-panel"><div class="panel-heading"><div><span class="eyebrow">${map.active ? 'Active campaign map' : 'Campaign map'}</span><h3>${escapeHtml(map.name)}</h3></div><div class="server-actions"><button class="button" data-dnd-map-action="zoom-out">−</button><span class="tag">${Math.round(state.zoom * 100)}%</span><button class="button" data-dnd-map-action="zoom-in">+</button><button class="button" data-dnd-map-action="reset-view">Reset</button><button class="button primary" data-dnd-map-action="new-marker">Add Marker</button><button class="button" data-dnd-map-action="export-map">Export PNG</button></div></div><div class="dnd-map-viewport" data-map-viewport><div class="dnd-map-stage ${gridClass(map)}" data-map-stage style="width:${map.width}px;height:${map.height}px;--grid-size:${map.gridSize}px;transform:translate(${state.panX}px,${state.panY}px) scale(${state.zoom})">${asset ? `<img src="${asset.dataUrl}" alt="${escapeHtml(map.name)}" draggable="false">` : '<div class="dnd-map-loading">Loading map asset…</div>'}<div class="dnd-map-grid-overlay"></div>${markers().map(markerHtml).join('')}</div></div><div class="dnd-map-legend"><span>${map.scaleLabel ? escapeHtml(map.scaleLabel) : 'Scale not set'}</span><span>${markers().length} markers</span><span>${map.revealed ? 'Player revealed' : 'GM hidden'}</span></div></article>`;
    }

    function render(root) {
      const panel = root.querySelector('.dnd-tab-panel'); if (!panel || !state.activeTab) return;
      root.querySelectorAll('[data-dnd-tab],[data-dnd-owner-tab],[data-dnd-world-tab]').forEach((item) => item.classList.remove('active'));
      const campaignMaps = maps(); const map = selectedMap();
      panel.innerHTML = `<div class="dnd-live-maps"><article class="panel dnd-map-library"><div class="panel-heading"><div><span class="eyebrow">Campaign cartography</span><h3>Maps</h3></div><div class="server-actions"><button class="button" data-dnd-map-action="upload-map">Upload Map</button><button class="button primary" data-dnd-map-action="generate-map">Generate Map</button></div></div><div class="callout">Uploads stay in protected local storage. Local generation never sends campaign data to an external service.</div><div class="dnd-map-list">${campaignMaps.length ? campaignMaps.map(mapCard).join('') : '<div class="empty-state"><h3>No maps yet</h3><p>Upload PNG, JPEG, or WebP, or generate a blank grid, overworld, or dungeon.</p></div>'}</div></article>${viewer(map)}</div>`;
      attachViewer(); if (map && !state.assetCache.has(map.id)) loadAsset(map.id);
    }

    async function loadAsset(mapId) {
      try { const asset = await invoke('dnd:map-asset', { mapId }); state.assetCache.set(mapId, asset); schedule(); }
      catch (error) { notify(error.message || String(error)); }
    }
    function enhance() {
      const root = doc.getElementById('view-dnd'); if (!root) return;
      ensureTab(root); render(root);
    }

    function generationDialog() {
      showModal('Generate Local Map', `<form id="dndMapGenerateForm" novalidate><label>Map name<input name="name" maxlength="180" value="New Campaign Map" required></label><div class="form-grid three"><label>Mode<select name="mode"><option value="blank_grid">Blank grid</option><option value="overworld">Overworld / island</option><option value="dungeon">Dungeon</option></select></label><label>Grid<select name="gridType"><option value="square">Square</option><option value="hex">Hex</option><option value="none">None</option></select></label><label>Grid size<input name="gridSize" type="number" min="16" max="256" value="64"></label></div><div class="form-grid"><label>Width<input name="width" type="number" min="128" max="8192" value="1600"></label><label>Height<input name="height" type="number" min="128" max="8192" value="900"></label></div><div class="form-grid"><label>Seed<input name="seed" maxlength="160" value="${Date.now()}"></label><label>Scale label<input name="scaleLabel" maxlength="120" placeholder="1 square = 5 ft"></label></div><div class="form-grid"><label class="toggle-row"><span><strong>Set active</strong></span><input name="active" type="checkbox" checked></label><label class="toggle-row"><span><strong>Reveal to players</strong></span><input name="revealed" type="checkbox"></label></div></form>`, 'Generate Map', 'save-generated-map');
    }
    function uploadDialog() {
      showModal('Upload Campaign Map', `<form id="dndMapUploadForm" novalidate><label>Map name (optional)<input name="name" maxlength="180" placeholder="Uses the selected filename"></label><div class="form-grid three"><label>Grid<select name="gridType"><option value="none">None</option><option value="square">Square</option><option value="hex">Hex</option></select></label><label>Grid size<input name="gridSize" type="number" min="8" max="512" value="64"></label><label>Scale label<input name="scaleLabel" maxlength="120" placeholder="1 square = 5 ft"></label></div><div class="form-grid"><label class="toggle-row"><span><strong>Set active</strong></span><input name="active" type="checkbox" checked></label><label class="toggle-row"><span><strong>Reveal to players</strong></span><input name="revealed" type="checkbox"></label></div></form>`, 'Choose Image', 'save-upload-map');
    }
    function mapEditDialog(map) {
      showModal('Edit Map', `<form id="dndMapEditForm" novalidate><input type="hidden" name="id" value="${escapeHtml(map.id)}"><label>Name<input name="name" maxlength="180" value="${escapeHtml(map.name)}" required></label><div class="form-grid three"><label>Grid<select name="gridType">${GRID_TYPES.map((item) => `<option value="${item}" ${map.gridType === item ? 'selected' : ''}>${item}</option>`).join('')}</select></label><label>Grid size<input name="gridSize" type="number" min="8" max="512" value="${map.gridSize}"></label><label>Scale label<input name="scaleLabel" maxlength="120" value="${escapeHtml(map.scaleLabel || '')}"></label></div><div class="form-grid"><label class="toggle-row"><span><strong>Active map</strong></span><input name="active" type="checkbox" ${map.active ? 'checked' : ''}></label><label class="toggle-row"><span><strong>Reveal to players</strong></span><input name="revealed" type="checkbox" ${map.revealed ? 'checked' : ''}></label></div></form>`, 'Save Map', 'save-map-settings');
    }
    function linkOptions(type, selected = '') {
      const key = type === 'character' ? 'characters' : type === 'npc' ? 'npcs' : type === 'location' ? 'locations' : type === 'encounter' ? 'encounters' : type === 'quest' ? 'quests' : type === 'loot' ? 'loot' : '';
      const items = key ? (state.payload?.links?.[key] || []).filter((item) => !item.campaignId || item.campaignId === campaignId()) : [];
      return `<option value="">No linked record</option>${items.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selected ? 'selected' : ''}>${escapeHtml(item.name || item.title || item.id)}</option>`).join('')}`;
    }
    function markerDialog(marker = null, position = { x: .5, y: .5 }) {
      const value = marker || { markerType: 'custom', x: position.x, y: position.y, visible: true };
      showModal(marker ? 'Edit Map Marker' : 'Add Map Marker', `<form id="dndMapMarkerForm" novalidate><input type="hidden" name="id" value="${escapeHtml(value.id || '')}"><input type="hidden" name="x" value="${value.x}"><input type="hidden" name="y" value="${value.y}"><div class="form-grid"><label>Type<select name="markerType">${MARKER_TYPES.map((item) => `<option value="${item}" ${value.markerType === item ? 'selected' : ''}>${item}</option>`).join('')}</select></label><label>Label<input name="label" maxlength="160" value="${escapeHtml(value.label || '')}" required></label></div><label>Linked record<select name="linkedId">${linkOptions(value.markerType, value.linkedId)}</select></label><label>Player description<textarea name="publicDescription" rows="3" maxlength="2000">${escapeHtml(value.publicDescription || '')}</textarea></label><label>GM notes<textarea name="gmNotes" rows="3" maxlength="5000">${escapeHtml(value.gmNotes || '')}</textarea></label><div class="form-grid"><label>Icon<input name="icon" maxlength="30" value="${escapeHtml(value.icon || '')}"></label><label>Marker color<input name="color" type="color" value="${escapeHtml(value.color || '#d13b3b')}"></label></div><div class="form-grid"><label class="toggle-row"><span><strong>Player visible</strong></span><input name="visible" type="checkbox" ${value.visible !== false ? 'checked' : ''}></label><label class="toggle-row"><span><strong>Lock position</strong></span><input name="locked" type="checkbox" ${value.locked ? 'checked' : ''}></label></div>${marker ? '<button type="button" class="button danger" data-dnd-map-action="remove-marker" data-marker-id="' + escapeHtml(marker.id) + '">Remove Marker</button>' : ''}</form>`, marker ? 'Save Marker' : 'Add Marker', 'save-marker');
      const type = doc.querySelector('#dndMapMarkerForm [name="markerType"]');
      type?.addEventListener('change', () => { const select = doc.querySelector('#dndMapMarkerForm [name="linkedId"]'); if (select) select.innerHTML = linkOptions(type.value, ''); });
    }

    function attachViewer() {
      const viewport = doc.querySelector('[data-map-viewport]'); const stage = doc.querySelector('[data-map-stage]');
      if (!viewport || !stage) return;
      viewport.addEventListener('wheel', (event) => { event.preventDefault(); state.zoom = clamp(state.zoom + (event.deltaY < 0 ? .1 : -.1), .2, 4); schedule(); }, { passive: false });
      viewport.addEventListener('pointerdown', (event) => {
        const marker = event.target.closest('[data-marker-id]');
        if (marker) {
          const record = markers().find((item) => item.id === marker.dataset.markerId); if (!record || record.locked) return;
          state.drag = { kind: 'marker', marker: record, pointerId: event.pointerId }; marker.setPointerCapture?.(event.pointerId); return;
        }
        state.drag = { kind: 'pan', startX: event.clientX, startY: event.clientY, panX: state.panX, panY: state.panY, pointerId: event.pointerId }; viewport.setPointerCapture?.(event.pointerId);
      });
      viewport.addEventListener('pointermove', (event) => {
        if (!state.drag) return;
        if (state.drag.kind === 'pan') { state.panX = state.drag.panX + event.clientX - state.drag.startX; state.panY = state.drag.panY + event.clientY - state.drag.startY; stage.style.transform = `translate(${state.panX}px,${state.panY}px) scale(${state.zoom})`; }
        if (state.drag.kind === 'marker') {
          const rect = stage.getBoundingClientRect(); const position = { x: clamp((event.clientX - rect.left) / rect.width, 0, 1), y: clamp((event.clientY - rect.top) / rect.height, 0, 1) };
          const element = stage.querySelector(`[data-marker-id="${state.drag.marker.id}"]`); if (element) { element.style.left = `${position.x * 100}%`; element.style.top = `${position.y * 100}%`; } state.drag.position = position;
        }
      });
      viewport.addEventListener('pointerup', async () => {
        const drag = state.drag; state.drag = null;
        if (drag?.kind === 'marker' && drag.position) {
          const result = await invoke('dnd:map-marker-save', { ...drag.marker, ...drag.position }); state.payload = result.state; schedule();
        }
      });
      stage.querySelectorAll('[data-marker-id]').forEach((element) => element.addEventListener('dblclick', () => markerDialog(markers().find((item) => item.id === element.dataset.markerId))));
    }

    async function snapshot() {
      const map = selectedMap(); const asset = state.assetCache.get(map?.id); if (!map || !asset) throw new Error('Map asset is not ready.');
      const max = 4096; const ratio = Math.min(1, max / Math.max(map.width, map.height));
      const canvas = doc.createElement('canvas'); canvas.width = Math.max(1, Math.round(map.width * ratio)); canvas.height = Math.max(1, Math.round(map.height * ratio));
      const context = canvas.getContext('2d'); const image = new win.Image(); image.src = asset.dataUrl; await image.decode(); context.drawImage(image, 0, 0, canvas.width, canvas.height);
      context.textAlign = 'center'; context.textBaseline = 'bottom'; context.font = `${Math.max(12, 18 * ratio)}px sans-serif`;
      for (const marker of markers().filter((item) => item.visible)) { const x = marker.x * canvas.width; const y = marker.y * canvas.height; context.fillStyle = marker.color || '#d13b3b'; context.beginPath(); context.arc(x, y, Math.max(5, 9 * ratio), 0, Math.PI * 2); context.fill(); context.fillStyle = '#fff'; context.fillText(marker.label, x, y - 10); }
      return invoke('dnd:map-export', { mapId: map.id, campaignId: map.campaignId, name: map.name, dataUrl: canvas.toDataURL('image/png') });
    }

    async function withBusy(operation) { if (state.busy) return; state.busy = true; try { await operation(); } catch (error) { modalError(error); if (!doc.getElementById('dndMapModal')) notify(error.message || String(error)); } finally { state.busy = false; } }
    async function action(target) {
      const name = target.dataset.dndMapAction; const mapId = clean(target.dataset.mapId, 100); const markerId = clean(target.dataset.markerId, 100);
      if (name === 'close-modal') return closeModal();
      if (name === 'upload-map') return uploadDialog();
      if (name === 'generate-map') return generationDialog();
      if (name === 'select-map') { state.selectedMapId = mapId; state.zoom = 1; state.panX = state.panY = 0; schedule(); return; }
      if (name === 'edit-map') return mapEditDialog(maps().find((item) => item.id === mapId));
      if (name === 'archive-map') return withBusy(async () => { if (!win.confirm('Archive this map? Its protected asset and revision history remain stored.')) return; const result = await invoke('dnd:map-archive', { mapId }); state.payload = result.state; state.selectedMapId = maps()[0]?.id || ''; schedule(); });
      if (name === 'zoom-in') { state.zoom = clamp(state.zoom + .2, .2, 4); schedule(); return; }
      if (name === 'zoom-out') { state.zoom = clamp(state.zoom - .2, .2, 4); schedule(); return; }
      if (name === 'reset-view') { state.zoom = 1; state.panX = state.panY = 0; schedule(); return; }
      if (name === 'new-marker') return markerDialog(null, { x: .5, y: .5 });
      if (name === 'remove-marker') return withBusy(async () => { if (!win.confirm('Remove this marker?')) return; const result = await invoke('dnd:map-marker-remove', { markerId }); state.payload = result.state; closeModal(); schedule(); });
      if (name === 'export-map') return withBusy(async () => { const result = await snapshot(); if (!result.canceled) notify(`Map snapshot exported as ${result.fileName}.`); });
      if (name === 'save-generated-map') return withBusy(async () => { const form = doc.getElementById('dndMapGenerateForm'); const data = Object.fromEntries(new win.FormData(form).entries()); data.active = form.elements.active.checked; data.revealed = form.elements.revealed.checked; const result = await invoke('dnd:map-generate', validateGenerationDraft({ ...data, campaignId: campaignId() })); state.payload = result.state; state.selectedMapId = result.map.id; closeModal(); schedule(); });
      if (name === 'save-upload-map') return withBusy(async () => { const form = doc.getElementById('dndMapUploadForm'); const data = Object.fromEntries(new win.FormData(form).entries()); data.active = form.elements.active.checked; data.revealed = form.elements.revealed.checked; const result = await invoke('dnd:map-upload', { ...data, campaignId: campaignId() }); if (!result.canceled) { state.payload = result.state; state.selectedMapId = result.map.id; closeModal(); schedule(); } });
      if (name === 'save-map-settings') return withBusy(async () => { const form = doc.getElementById('dndMapEditForm'); const data = Object.fromEntries(new win.FormData(form).entries()); data.active = form.elements.active.checked; data.revealed = form.elements.revealed.checked; const result = await invoke('dnd:map-save', data); state.payload = result.state; closeModal(); schedule(); });
      if (name === 'save-marker') return withBusy(async () => { const form = doc.getElementById('dndMapMarkerForm'); const data = Object.fromEntries(new win.FormData(form).entries()); data.visible = form.elements.visible.checked; data.locked = form.elements.locked.checked; const result = await invoke('dnd:map-marker-save', validateMarkerDraft({ ...data, campaignId: campaignId(), mapId: state.selectedMapId })); state.payload = result.state; closeModal(); schedule(); });
    }

    doc.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-dnd-map-tab="maps"]'); if (tab) { state.activeTab = true; load(true).then(schedule).catch((error) => notify(error.message || String(error))); return; }
      const otherTab = event.target.closest('[data-dnd-tab],[data-dnd-owner-tab],[data-dnd-world-tab],[data-dnd-repair-tab]'); if (otherTab) state.activeTab = false;
      const target = event.target.closest('[data-dnd-map-action]'); if (target) { event.preventDefault(); action(target); }
    });
    state.observer = new win.MutationObserver((mutations) => { if (mutations.some((mutation) => [...mutation.addedNodes].some((node) => node?.nodeType === 1 && (node.querySelector?.('.dnd-tabs') || node.classList?.contains('dnd-tabs'))))) schedule(); });
    state.observer.observe(doc.body, { childList: true, subtree: true });
    schedule(); win.__khaosDndLiveMaps = { state, load, enhance }; return win.__khaosDndLiveMaps;
  }

  return { install, validateGenerationDraft, validateMarkerDraft, normalizedPosition };
});
