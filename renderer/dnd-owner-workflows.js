'use strict';

(function bootstrapDndOwnerWorkflows(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) api.install(root);
})(typeof window !== 'undefined' ? window : null, function dndOwnerWorkflowsFactory() {
  const LICENSES = ['srd_cc_by', 'user_authored', 'user_supplied_private', 'metadata_only', 'external_link', 'partner_api', 'unknown_restricted'];
  const FULL_TEXT_LICENSES = new Set(['srd_cc_by', 'user_authored', 'user_supplied_private', 'partner_api']);
  const QUEST_STATUSES = ['draft', 'available', 'active', 'completed', 'failed', 'abandoned', 'archived'];
  const ENCOUNTER_STATUSES = ['draft', 'ready', 'active', 'paused', 'completed', 'archived'];
  const ATTENDANCE = ['attending', 'maybe', 'unavailable', 'late'];
  const SNOWFLAKE = /^\d{5,25}$/;

  const clean = (value, max = 200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback;
  const list = (value) => [...new Set((Array.isArray(value) ? value : String(value || '').split(',')).map((item) => clean(item, 80)).filter(Boolean))];
  const error = (message, field) => Object.assign(new Error(message), { code: 'DND_FORM_VALIDATION', field });

  function validateSourceDraft(input = {}) {
    const name = clean(input.name, 160);
    const licenseType = LICENSES.includes(input.licenseType) ? input.licenseType : 'metadata_only';
    if (!name) throw error('Source name is required.', 'name');
    if (input.isFullTextAllowed && !FULL_TEXT_LICENSES.has(licenseType)) throw error('This license type permits metadata or links only, not full rulebook text.', 'isFullTextAllowed');
    return {
      ...(input.id ? { id: clean(input.id, 100) } : {}), name,
      ruleset: clean(input.ruleset || '5e_2024', 80), sourceVersion: clean(input.sourceVersion, 80), licenseType,
      licenseReference: clean(input.licenseReference, 500), attributionText: clean(input.attributionText, 1000),
      externalReferenceUrl: clean(input.externalReferenceUrl, 800), isFullTextAllowed: Boolean(input.isFullTextAllowed),
      active: input.active !== false
    };
  }

  function validateQuestDraft(input = {}) {
    const campaignId = clean(input.campaignId, 100);
    const title = clean(input.title, 180);
    if (!campaignId) throw error('Select a campaign before saving a quest.', 'campaignId');
    if (!title) throw error('Quest title is required.', 'title');
    return {
      ...(input.id ? { id: clean(input.id, 100) } : {}), campaignId, title,
      summary: clean(input.summary, 4000), gmNotes: clean(input.gmNotes, 8000),
      status: QUEST_STATUSES.includes(input.status) ? input.status : 'draft',
      visibleToPlayers: Boolean(input.visibleToPlayers)
    };
  }

  function validateEncounterDraft(input = {}) {
    const campaignId = clean(input.campaignId, 100);
    const name = clean(input.name, 180);
    if (!campaignId) throw error('Select a campaign before saving an encounter.', 'campaignId');
    if (!name) throw error('Encounter name is required.', 'name');
    return {
      ...(input.id ? { id: clean(input.id, 100) } : {}), campaignId,
      sessionId: clean(input.sessionId, 100), name,
      status: ENCOUNTER_STATUSES.includes(input.status) ? input.status : 'draft',
      round: Math.max(1, number(input.round, 1)), currentTurnIndex: Math.max(0, number(input.currentTurnIndex, 0))
    };
  }

  function validateCombatantDraft(input = {}, character = null) {
    const campaignId = clean(input.campaignId, 100);
    const encounterId = clean(input.encounterId, 100);
    const discordUserId = clean(input.discordUserId, 25);
    const nameSnapshot = clean(input.nameSnapshot || character?.name, 160);
    const hp = input.hp === '' || input.hp === null || input.hp === undefined ? null : number(input.hp);
    const maxHp = input.maxHp === '' || input.maxHp === null || input.maxHp === undefined ? null : number(input.maxHp);
    if (!campaignId) throw error('Combatant campaign is required.', 'campaignId');
    if (!encounterId) throw error('Select an encounter before saving a combatant.', 'encounterId');
    if (!nameSnapshot) throw error('Combatant name is required.', 'nameSnapshot');
    if (discordUserId && !SNOWFLAKE.test(discordUserId)) throw error('Discord user ID must be numeric.', 'discordUserId');
    if (hp !== null && hp < 0 || maxHp !== null && maxHp < 0 || hp !== null && maxHp !== null && hp > maxHp) throw error('Combatant HP must be between 0 and maximum HP.', 'hp');
    return {
      ...(input.id ? { id: clean(input.id, 100) } : {}), campaignId, encounterId,
      characterId: clean(input.characterId || character?.id, 100), npcId: clean(input.npcId, 100), discordUserId,
      nameSnapshot, initiative: number(input.initiative), dexterity: number(input.dexterity), hp, maxHp,
      conditions: list(input.conditions), hidden: Boolean(input.hidden), active: input.active !== false
    };
  }

  function sortCombatants(items = []) {
    return [...items].filter((item) => item.active !== false).sort((a, b) =>
      number(b.initiative) - number(a.initiative) || number(b.dexterity) - number(a.dexterity) || String(a.id).localeCompare(String(b.id))
    );
  }

  function attendanceIdentity(member = {}) {
    return member.userId ? `user:${member.userId}` : member.discordUserId ? `discord:${member.discordUserId}` : `member:${member.id}`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  }

  function install(win) {
    if (!win?.document || win.__khaosDndOwnerWorkflows) return win?.__khaosDndOwnerWorkflows || null;
    const doc = win.document;
    const state = { payload: null, activeTab: '', selectedEncounterId: '', busy: false, scheduled: false };
    const invoke = (channel, payload) => win.khaos.invoke(channel, payload);
    const notify = (message) => typeof win.toast === 'function' && win.toast(message);
    const selectedCampaignId = () => clean(doc.getElementById('dndCampaignSelect')?.value, 100);
    const campaign = () => state.payload?.state?.campaigns?.find((item) => item.id === selectedCampaignId()) || null;
    const items = (key) => (state.payload?.state?.[key] || []).filter((item) => !item.campaignId || item.campaignId === selectedCampaignId());

    function schedule() {
      if (state.scheduled) return;
      state.scheduled = true;
      win.setTimeout(() => { state.scheduled = false; enhance(); }, 0);
    }

    async function refresh() {
      state.payload = await invoke('dnd:get');
      schedule();
      return state.payload;
    }

    function ensureTabs(root) {
      const tabs = root.querySelector('.dnd-tabs');
      if (!tabs) return;
      for (const [id, label] of [['quests', 'Quests'], ['encounters', 'Encounters']]) {
        let button = tabs.querySelector(`[data-dnd-owner-tab="${id}"]`);
        if (!button) {
          button = doc.createElement('button');
          button.className = 'dnd-tab';
          button.dataset.dndOwnerTab = id;
          button.textContent = label;
          const sessions = tabs.querySelector('[data-dnd-tab="sessions"]');
          tabs.insertBefore(button, sessions || null);
        }
        button.classList.toggle('active', state.activeTab === id);
      }
    }

    function questCard(quest) {
      return `<article class="dnd-owner-card"><div><span class="eyebrow">${escapeHtml(quest.status)}</span><h3>${escapeHtml(quest.title)}</h3><p>${escapeHtml(quest.summary || 'No public summary.')}</p><small>${quest.visibleToPlayers ? 'Visible to players' : 'GM only'}${campaign()?.activeQuestId === quest.id ? ' · Active campaign quest' : ''}</small></div><div class="server-actions"><button class="button" data-dnd-owner-action="edit-quest" data-id="${escapeHtml(quest.id)}">Edit</button>${campaign()?.activeQuestId === quest.id ? '' : `<button class="button" data-dnd-owner-action="activate-quest" data-id="${escapeHtml(quest.id)}">Set Active</button>`}</div></article>`;
    }

    function renderQuests(root) {
      const panel = root.querySelector('.dnd-tab-panel');
      if (!panel) return;
      root.querySelectorAll('[data-dnd-tab]').forEach((item) => item.classList.remove('active'));
      const quests = items('quests');
      panel.innerHTML = `<div class="dnd-owner-workflows"><article class="panel"><div class="panel-heading"><div><span class="eyebrow">Campaign progress</span><h3>Quests</h3></div><div class="server-actions"><span class="tag">${quests.length}</span><button class="button primary" data-dnd-owner-action="new-quest">Create Quest</button></div></div><div class="dnd-owner-list">${quests.length ? quests.map(questCard).join('') : '<div class="empty-state"><h3>No quests</h3><p>Create the first campaign quest.</p></div>'}</div></article></div>`;
    }

    function encounterCard(encounter) {
      const combatants = items('combatants').filter((item) => item.encounterId === encounter.id && item.active !== false);
      return `<article class="dnd-owner-card ${encounter.id === state.selectedEncounterId ? 'selected' : ''}"><div><span class="eyebrow">${escapeHtml(encounter.status)}</span><h3>${escapeHtml(encounter.name)}</h3><p>Round ${escapeHtml(encounter.round || 1)} · ${combatants.length} combatants</p></div><div class="server-actions"><button class="button" data-dnd-owner-action="open-encounter" data-id="${escapeHtml(encounter.id)}">Open</button><button class="button" data-dnd-owner-action="edit-encounter" data-id="${escapeHtml(encounter.id)}">Edit</button>${encounter.status === 'active' ? '<span class="tag good">Active</span>' : `<button class="button" data-dnd-owner-action="activate-encounter" data-id="${escapeHtml(encounter.id)}">Activate</button>`}</div></article>`;
    }

    function initiativePanel(encounter) {
      if (!encounter) return '<article class="panel empty-state"><h3>Select an encounter</h3><p>Open an encounter to configure combatants and initiative.</p></article>';
      const order = sortCombatants(items('combatants').filter((item) => item.encounterId === encounter.id));
      const current = order.length ? order[Math.min(Math.max(0, number(encounter.currentTurnIndex)), order.length - 1)] : null;
      return `<article class="panel"><div class="panel-heading"><div><span class="eyebrow">Round ${escapeHtml(encounter.round || 1)}</span><h3>${escapeHtml(encounter.name)} initiative</h3></div><div class="server-actions"><button class="button primary" data-dnd-owner-action="new-combatant" data-id="${escapeHtml(encounter.id)}">Add Combatant</button>${encounter.status === 'active' && order.length ? `<button class="button" data-dnd-owner-action="advance-initiative" data-id="${escapeHtml(encounter.id)}">Next Turn</button>` : ''}</div></div><div class="callout">Stored order is deterministic: initiative, Dexterity, then stable combatant ID. Advancing changes only the current index and round.</div><div class="dnd-owner-list">${order.length ? order.map((item, index) => `<div class="dnd-initiative-row ${current?.id === item.id ? 'current' : ''}"><div><strong>${index + 1}. ${escapeHtml(item.nameSnapshot)}</strong><span>Initiative ${escapeHtml(item.initiative)} · Dex ${escapeHtml(item.dexterity)}${item.hp === null || item.hp === undefined ? '' : ` · HP ${escapeHtml(item.hp)}/${escapeHtml(item.maxHp ?? '?')}`}</span><small>${item.conditions?.length ? escapeHtml(item.conditions.join(', ')) : 'No conditions'}${item.hidden ? ' · GM hidden' : ''}</small></div><div class="server-actions"><button class="button" data-dnd-owner-action="edit-combatant" data-id="${escapeHtml(item.id)}">Edit</button><button class="button danger" data-dnd-owner-action="remove-combatant" data-id="${escapeHtml(item.id)}">Remove</button></div></div>`).join('') : '<p class="dnd-empty">No active combatants.</p>'}</div></article>`;
    }

    function renderEncounters(root) {
      const panel = root.querySelector('.dnd-tab-panel');
      if (!panel) return;
      root.querySelectorAll('[data-dnd-tab]').forEach((item) => item.classList.remove('active'));
      const encounters = items('encounters');
      if (!state.selectedEncounterId && encounters.length) state.selectedEncounterId = encounters.find((item) => item.status === 'active')?.id || encounters[0].id;
      const selected = encounters.find((item) => item.id === state.selectedEncounterId) || null;
      panel.innerHTML = `<div class="dnd-owner-workflows dnd-owner-two-column"><article class="panel"><div class="panel-heading"><div><span class="eyebrow">Combat</span><h3>Encounters</h3></div><button class="button primary" data-dnd-owner-action="new-encounter">Create Encounter</button></div><div class="dnd-owner-list">${encounters.length ? encounters.map(encounterCard).join('') : '<p class="dnd-empty">No encounters.</p>'}</div></article>${initiativePanel(selected)}</div>`;
    }

    function enhanceSources(root) {
      const listRoot = root.querySelector('.dnd-source-list');
      const panel = listRoot?.closest('.panel');
      if (!panel || panel.querySelector('[data-dnd-owner-action="new-source"]')) return;
      const heading = panel.querySelector('.panel-heading');
      const button = doc.createElement('button');
      button.className = 'button primary';
      button.dataset.dndOwnerAction = 'new-source';
      button.textContent = 'Add Source';
      heading?.appendChild(button);
      const sources = state.payload?.state?.sources || [];
      listRoot.querySelectorAll('[data-dnd-source]').forEach((checkbox) => {
        const row = checkbox.closest('label');
        const source = sources.find((item) => item.id === checkbox.dataset.dndSource);
        if (!row || !source || row.querySelector('[data-dnd-owner-action="edit-source"]')) return;
        const edit = doc.createElement('button');
        edit.type = 'button'; edit.className = 'button'; edit.textContent = 'Edit';
        edit.dataset.dndOwnerAction = 'edit-source'; edit.dataset.id = source.id;
        row.appendChild(edit);
      });
    }

    function enhanceAttendance(root) {
      const panel = root.querySelector('.dnd-tab-panel');
      if (!panel || panel.querySelector('.dnd-attendance-editor')) return;
      const sessions = items('sessions').filter((item) => ['planned', 'active'].includes(item.status));
      const members = items('members').filter((item) => item.active !== false);
      if (!sessions.length || !members.length) return;
      const attendance = state.payload?.state?.attendance || [];
      const session = sessions.find((item) => item.status === 'active') || sessions[0];
      const article = doc.createElement('article');
      article.className = 'panel dnd-attendance-editor';
      article.innerHTML = `<div class="panel-heading"><div><span class="eyebrow">Session participation</span><h3>Attendance</h3></div><select id="dndOwnerAttendanceSession">${sessions.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === session.id ? 'selected' : ''}>${escapeHtml(item.title)}</option>`).join('')}</select></div><div class="dnd-owner-list">${members.map((member) => {
        const existing = attendance.find((item) => item.sessionId === session.id && (member.userId && item.userId === member.userId || member.discordUserId && item.discordUserId === member.discordUserId));
        return `<div class="dnd-attendance-row" data-member-id="${escapeHtml(member.id)}"><div><strong>${escapeHtml(member.displayName)}</strong><span>${escapeHtml(member.role)}</span></div><select data-attendance-status>${ATTENDANCE.map((status) => `<option value="${status}" ${(existing?.status || 'maybe') === status ? 'selected' : ''}>${status}</option>`).join('')}</select><input data-attendance-note value="${escapeHtml(existing?.note || '')}" maxlength="500" placeholder="Optional note"></div>`;
      }).join('')}</div><div class="form-actions"><button class="button primary" data-dnd-owner-action="save-attendance">Save Attendance</button></div>`;
      panel.appendChild(article);
    }

    function enhance() {
      const root = doc.getElementById('view-dnd');
      if (!root || !state.payload) return;
      ensureTabs(root);
      if (state.activeTab === 'quests') renderQuests(root);
      else if (state.activeTab === 'encounters') renderEncounters(root);
      else {
        const baseTab = root.querySelector('[data-dnd-tab].active')?.dataset.dndTab;
        if (baseTab === 'sources') enhanceSources(root);
        if (baseTab === 'sessions') enhanceAttendance(root);
      }
    }

    function closeModal() { doc.getElementById('dndOwnerModal')?.remove(); }
    function showModal(title, body, action, label = 'Save') {
      closeModal();
      const node = doc.createElement('div');
      node.id = 'dndOwnerModal'; node.className = 'dnd-owner-modal-backdrop';
      node.innerHTML = `<section class="dnd-owner-modal" role="dialog" aria-modal="true"><div class="panel-heading"><div><span class="eyebrow">D&D Owner tools</span><h2>${escapeHtml(title)}</h2></div><button class="button" data-dnd-owner-action="close-modal">Close</button></div><div class="dnd-owner-modal-error" hidden></div>${body}<div class="form-actions"><button class="button" data-dnd-owner-action="close-modal">Cancel</button><button class="button primary" data-dnd-owner-action="${action}">${escapeHtml(label)}</button></div></section>`;
      doc.body.appendChild(node); node.querySelector('input,select,textarea')?.focus();
    }
    function modalError(value) { const node = doc.querySelector('.dnd-owner-modal-error'); if (node) { node.hidden = false; node.textContent = value?.message || String(value); if (value?.field) doc.querySelector(`[name="${value.field}"]`)?.focus(); } }
    function formData(id) { const form = doc.getElementById(id); const result = Object.fromEntries(new win.FormData(form).entries()); for (const checkbox of form.querySelectorAll('input[type="checkbox"]')) result[checkbox.name] = checkbox.checked; return result; }

    function sourceModal(source = {}) {
      showModal(source.id ? 'Edit source' : 'Add source', `<form id="dndOwnerSourceForm"><input type="hidden" name="id" value="${escapeHtml(source.id || '')}"><label>Name<input name="name" value="${escapeHtml(source.name || '')}" maxlength="160"></label><div class="form-grid"><label>Ruleset<input name="ruleset" value="${escapeHtml(source.ruleset || '5e_2024')}"></label><label>Version<input name="sourceVersion" value="${escapeHtml(source.sourceVersion || '')}"></label></div><label>License type<select name="licenseType">${LICENSES.map((item) => `<option value="${item}" ${source.licenseType === item ? 'selected' : ''}>${item}</option>`).join('')}</select></label><label>License reference<input name="licenseReference" value="${escapeHtml(source.licenseReference || '')}"></label><label>Attribution<textarea name="attributionText" rows="3">${escapeHtml(source.attributionText || '')}</textarea></label><label>External reference URL<input name="externalReferenceUrl" value="${escapeHtml(source.externalReferenceUrl || '')}"></label><label class="toggle-row"><span><strong>Full text permitted</strong><small>Enable only for licensed, user-authored, user-supplied private, partner API, or CC-BY content.</small></span><input type="checkbox" name="isFullTextAllowed" ${source.isFullTextAllowed ? 'checked' : ''}></label></form>`, 'save-source');
    }

    function questModal(quest = {}) {
      showModal(quest.id ? 'Edit quest' : 'Create quest', `<form id="dndOwnerQuestForm"><input type="hidden" name="id" value="${escapeHtml(quest.id || '')}"><input type="hidden" name="campaignId" value="${escapeHtml(selectedCampaignId())}"><label>Title<input name="title" value="${escapeHtml(quest.title || '')}"></label><label>Player summary<textarea name="summary" rows="4">${escapeHtml(quest.summary || '')}</textarea></label><label>GM notes<textarea name="gmNotes" rows="5">${escapeHtml(quest.gmNotes || '')}</textarea></label><div class="form-grid"><label>Status<select name="status">${QUEST_STATUSES.map((item) => `<option value="${item}" ${quest.status === item ? 'selected' : ''}>${item}</option>`).join('')}</select></label><label class="toggle-row"><span>Visible to players</span><input type="checkbox" name="visibleToPlayers" ${quest.visibleToPlayers ? 'checked' : ''}></label></div></form>`, 'save-quest');
    }

    function encounterModal(encounter = {}) {
      const sessions = items('sessions');
      showModal(encounter.id ? 'Edit encounter' : 'Create encounter', `<form id="dndOwnerEncounterForm"><input type="hidden" name="id" value="${escapeHtml(encounter.id || '')}"><input type="hidden" name="campaignId" value="${escapeHtml(selectedCampaignId())}"><label>Name<input name="name" value="${escapeHtml(encounter.name || '')}"></label><div class="form-grid"><label>Session<select name="sessionId"><option value="">No linked session</option>${sessions.map((item) => `<option value="${escapeHtml(item.id)}" ${encounter.sessionId === item.id ? 'selected' : ''}>${escapeHtml(item.title)}</option>`).join('')}</select></label><label>Status<select name="status">${ENCOUNTER_STATUSES.map((item) => `<option value="${item}" ${encounter.status === item ? 'selected' : ''}>${item}</option>`).join('')}</select></label></div></form>`, 'save-encounter');
    }

    function combatantModal(encounterId, combatant = {}) {
      const characters = items('characters');
      showModal(combatant.id ? 'Edit combatant' : 'Add combatant', `<form id="dndOwnerCombatantForm"><input type="hidden" name="id" value="${escapeHtml(combatant.id || '')}"><input type="hidden" name="campaignId" value="${escapeHtml(selectedCampaignId())}"><input type="hidden" name="encounterId" value="${escapeHtml(encounterId)}"><label>Campaign character<select name="characterId"><option value="">Manual combatant</option>${characters.map((item) => `<option value="${escapeHtml(item.id)}" ${combatant.characterId === item.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label><label>Name<input name="nameSnapshot" value="${escapeHtml(combatant.nameSnapshot || '')}" placeholder="Filled from character when selected"></label><div class="form-grid three"><label>Initiative<input name="initiative" type="number" value="${escapeHtml(combatant.initiative ?? 0)}"></label><label>Dexterity<input name="dexterity" type="number" value="${escapeHtml(combatant.dexterity ?? 0)}"></label><label>Discord user ID<input name="discordUserId" value="${escapeHtml(combatant.discordUserId || '')}" inputmode="numeric"></label></div><div class="form-grid"><label>HP<input name="hp" type="number" min="0" value="${escapeHtml(combatant.hp ?? '')}"></label><label>Maximum HP<input name="maxHp" type="number" min="0" value="${escapeHtml(combatant.maxHp ?? '')}"></label></div><label>Conditions<input name="conditions" value="${escapeHtml((combatant.conditions || []).join(', '))}"></label><label class="toggle-row"><span>Hide from players</span><input type="checkbox" name="hidden" ${combatant.hidden ? 'checked' : ''}></label></form>`, 'save-combatant');
    }

    async function busy(button, operation) { if (state.busy) return; state.busy = true; const label = button?.textContent; if (button) { button.disabled = true; button.textContent = 'Saving…'; } try { await operation(); } catch (err) { modalError(err); } finally { state.busy = false; if (button) { button.disabled = false; button.textContent = label; } } }

    async function saveSource(button) { await busy(button, async () => { state.payload = await invoke('dnd:source-save', validateSourceDraft(formData('dndOwnerSourceForm'))); closeModal(); notify('Source saved.'); schedule(); }); }
    async function saveQuest(button) { await busy(button, async () => { state.payload = await invoke('dnd:quest-save', validateQuestDraft(formData('dndOwnerQuestForm'))); closeModal(); state.activeTab = 'quests'; notify('Quest saved.'); schedule(); }); }
    async function saveEncounterForm(button) { await busy(button, async () => { const draft = validateEncounterDraft(formData('dndOwnerEncounterForm')); state.payload = await invoke('dnd:encounter-save', draft); state.selectedEncounterId = draft.id || state.payload.state.encounters.at(-1)?.id || ''; closeModal(); state.activeTab = 'encounters'; notify('Encounter saved.'); schedule(); }); }
    async function saveCombatantForm(button) { await busy(button, async () => { const draft = formData('dndOwnerCombatantForm'); const character = items('characters').find((item) => item.id === draft.characterId); state.payload = await invoke('dnd:combatant-save', validateCombatantDraft(draft, character)); closeModal(); state.activeTab = 'encounters'; notify('Combatant saved.'); schedule(); }); }

    async function saveAttendance() {
      const sessionId = doc.getElementById('dndOwnerAttendanceSession')?.value;
      const session = items('sessions').find((item) => item.id === sessionId);
      if (!session) throw new Error('Select a session.');
      const members = items('members').filter((item) => item.active !== false);
      const rows = [...doc.querySelectorAll('.dnd-attendance-row')].map((row) => {
        const member = members.find((item) => item.id === row.dataset.memberId);
        return { campaignId: selectedCampaignId(), sessionId, userId: member?.userId || '', discordUserId: member?.discordUserId || '', status: row.querySelector('[data-attendance-status]').value, note: row.querySelector('[data-attendance-note]').value };
      });
      for (const record of rows) state.payload = await invoke('dnd:attendance-save', record);
      notify('Attendance saved.'); schedule();
    }

    async function handleClick(event) {
      const tab = event.target.closest?.('[data-dnd-owner-tab]');
      if (tab) { event.preventDefault(); event.stopImmediatePropagation(); state.activeTab = tab.dataset.dndOwnerTab; schedule(); return; }
      if (event.target.closest?.('[data-dnd-tab]')) state.activeTab = '';
      const button = event.target.closest?.('[data-dnd-owner-action]');
      if (!button) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const action = button.dataset.dndOwnerAction;
      const id = button.dataset.id;
      try {
        if (action === 'close-modal') return closeModal();
        if (action === 'new-source') return sourceModal();
        if (action === 'edit-source') return sourceModal(state.payload.state.sources.find((item) => item.id === id));
        if (action === 'save-source') return saveSource(button);
        if (action === 'new-quest') return questModal();
        if (action === 'edit-quest') return questModal(items('quests').find((item) => item.id === id));
        if (action === 'save-quest') return saveQuest(button);
        if (action === 'activate-quest') { const current = campaign(); state.payload = await invoke('dnd:campaign-save', { ...current, activeQuestId: id }); notify('Active quest updated.'); state.activeTab = 'quests'; return schedule(); }
        if (action === 'new-encounter') return encounterModal();
        if (action === 'edit-encounter') return encounterModal(items('encounters').find((item) => item.id === id));
        if (action === 'save-encounter') return saveEncounterForm(button);
        if (action === 'open-encounter') { state.selectedEncounterId = id; state.activeTab = 'encounters'; return schedule(); }
        if (action === 'activate-encounter') { const value = items('encounters').find((item) => item.id === id); state.payload = await invoke('dnd:encounter-save', { ...value, status: 'active' }); state.selectedEncounterId = id; state.activeTab = 'encounters'; notify('Encounter activated.'); return schedule(); }
        if (action === 'new-combatant') return combatantModal(id);
        if (action === 'edit-combatant') { const value = items('combatants').find((item) => item.id === id); return combatantModal(value.encounterId, value); }
        if (action === 'save-combatant') return saveCombatantForm(button);
        if (action === 'remove-combatant') { if (!win.confirm('Remove this combatant from active initiative?')) return; state.payload = await invoke('dnd:combatant-remove', { combatantId: id }); notify('Combatant removed.'); state.activeTab = 'encounters'; return schedule(); }
        if (action === 'advance-initiative') { const response = await invoke('dnd:encounter-advance', { encounterId: id }); state.payload = response.state; notify(`Initiative advanced to ${response.result.currentCombatant?.nameSnapshot || 'next combatant'}.`); state.activeTab = 'encounters'; return schedule(); }
        if (action === 'save-attendance') return saveAttendance();
      } catch (err) { modalError(err); notify(err.message || String(err)); }
    }

    doc.addEventListener('click', handleClick, true);
    doc.addEventListener('change', (event) => {
      if (event.target?.id === 'dndCampaignSelect') { state.activeTab = ''; state.selectedEncounterId = ''; schedule(); }
      if (event.target?.id === 'dndOwnerAttendanceSession') {
        doc.querySelector('.dnd-attendance-editor')?.remove(); schedule();
      }
    }, true);
    if (typeof win.MutationObserver === 'function') {
      const observer = new win.MutationObserver((records) => {
        const relevant = records.some((record) => record.type === 'childList' && !record.target?.closest?.('.dnd-owner-workflows, .dnd-owner-modal, .dnd-attendance-editor') && [...record.addedNodes].some((node) => node.nodeType === 1 && (node.matches?.('.dnd-tabs,.dnd-tab-panel,.dnd-source-list') || node.querySelector?.('.dnd-tabs,.dnd-tab-panel,.dnd-source-list'))));
        if (relevant) schedule();
      });
      observer.observe(doc.documentElement, { childList: true, subtree: true });
      state.observer = observer;
    }
    if (win.khaos?.onDnd) win.khaos.onDnd((payload) => { state.payload = payload; schedule(); });
    refresh().catch((err) => notify(err.message || String(err)));
    const api = { state, refresh, enhance };
    win.__khaosDndOwnerWorkflows = api;
    return api;
  }

  return {
    LICENSES, FULL_TEXT_LICENSES, QUEST_STATUSES, ENCOUNTER_STATUSES, ATTENDANCE,
    validateSourceDraft, validateQuestDraft, validateEncounterDraft, validateCombatantDraft,
    sortCombatants, attendanceIdentity, install
  };
});
