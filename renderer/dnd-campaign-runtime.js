'use strict';

(function bootstrapCampaignRuntime(root) {
  if (!root?.document || root.__khaosDndCampaignRuntime) return;
  const doc = root.document;
  const state = { payload: null, campaignId: '', busy: false, scheduled: false };
  const invoke = (channel, payload) => root.khaos.invoke(channel, payload);
  const clean = (value, max = 4000) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[c]);
  const notify = (message) => typeof root.toast === 'function' ? root.toast(message) : undefined;
  const selectedCampaignId = () => clean(doc.getElementById('dndCampaignSelect')?.value || state.campaignId, 100);
  const activeRun = () => state.payload?.runs?.find((item) => item.status === 'active') || null;
  const activeScene = () => state.payload?.scenes?.find((item) => item.status === 'active') || null;
  const activeTurn = () => state.payload?.turns?.find((item) => ['collecting', 'locked', 'resolving'].includes(item.status)) || null;

  function schedule() {
    if (state.scheduled) return;
    state.scheduled = true;
    root.requestAnimationFrame(() => { state.scheduled = false; render(); });
  }
  function setBusy(value) { state.busy = Boolean(value); schedule(); }
  async function refresh(force = false) {
    const campaignId = selectedCampaignId();
    if (!campaignId) return;
    if (!force && state.payload && state.campaignId === campaignId) return;
    state.campaignId = campaignId;
    state.payload = await invoke('dnd:campaign-runtime-get', { campaignId });
    schedule();
  }

  function gatePanel() {
    const gate = state.payload?.gate || {};
    if (gate.status === 'owner_preview') return `<div class="dnd-runtime-callout success"><strong>D&D runtime enabled</strong><span>Production runtime is active for this Owner profile. Mechanical state changes remain deterministic and automatic Discord publication remains disabled.</span></div>`;
    return `<form data-runtime-form="enable" class="dnd-runtime-stack"><div class="dnd-runtime-callout warning"><strong>D&D runtime available</strong><span>Enable the production runtime for this Owner profile. Veyra remains isolated from direct mechanical state changes and Discord publication.</span></div><label>Confirmation phrase<input name="confirmation" autocomplete="off" placeholder="ENABLE D&D RUNTIME" required></label><button class="button primary" type="submit">Enable D&D Runtime</button></form>`;
  }

  const optionSelected = (current, value) => current === value ? 'selected' : '';
  function profilePanel() {
    const profile = state.payload?.profiles?.[0] || {};
    return `<form data-runtime-form="profile" class="dnd-runtime-stack"><div class="panel-heading"><div><span class="eyebrow">Campaign control model</span><h4>Play Profile</h4></div><span class="tag">${esc(profile.mode || 'not configured')}</span></div><div class="form-grid"><label>Mode<select name="mode"><option value="solo_ai_dm" ${optionSelected(profile.mode, 'solo_ai_dm')}>Solo · AI DM</option><option value="group_ai_dm" ${optionSelected(profile.mode, 'group_ai_dm')}>Group · AI DM</option><option value="human_dm" ${optionSelected(profile.mode, 'human_dm')}>Human DM</option><option value="human_dm_with_ai" ${optionSelected(profile.mode, 'human_dm_with_ai')}>Human DM + Veyra</option><option value="hybrid" ${optionSelected(profile.mode, 'hybrid')}>Hybrid handoff</option></select></label><label>Pace<select name="pace"><option value="live" ${optionSelected(profile.pace, 'live')}>Live</option><option value="asynchronous" ${optionSelected(profile.pace, 'asynchronous')}>Asynchronous</option><option value="mixed" ${optionSelected(profile.pace, 'mixed')}>Mixed</option></select></label><label>Automation<select name="automationLevel"><option value="suggestions_only" ${optionSelected(profile.automationLevel, 'suggestions_only')}>Suggestions only</option><option value="narration_and_npcs" ${optionSelected(profile.automationLevel, 'narration_and_npcs')}>Narration and NPCs</option><option value="automatic_checks" ${optionSelected(profile.automationLevel, 'automatic_checks')}>Automatic checks</option><option value="automatic_combat" ${optionSelected(profile.automationLevel, 'automatic_combat')}>Automatic combat</option><option value="full_ai_dm" ${optionSelected(profile.automationLevel, 'full_ai_dm')}>Full AI DM profile</option></select></label><label class="toggle-row"><span>Apply validated narrative events</span><input name="applyNarrativeEvents" type="checkbox" ${profile.automation?.applyNarrativeEvents ? 'checked' : ''}></label></div><div class="dnd-runtime-callout"><strong>Hard limits</strong><span>Mechanical events and automatic Discord publication remain disabled regardless of the selected profile.</span></div><button class="button primary" type="submit">Save Play Profile</button></form>`;
  }

  function seatsPanel() {
    const seats = state.payload?.seats || [];
    return `<div class="dnd-runtime-stack"><div class="panel-heading"><div><span class="eyebrow">Human and AI participants</span><h4>Player Seats</h4></div><span class="tag">${seats.length}</span></div><form data-runtime-form="seat" class="form-grid"><label>Display name<input name="displayName" maxlength="120" required></label><label>Character ID<input name="characterId" maxlength="100"></label><label>Seat type<select name="type"><option value="human_player">Human player</option><option value="human_dm">Human DM</option><option value="assistant_dm">Assistant DM</option><option value="ai_companion">AI companion</option><option value="viewer">Viewer</option></select></label><label class="toggle-row"><span>Ready</span><input name="ready" type="checkbox"></label><button class="button" type="submit">Add Seat</button></form><div class="dnd-runtime-list">${seats.length ? seats.map((seat) => `<article><strong>${esc(seat.displayName)}</strong><span>${esc(seat.type.replace(/_/g, ' '))}${seat.characterId ? ` · ${esc(seat.characterId)}` : ''}</span></article>`).join('') : '<p class="muted">No runtime seats yet.</p>'}</div></div>`;
  }

  function runPanel() {
    const run = activeRun();
    const scene = activeScene();
    if (!run) return `<form data-runtime-form="run" class="dnd-runtime-stack"><div class="panel-heading"><div><span class="eyebrow">Authoritative state</span><h4>Campaign Run</h4></div></div><label>Starting world time<input name="worldTime" value="Day 1"></label><button class="button primary" type="submit">Start Campaign Run</button></form>`;
    return `<div class="dnd-runtime-stack"><div class="panel-heading"><div><span class="eyebrow">Active run</span><h4>${esc(run.branch || 'main')}</h4></div><span class="tag">${esc(run.worldTime)}</span></div>${scene ? `<div class="dnd-runtime-scene"><strong>${esc(scene.locationName)}</strong><p>${esc(scene.publicDescription)}</p></div>` : `<form data-runtime-form="scene" class="dnd-runtime-stack"><label>Location<input name="locationName" required></label><label>Public scene description<textarea name="publicDescription" rows="3"></textarea></label><label>World time<input name="worldTime" value="${esc(run.worldTime)}"></label><button class="button" type="submit">Start Scene</button></form>`}${scene ? turnPanel(run, scene) : ''}</div>`;
  }

  function turnPanel(run, scene) {
    const turn = activeTurn();
    if (!turn) return `<form data-runtime-form="turn-open" class="dnd-runtime-stack"><h5>Open group turn</h5><label>Required seat IDs <small>comma-separated; blank uses scene participants</small><input name="requiredSeatIds"></label><button class="button" type="submit">Open Turn</button></form>`;
    const actions = turn.actions || [];
    return `<div class="dnd-runtime-turn"><div class="panel-heading"><div><span class="eyebrow">${esc(turn.status)}</span><h5>Turn Cycle</h5></div><span class="tag">${actions.length} actions</span></div>${turn.status === 'collecting' || turn.status === 'locked' ? `<form data-runtime-form="action" class="dnd-runtime-stack"><label>Seat<select name="seatId">${(state.payload?.seats || []).map((seat) => `<option value="${esc(seat.id)}">${esc(seat.displayName)}</option>`).join('')}</select></label><label>Character declaration<textarea name="text" rows="3" required></textarea></label><button class="button" type="submit">Submit Action</button></form>` : ''}<div class="dnd-runtime-list">${actions.map((action) => `<article><strong>${esc(action.status)}</strong><span>${esc(action.text)}</span>${action.status !== 'locked' ? `<button class="button" data-runtime-action="lock" data-turn-id="${esc(turn.id)}" data-action-id="${esc(action.id)}">Lock</button>` : ''}</article>`).join('')}</div>${turn.status === 'locked' ? `<button class="button primary" data-runtime-action="resolve" data-turn-id="${esc(turn.id)}">Resolve with Veyra</button>` : ''}${turn.status === 'resolving' ? '<div class="dnd-runtime-callout">Veyra is preparing a validated narrative result.</div>' : ''}</div>`;
  }

  function checkpointsPanel() {
    const run = activeRun();
    const checkpoints = state.payload?.checkpoints || [];
    return `<div class="dnd-runtime-stack"><div class="panel-heading"><div><span class="eyebrow">Integrity-checked recovery</span><h4>Checkpoints</h4></div><span class="tag">${checkpoints.length}</span></div>${run ? `<form data-runtime-form="checkpoint"><label>Label<input name="label" value="Manual checkpoint"></label><button class="button" type="submit">Create Checkpoint</button></form>` : ''}<div class="dnd-runtime-list">${checkpoints.slice().reverse().map((item) => `<article><strong>${esc(item.label)}</strong><span>${esc(item.createdAt)}</span><button class="button danger" data-runtime-action="restore" data-checkpoint-id="${esc(item.id)}">Restore</button></article>`).join('')}</div></div>`;
  }

  function render() {
    const view = doc.getElementById('view-dnd');
    if (!view || !state.payload) return;
    let mount = view.querySelector('[data-dnd-campaign-runtime]');
    if (!mount) { mount = doc.createElement('section'); mount.dataset.dndCampaignRuntime = '1'; view.appendChild(mount); }
    const enabled = state.payload.gate?.status === 'owner_preview';
    mount.innerHTML = `<article class="panel dnd-campaign-runtime"><div class="panel-heading"><div><span class="eyebrow">Production D&D runtime</span><h3>D&D Campaign Runtime</h3><p>Solo play, group play, deterministic rules resolution, and Veyra-led narration with player-agency safeguards.</p></div><button class="button" data-runtime-action="refresh" ${state.busy ? 'disabled' : ''}>Refresh</button></div>${gatePanel()}${enabled ? `<div class="dnd-runtime-grid"><section>${profilePanel()}</section><section>${seatsPanel()}</section><section>${runPanel()}</section><section>${checkpointsPanel()}</section></div>` : ''}</article>`;
  }

  async function submit(event) {
    const form = event.target.closest('[data-runtime-form]');
    if (!form || state.busy) return;
    event.preventDefault();
    const data = new FormData(form); const campaignId = selectedCampaignId();
    try {
      setBusy(true);
      if (form.dataset.runtimeForm === 'enable') await invoke('dnd:campaign-runtime-enable', { campaignId, confirmation: clean(data.get('confirmation'), 100) });
      if (form.dataset.runtimeForm === 'profile') await invoke('dnd:campaign-runtime-profile-upsert', { campaignId, enabled: true, mode: data.get('mode'), pace: data.get('pace'), automationLevel: data.get('automationLevel'), automation: { applyNarrativeEvents: data.has('applyNarrativeEvents') } });
      if (form.dataset.runtimeForm === 'seat') await invoke('dnd:campaign-runtime-seat-upsert', { campaignId, displayName: data.get('displayName'), characterId: data.get('characterId'), type: data.get('type'), ready: data.has('ready') });
      if (form.dataset.runtimeForm === 'run') await invoke('dnd:campaign-runtime-run-start', { campaignId, worldTime: data.get('worldTime') });
      if (form.dataset.runtimeForm === 'scene') await invoke('dnd:campaign-runtime-scene-start', { campaignId, runId: activeRun().id, locationName: data.get('locationName'), publicDescription: data.get('publicDescription'), worldTime: data.get('worldTime'), participantSeatIds: (state.payload.seats || []).filter((seat) => seat.active !== false).map((seat) => seat.id) });
      if (form.dataset.runtimeForm === 'turn-open') await invoke('dnd:campaign-runtime-turn-open', { campaignId, runId: activeRun().id, sceneId: activeScene().id, requiredSeatIds: clean(data.get('requiredSeatIds'), 2000).split(',').map((item) => item.trim()).filter(Boolean) });
      if (form.dataset.runtimeForm === 'action') await invoke('dnd:campaign-runtime-action-submit', { campaignId, turnCycleId: activeTurn().id, seatId: data.get('seatId'), text: data.get('text'), clientActionId: root.crypto?.randomUUID?.() || `${Date.now()}` });
      if (form.dataset.runtimeForm === 'checkpoint') await invoke('dnd:campaign-runtime-checkpoint-create', { campaignId, runId: activeRun().id, label: data.get('label') });
      await refresh(true); notify('D&D runtime updated.');
    } catch (error) { notify(error.message || String(error)); }
    finally { setBusy(false); }
  }

  async function click(event) {
    const button = event.target.closest('[data-runtime-action]');
    if (!button || state.busy) return;
    try {
      setBusy(true);
      if (button.dataset.runtimeAction === 'refresh') await refresh(true);
      if (button.dataset.runtimeAction === 'lock') await invoke('dnd:campaign-runtime-action-lock', { campaignId: selectedCampaignId(), turnCycleId: button.dataset.turnId, actionId: button.dataset.actionId });
      if (button.dataset.runtimeAction === 'resolve') await invoke('dnd:campaign-runtime-turn-resolve', { campaignId: selectedCampaignId(), turnCycleId: button.dataset.turnId, clientTurnId: root.crypto?.randomUUID?.() || `${Date.now()}` });
      if (button.dataset.runtimeAction === 'restore') { const confirmed = root.confirm('Restore this checkpoint and replace current campaign runtime state?'); if (confirmed) await invoke('dnd:campaign-runtime-checkpoint-restore', { campaignId: selectedCampaignId(), checkpointId: button.dataset.checkpointId, confirmed: true }); }
      await refresh(true);
    } catch (error) { notify(error.message || String(error)); }
    finally { setBusy(false); }
  }

  doc.addEventListener('submit', submit);
  doc.addEventListener('click', click);
  doc.addEventListener('change', (event) => { if (event.target?.id === 'dndCampaignSelect') { state.payload = null; refresh(true).catch(() => {}); } });
  root.khaos?.on?.('dnd:campaign-runtime-update', (payload) => { state.payload = payload; state.campaignId = payload.selectedCampaignId || state.campaignId; schedule(); });
  root.khaosDndDomHub?.subscribe(() => { if (doc.getElementById('view-dnd') && !doc.querySelector('[data-dnd-campaign-runtime]')) schedule(); });
  root.__khaosDndCampaignRuntime = { refresh };
  let startupAttempts = 0; const start = () => refresh(true).catch(() => { if (++startupAttempts < 20) root.setTimeout(start, 250); }); start(); schedule();
})(typeof window !== 'undefined' ? window : null);
