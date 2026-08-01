'use strict';

(function bootstrapDndEncounterPanels(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) api.install(root);
})(typeof window !== 'undefined' ? window : null, function dndEncounterPanelsFactory() {
  const HEALTH_MODES = ['exact', 'percentage', 'bloodied', 'hidden'];
  const ROLL_TYPES = ['attack', 'damage', 'saving_throw', 'ability_check', 'skill_check', 'healing', 'custom'];
  const PRIVACY = ['public', 'dm_only', 'blind'];
  const PARTY_FIELDS = ['hp', 'armor_class', 'conditions', 'exhaustion', 'inspiration', 'initiative'];
  const clean = (value, max = 200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const numeric = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const integer = (value, fallback = 0) => Math.trunc(numeric(value, fallback));
  const list = (value) => [...new Set((Array.isArray(value) ? value : String(value || '').split(',')).map((item) => clean(item, 80)).filter(Boolean))];
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const fail = (message, field = '') => Object.assign(new Error(message), { code: 'DND_FORM_VALIDATION', field });

  function validatePanelDraft(input = {}, existing = {}) {
    const campaignId = clean(input.campaignId, 100);
    const encounterId = clean(input.encounterId, 100);
    const bindingId = clean(input.bindingId, 100);
    if (!campaignId || !encounterId) throw fail('Select an encounter before configuring its Discord panel.', 'encounterId');
    if (!bindingId) throw fail('Select an active Discord binding for the encounter panel.', 'bindingId');
    return {
      ...existing,
      ...(input.id ? { id: clean(input.id, 100) } : {}),
      campaignId,
      encounterId,
      bindingId,
      featuredCombatantId: clean(input.featuredCombatantId, 100),
      healthMode: HEALTH_MODES.includes(input.healthMode) ? input.healthMode : 'percentage',
      partyFields: list(input.partyFields).filter((item) => PARTY_FIELDS.includes(item)),
      maxVisibleParty: Math.max(1, Math.min(12, integer(input.maxVisibleParty, 8))),
      mentionCurrentTurn: Boolean(input.mentionCurrentTurn),
      autoRefresh: input.autoRefresh !== false,
      status: existing.status || 'draft'
    };
  }

  function validateActionDraft(input = {}, existing = {}) {
    const campaignId = clean(input.campaignId, 100);
    const encounterId = clean(input.encounterId, 100);
    const label = clean(input.label, 80);
    const expression = clean(input.expression, 80);
    if (!campaignId || !encounterId) throw fail('Select an encounter before saving a turn action.', 'encounterId');
    if (!label) throw fail('Button label is required.', 'label');
    if (!expression || !/^\s*\d*d\d+/i.test(expression)) throw fail('Enter a dice expression such as d20+5 or 2d6+3.', 'expression');
    return {
      ...existing,
      ...(input.id ? { id: clean(input.id, 100) } : {}),
      campaignId,
      encounterId,
      characterId: clean(input.characterId, 100),
      combatantId: clean(input.combatantId, 100),
      label,
      expression,
      rollType: ROLL_TYPES.includes(input.rollType) ? input.rollType : 'custom',
      privacy: PRIVACY.includes(input.privacy) ? input.privacy : 'public',
      prompt: clean(input.prompt, 500),
      sortOrder: integer(input.sortOrder),
      active: input.active !== false
    };
  }

  function validateCombatantPatch(input = {}) {
    const hp = integer(input.hp);
    const maxHp = integer(input.maxHp);
    if (hp < 0 || maxHp < 0 || hp > maxHp) throw fail('Combatant HP must be between 0 and maximum HP.', 'hp');
    return {
      encounterId: clean(input.encounterId, 100),
      combatantId: clean(input.combatantId, 100),
      hp,
      maxHp,
      conditions: list(input.conditions)
    };
  }

  function healthBar(hp, maxHp, segments = 10) {
    if (!(Number(maxHp) > 0)) return 'Unknown';
    const percentage = Math.max(0, Math.min(100, Math.round(Number(hp || 0) / Number(maxHp) * 100)));
    const filled = Math.round(percentage / 100 * segments);
    return `${'█'.repeat(filled)}${'░'.repeat(segments - filled)} ${percentage}%`;
  }

  function install(win) {
    if (!win?.document || win.__khaosDndEncounterPanels) return win?.__khaosDndEncounterPanels || null;
    const doc = win.document;
    const state = { payload: null, busy: false, scheduled: false, observer: null, loadedAt: 0 };
    const invoke = (channel, payload) => win.khaos.invoke(channel, payload);
    const notify = (message) => typeof win.toast === 'function' && win.toast(message);
    const ownerState = () => win.__khaosDndOwnerWorkflows?.state || null;
    const campaignId = () => clean(doc.getElementById('dndCampaignSelect')?.value, 100);
    const encounterId = () => clean(ownerState()?.selectedEncounterId, 100);
    const dnd = () => state.payload?.state || ownerState()?.payload?.state || {};
    const encounter = () => (dnd().encounters || []).find((item) => item.id === encounterId()) || null;
    const combatants = () => (dnd().combatants || []).filter((item) => item.encounterId === encounterId() && item.active !== false);
    const panels = () => (dnd().encounterPanels || []).filter((item) => item.encounterId === encounterId());
    const panel = () => panels().find((item) => item.status !== 'completed') || panels()[0] || null;
    const actions = () => (dnd().encounterTurnActions || []).filter((item) => item.encounterId === encounterId() && item.active !== false).sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));

    function schedule() { if (state.scheduled) return; state.scheduled = true; win.setTimeout(() => { state.scheduled = false; enhance(); }, 0); }
    async function load(force = false) {
      if (!force && state.payload && Date.now() - state.loadedAt < 5000) return state.payload;
      state.payload = await invoke('dnd:encounter-panels-get');
      state.loadedAt = Date.now();
      schedule();
      return state.payload;
    }
    function closeModal() { doc.getElementById('dndEncounterPanelModal')?.remove(); }
    function modalError(error) {
      const target = doc.getElementById('dndEncounterPanelModalError');
      if (!target) return;
      target.textContent = error?.message || String(error); target.hidden = false;
      if (error?.field) doc.querySelector(`[name="${error.field}"]`)?.focus();
    }
    function showModal(title, body, saveLabel, action) {
      closeModal(); const wrapper = doc.createElement('div'); wrapper.id = 'dndEncounterPanelModal'; wrapper.className = 'dnd-encounter-panel-modal-backdrop';
      wrapper.innerHTML = `<section class="dnd-encounter-panel-modal" role="dialog" aria-modal="true"><div class="panel-heading"><div><span class="eyebrow">D&D Combat Panel</span><h2>${escapeHtml(title)}</h2></div><button class="button" data-dnd-encounter-panel-action="close-modal">Close</button></div><div id="dndEncounterPanelModalError" class="dnd-encounter-panel-modal-error" hidden></div>${body}<div class="form-actions"><button class="button" data-dnd-encounter-panel-action="close-modal">Cancel</button><button class="button primary" data-dnd-encounter-panel-action="${action}">${escapeHtml(saveLabel)}</button></div></section>`;
      doc.body.appendChild(wrapper); wrapper.querySelector('input,select,textarea')?.focus();
    }

    function bindingLabel(binding) { return binding.displayName || `${binding.resourceType || 'channel'} ${binding.resourceId}`; }
    function panelConfigDialog() {
      const current = panel() || { healthMode: 'percentage', partyFields: ['hp', 'armor_class', 'conditions'], maxVisibleParty: 8, autoRefresh: true };
      const bindings = (dnd().bindings || []).filter((item) => item.campaignId === campaignId() && item.active !== false && ['main', 'dice_log', 'announcements'].includes(item.purpose));
      showModal('Configure Encounter Panel', `<form id="dndEncounterPanelForm" novalidate><input type="hidden" name="id" value="${escapeHtml(current.id || '')}"><label>Discord binding<select name="bindingId" required><option value="">Select binding</option>${bindings.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === current.bindingId ? 'selected' : ''}>${escapeHtml(bindingLabel(item))} · ${escapeHtml(item.purpose)}</option>`).join('')}</select></label><div class="form-grid"><label>Featured boss / combatant<select name="featuredCombatantId"><option value="">No featured boss</option>${combatants().map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === current.featuredCombatantId ? 'selected' : ''}>${escapeHtml(item.nameSnapshot || item.name || item.id)}</option>`).join('')}</select></label><label>Boss health visibility<select name="healthMode">${HEALTH_MODES.map((item) => `<option value="${item}" ${item === current.healthMode ? 'selected' : ''}>${item}</option>`).join('')}</select></label></div><label>Party fields</label><div class="dnd-encounter-field-grid">${PARTY_FIELDS.map((item) => `<label class="toggle-row"><span>${escapeHtml(item.replace('_', ' '))}</span><input type="checkbox" name="partyField" value="${item}" ${(current.partyFields || []).includes(item) ? 'checked' : ''}></label>`).join('')}</div><div class="form-grid three"><label>Maximum party rows<input name="maxVisibleParty" type="number" min="1" max="12" value="${current.maxVisibleParty || 8}"></label><label class="toggle-row"><span><strong>Mention current player</strong></span><input name="mentionCurrentTurn" type="checkbox" ${current.mentionCurrentTurn ? 'checked' : ''}></label><label class="toggle-row"><span><strong>Auto refresh</strong></span><input name="autoRefresh" type="checkbox" ${current.autoRefresh !== false ? 'checked' : ''}></label></div><div class="callout">One Discord message is created per encounter binding and edited in place. Hidden combatants and GM-only information are removed from the public panel.</div></form>`, 'Save Configuration', 'save-panel-config');
    }

    function actionDialog(value = null) {
      const current = value || { rollType: 'attack', privacy: 'public', active: true, sortOrder: actions().length };
      showModal(value ? 'Edit Turn Roll' : 'Add Turn Roll', `<form id="dndEncounterActionForm" novalidate><input type="hidden" name="id" value="${escapeHtml(current.id || '')}"><div class="form-grid"><label>Button label<input name="label" maxlength="80" value="${escapeHtml(current.label || '')}" required></label><label>Dice expression<input name="expression" maxlength="80" value="${escapeHtml(current.expression || 'd20')}" placeholder="d20+5" required></label></div><div class="form-grid three"><label>Roll type<select name="rollType">${ROLL_TYPES.map((item) => `<option value="${item}" ${item === current.rollType ? 'selected' : ''}>${item.replace('_', ' ')}</option>`).join('')}</select></label><label>Privacy<select name="privacy">${PRIVACY.map((item) => `<option value="${item}" ${item === current.privacy ? 'selected' : ''}>${item.replace('_', ' ')}</option>`).join('')}</select></label><label>Sort order<input name="sortOrder" type="number" value="${current.sortOrder || 0}"></label></div><div class="form-grid"><label>Specific combatant<select name="combatantId"><option value="">Any current combatant</option>${combatants().map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === current.combatantId ? 'selected' : ''}>${escapeHtml(item.nameSnapshot || item.name || item.id)}</option>`).join('')}</select></label><label>Specific character<select name="characterId"><option value="">Any current character</option>${(dnd().characters || []).filter((item) => item.campaignId === campaignId()).map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === current.characterId ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label></div><label>Player prompt / help text<input name="prompt" maxlength="500" value="${escapeHtml(current.prompt || '')}"></label><label class="toggle-row"><span><strong>Active</strong></span><input name="active" type="checkbox" ${current.active !== false ? 'checked' : ''}></label><div class="callout warning">Rolls are recorded, but damage and healing are never applied automatically. The DM must confirm state changes separately.</div></form>`, 'Save Turn Roll', 'save-turn-action');
    }

    function combatantDialog(value) {
      showModal(`Adjust ${value.nameSnapshot || value.name || 'Combatant'}`, `<form id="dndEncounterCombatantForm"><input type="hidden" name="combatantId" value="${escapeHtml(value.id)}"><div class="form-grid"><label>Current HP<input name="hp" type="number" min="0" value="${value.hp ?? 0}"></label><label>Maximum HP<input name="maxHp" type="number" min="0" value="${value.maxHp ?? 0}"></label></div><label>Conditions<input name="conditions" value="${escapeHtml((value.conditions || []).join(', '))}"></label></form>`, 'Save Combatant', 'save-combatant-state');
    }

    function actionCard(item) {
      const target = item.combatantId ? combatants().find((entry) => entry.id === item.combatantId)?.nameSnapshot : item.characterId ? (dnd().characters || []).find((entry) => entry.id === item.characterId)?.name : 'Any current player';
      return `<div class="dnd-encounter-action-row"><div><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.expression)} · ${escapeHtml(item.rollType.replace('_', ' '))} · ${escapeHtml(item.privacy.replace('_', ' '))}</span><small>${escapeHtml(target || 'Configured target missing')}</small></div><div class="server-actions"><button class="button" data-dnd-encounter-panel-action="edit-turn-action" data-action-id="${escapeHtml(item.id)}">Edit</button><button class="button danger" data-dnd-encounter-panel-action="remove-turn-action" data-action-id="${escapeHtml(item.id)}">Remove</button></div></div>`;
    }
    function combatantRow(item, currentId) {
      return `<div class="dnd-encounter-combatant-row ${item.id === currentId ? 'current' : ''}"><div><strong>${escapeHtml(item.nameSnapshot || item.name || 'Combatant')}</strong><span>${healthBar(item.hp, item.maxHp)} · Initiative ${item.initiative ?? 0}</span><small>${escapeHtml((item.conditions || []).join(', ') || 'No conditions')}${item.hidden ? ' · Hidden' : ''}</small></div><button class="button" data-dnd-encounter-panel-action="edit-combatant-state" data-combatant-id="${escapeHtml(item.id)}">Adjust</button></div>`;
    }

    function renderControls(container) {
      const selected = encounter();
      if (!selected) { container.remove(); return; }
      const currentPanel = panel();
      const order = [...combatants()].sort((a, b) => Number(b.initiative || 0) - Number(a.initiative || 0) || Number(b.dexterity || 0) - Number(a.dexterity || 0) || String(a.id).localeCompare(String(b.id)));
      const current = order.length ? order[Math.min(Math.max(0, Number(selected.currentTurnIndex || 0)), order.length - 1)] : null;
      container.innerHTML = `<div class="panel-heading"><div><span class="eyebrow">Discord combat HUD</span><h3>Encounter Panel</h3></div><div class="server-actions"><span class="tag ${currentPanel?.status === 'active' ? 'good' : currentPanel?.status === 'stale' ? 'danger' : ''}">${escapeHtml(currentPanel?.status || 'not configured')}</span><button class="button" data-dnd-encounter-panel-action="configure-panel">Configure</button>${currentPanel ? `<button class="button primary" data-dnd-encounter-panel-action="publish-panel" data-panel-id="${escapeHtml(currentPanel.id)}">${currentPanel.status === 'stale' ? 'Repair' : currentPanel.messageId ? 'Refresh' : 'Publish'}</button><button class="button danger" data-dnd-encounter-panel-action="end-panel" data-panel-id="${escapeHtml(currentPanel.id)}">End Panel</button>` : ''}</div></div>${currentPanel?.lastError ? `<div class="callout warning"><strong>Panel needs attention:</strong> ${escapeHtml(currentPanel.lastError)}</div>` : ''}<div class="dnd-encounter-panel-grid"><section><div class="panel-heading"><div><span class="eyebrow">DM-defined rolls</span><h4>Turn Buttons</h4></div><button class="button primary" data-dnd-encounter-panel-action="new-turn-action">Add Roll</button></div><div class="dnd-encounter-action-list">${actions().length ? actions().map(actionCard).join('') : '<p class="dnd-empty">No turn rolls configured. Add attack, damage, save, check, healing, or custom buttons.</p>'}</div>${actions().length > 20 ? '<div class="callout">The first 19 actions appear on the main panel; remaining actions are available through the More Actions control.</div>' : ''}</section><section><div class="panel-heading"><div><span class="eyebrow">Live encounter state</span><h4>Combatants</h4></div>${selected.status === 'active' && order.length ? `<button class="button" data-dnd-encounter-panel-action="advance-panel-initiative">Next Turn</button>` : ''}</div><div class="dnd-encounter-combatant-list">${order.length ? order.map((item) => combatantRow(item, current?.id)).join('') : '<p class="dnd-empty">No combatants.</p>'}</div></section></div><div class="callout">The bot edits one persistent message when initiative, HP, conditions, combatants, or panel settings change. Roll buttons are valid only for the exact current turn and linked player; DMs may override.</div>`;
    }

    function enhance() {
      const owner = ownerState();
      const root = doc.getElementById('view-dnd');
      const workflow = root?.querySelector('.dnd-owner-workflows.dnd-owner-two-column');
      if (!workflow || owner?.activeTab !== 'encounters' || !owner.selectedEncounterId) {
        root?.querySelector('.dnd-encounter-panel-controls')?.remove();
        return;
      }
      let controls = workflow.querySelector('.dnd-encounter-panel-controls');
      if (!controls) { controls = doc.createElement('article'); controls.className = 'panel dnd-encounter-panel-controls'; workflow.appendChild(controls); }
      renderControls(controls);
      load().catch((error) => notify(error.message || String(error)));
    }

    async function withBusy(operation) { if (state.busy) return; state.busy = true; try { await operation(); } catch (error) { modalError(error); if (!doc.getElementById('dndEncounterPanelModal')) notify(error.message || String(error)); } finally { state.busy = false; } }
    async function action(target) {
      const name = target.dataset.dndEncounterPanelAction;
      const panelId = clean(target.dataset.panelId, 100);
      const actionId = clean(target.dataset.actionId, 100);
      const combatantId = clean(target.dataset.combatantId, 100);
      if (name === 'close-modal') return closeModal();
      if (name === 'configure-panel') return panelConfigDialog();
      if (name === 'new-turn-action') return actionDialog();
      if (name === 'edit-turn-action') return actionDialog(actions().find((item) => item.id === actionId));
      if (name === 'edit-combatant-state') return combatantDialog(combatants().find((item) => item.id === combatantId));
      if (name === 'save-panel-config') return withBusy(async () => {
        const form = doc.getElementById('dndEncounterPanelForm'); const raw = Object.fromEntries(new win.FormData(form).entries());
        raw.partyFields = [...form.querySelectorAll('[name="partyField"]:checked')].map((item) => item.value);
        raw.mentionCurrentTurn = form.elements.mentionCurrentTurn.checked; raw.autoRefresh = form.elements.autoRefresh.checked;
        const result = await invoke('dnd:encounter-panel-save', validatePanelDraft({ ...raw, campaignId: campaignId(), encounterId: encounterId() }, panel() || {}));
        state.payload = result.state; state.loadedAt = Date.now(); closeModal(); schedule(); notify('Encounter panel configuration saved.');
      });
      if (name === 'publish-panel') return withBusy(async () => { const result = await invoke('dnd:encounter-panel-request', { panelId, repair: panel()?.status === 'stale' }); state.payload = result.state; state.loadedAt = Date.now(); schedule(); notify('Encounter panel publish/refresh requested.'); });
      if (name === 'end-panel') return withBusy(async () => { if (!win.confirm('End this Discord encounter panel and remove its roll buttons?')) return; const result = await invoke('dnd:encounter-panel-end', { panelId }); state.payload = result.state; state.loadedAt = Date.now(); schedule(); });
      if (name === 'save-turn-action') return withBusy(async () => {
        const form = doc.getElementById('dndEncounterActionForm'); const raw = Object.fromEntries(new win.FormData(form).entries()); raw.active = form.elements.active.checked;
        const existing = actions().find((item) => item.id === raw.id) || {};
        const result = await invoke('dnd:encounter-action-save', validateActionDraft({ ...raw, campaignId: campaignId(), encounterId: encounterId() }, existing));
        state.payload = result.state; state.loadedAt = Date.now(); closeModal(); schedule();
      });
      if (name === 'remove-turn-action') return withBusy(async () => { if (!win.confirm('Remove this turn roll button? Existing roll history remains.')) return; const result = await invoke('dnd:encounter-action-remove', { actionId }); state.payload = result.state; state.loadedAt = Date.now(); schedule(); });
      if (name === 'save-combatant-state') return withBusy(async () => {
        const form = doc.getElementById('dndEncounterCombatantForm'); const raw = Object.fromEntries(new win.FormData(form).entries());
        const result = await invoke('dnd:encounter-combatant-patch', validateCombatantPatch({ ...raw, encounterId: encounterId() }));
        state.payload = result.state; state.loadedAt = Date.now(); closeModal(); schedule();
      });
      if (name === 'advance-panel-initiative') return withBusy(async () => { const result = await invoke('dnd:encounter-panel-advance', { encounterId: encounterId() }); state.payload = result.state; state.loadedAt = Date.now(); schedule(); notify(`Turn advanced to ${result.result.currentCombatant?.nameSnapshot || 'next combatant'}.`); });
    }

    doc.addEventListener('click', (event) => {
      const target = event.target.closest('[data-dnd-encounter-panel-action]');
      if (target) { event.preventDefault(); event.stopPropagation(); action(target); return; }
      if (event.target.closest('[data-dnd-owner-tab="encounters"],[data-dnd-owner-action="open-encounter"],[data-dnd-owner-action="activate-encounter"]')) win.setTimeout(() => load(true).then(schedule).catch(() => {}), 50);
    }, true);
    if (win.khaos?.onDnd) win.khaos.onDnd(() => { state.payload = null; win.setTimeout(() => load(true).catch(() => {}), 100); });
    state.observer = new win.MutationObserver((records) => {
      if (records.some((record) => [...record.addedNodes].some((node) => node?.nodeType === 1 && (node.matches?.('.dnd-owner-two-column') || node.querySelector?.('.dnd-owner-two-column'))))) schedule();
    });
    state.observer.observe(doc.body, { childList: true, subtree: true });
    schedule();
    win.__khaosDndEncounterPanels = { state, load, enhance };
    return win.__khaosDndEncounterPanels;
  }

  return { install, validatePanelDraft, validateActionDraft, validateCombatantPatch, healthBar };
});
