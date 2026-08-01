'use strict';

(function bootstrapDndWorldContent(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) api.install(root);
})(typeof window !== 'undefined' ? window : null, function dndWorldContentFactory() {
  const WORLD_TYPES = ['npc', 'location', 'faction'];
  const CONTENT_ORIGINS = ['srd', 'user_authored', 'user_supplied_private', 'metadata_only', 'external_link', 'partner_api'];
  const HOMEBREW_STATUSES = ['draft', 'submitted', 'under_review', 'changes_requested', 'approved', 'rejected', 'retired'];
  const CONTENT_TYPES = ['reference', 'spell', 'cantrip', 'item', 'class', 'subclass', 'species', 'background', 'feat', 'monster', 'rule', 'other'];

  const clean = (value, max = 200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const numeric = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const fail = (message, field) => Object.assign(new Error(message), { code: 'DND_FORM_VALIDATION', field });

  function validateWorldDraft(input = {}) {
    const type = WORLD_TYPES.includes(input.type) ? input.type : 'npc';
    const campaignId = clean(input.campaignId, 100);
    const name = clean(input.name, 180);
    if (!campaignId) throw fail('Select a campaign before saving a world record.', 'campaignId');
    if (!name) throw fail('Name is required.', 'name');
    return {
      ...(input.id ? { id: clean(input.id, 100) } : {}), type, campaignId, name,
      publicSummary: clean(input.publicSummary, 5000), gmNotes: clean(input.gmNotes, 12000),
      revealed: Boolean(input.revealed)
    };
  }

  function validateLootDraft(input = {}) {
    const campaignId = clean(input.campaignId, 100);
    const name = clean(input.name, 180);
    const quantity = numeric(input.quantity, 1);
    if (!campaignId) throw fail('Select a campaign before saving loot.', 'campaignId');
    if (!name) throw fail('Loot name is required.', 'name');
    if (!(quantity > 0)) throw fail('Quantity must be greater than zero.', 'quantity');
    return {
      ...(input.id ? { id: clean(input.id, 100) } : {}), campaignId, name, quantity,
      shared: Boolean(input.shared), gmOnly: Boolean(input.gmOnly),
      assignedCharacterId: clean(input.assignedCharacterId, 100), active: input.active !== false
    };
  }

  function validateContentDraft(input = {}) {
    const name = clean(input.name, 180);
    if (!name) throw fail('Content name is required.', 'name');
    return {
      ...(input.id ? { id: clean(input.id, 100) } : {}),
      campaignId: clean(input.campaignId, 100), sourceId: clean(input.sourceId, 100),
      contentType: clean(input.contentType || 'reference', 80), name,
      summary: clean(input.summary, 8000), fullText: String(input.fullText || '').trim().slice(0, 50000),
      contentOrigin: CONTENT_ORIGINS.includes(input.contentOrigin) ? input.contentOrigin : 'metadata_only',
      externalReferenceUrl: clean(input.externalReferenceUrl, 800), active: input.active !== false
    };
  }

  function parseDetails(value) {
    const text = String(value || '').trim();
    if (!text) return {};
    try {
      const parsed = JSON.parse(text);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Details JSON must be an object.');
      return parsed;
    } catch (error) {
      throw fail(`Additional details must be valid JSON: ${error.message}`, 'details');
    }
  }

  function validateHomebrewDraft(input = {}) {
    const campaignId = clean(input.campaignId, 100);
    const name = clean(input.name, 180);
    if (!campaignId) throw fail('Select a campaign before saving homebrew.', 'campaignId');
    if (!name) throw fail('Homebrew name is required.', 'name');
    return {
      ...(input.id ? { id: clean(input.id, 100) } : {}), campaignId,
      entryId: clean(input.entryId, 100), authorUserId: clean(input.authorUserId, 100),
      contentType: clean(input.contentType || 'other', 80), name,
      status: HOMEBREW_STATUSES.includes(input.status) ? input.status : 'draft',
      body: { description: clean(input.description, 20000), ...parseDetails(input.details) },
      reviewNotes: clean(input.reviewNotes, 8000)
    };
  }

  function validateRollDraft(input = {}) {
    const campaignId = clean(input.campaignId, 100);
    const expression = clean(input.expression, 80);
    if (!campaignId) throw fail('Select a campaign before rolling.', 'campaignId');
    if (!expression) throw fail('Enter a dice expression.', 'expression');
    return {
      campaignId, expression,
      privacy: input.privacy === 'dm_only' ? 'dm_only' : 'public',
      characterId: clean(input.characterId, 100), sessionId: clean(input.sessionId, 100)
    };
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
  }

  function install(win) {
    if (!win?.document || win.__khaosDndWorldContent) return win?.__khaosDndWorldContent || null;
    const doc = win.document;
    const state = { payload: null, activeTab: '', worldType: 'npc', busy: false, scheduled: false, lastRoll: null };
    const invoke = (channel, payload) => win.khaos.invoke(channel, payload);
    const notify = (message) => typeof win.toast === 'function' && win.toast(message);
    const campaignId = () => clean(doc.getElementById('dndCampaignSelect')?.value, 100);
    const dnd = () => state.payload?.state || {};
    const campaignItems = (key) => (dnd()[key] || []).filter((item) => !item.campaignId || item.campaignId === campaignId());

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
      for (const [id, label] of [['world', 'World'], ['loot', 'Loot'], ['library', 'Library'], ['dice', 'Dice']]) {
        let button = tabs.querySelector(`[data-dnd-world-tab="${id}"]`);
        if (!button) {
          button = doc.createElement('button');
          button.className = 'dnd-tab';
          button.dataset.dndWorldTab = id;
          button.textContent = label;
          tabs.appendChild(button);
        }
        button.classList.toggle('active', state.activeTab === id);
      }
    }

    function worldCollection(type) {
      return type === 'npc' ? 'npcs' : type === 'location' ? 'locations' : 'factions';
    }

    function worldCard(item) {
      return `<article class="dnd-world-card"><div><span class="eyebrow">${item.revealed ? 'Revealed' : 'GM hidden'}</span><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.publicSummary || 'No public summary.')}</p><small>${item.gmNotes ? 'GM notes stored' : 'No GM notes'}</small></div><div class="server-actions"><button class="button" data-dnd-world-action="edit-world" data-type="${escapeHtml(item.type || state.worldType)}" data-id="${escapeHtml(item.id)}">Edit</button><button class="button" data-dnd-world-action="toggle-world-reveal" data-type="${escapeHtml(item.type || state.worldType)}" data-id="${escapeHtml(item.id)}">${item.revealed ? 'Hide' : 'Reveal'}</button></div></article>`;
    }

    function renderWorld(root) {
      const panel = root.querySelector('.dnd-tab-panel');
      if (!panel) return;
      root.querySelectorAll('[data-dnd-tab],[data-dnd-owner-tab]').forEach((item) => item.classList.remove('active'));
      const items = campaignItems(worldCollection(state.worldType));
      panel.innerHTML = `<div class="dnd-world-content"><article class="panel"><div class="panel-heading"><div><span class="eyebrow">Campaign setting</span><h3>World records</h3></div><div class="server-actions"><select id="dndWorldType">${WORLD_TYPES.map((type) => `<option value="${type}" ${state.worldType === type ? 'selected' : ''}>${type === 'npc' ? 'NPCs' : `${type[0].toUpperCase()}${type.slice(1)}s`}</option>`).join('')}</select><button class="button primary" data-dnd-world-action="new-world">Create ${escapeHtml(state.worldType)}</button></div></div><div class="callout">Player-facing summaries and reveal state are separate from GM-only notes.</div><div class="dnd-world-list">${items.length ? items.map(worldCard).join('') : `<div class="empty-state"><h3>No ${escapeHtml(state.worldType)} records</h3><p>Create the first record for this campaign.</p></div>`}</div></article></div>`;
    }

    function lootCard(item) {
      const character = campaignItems('characters').find((entry) => entry.id === item.assignedCharacterId);
      return `<article class="dnd-world-card"><div><span class="eyebrow">${item.gmOnly ? 'GM only' : item.shared ? 'Shared' : character ? `Assigned to ${escapeHtml(character.name)}` : 'Unassigned'}</span><h3>${escapeHtml(item.name)}</h3><p>Quantity: ${escapeHtml(item.quantity)}</p></div><div class="server-actions"><button class="button" data-dnd-world-action="edit-loot" data-id="${escapeHtml(item.id)}">Edit</button><button class="button danger" data-dnd-world-action="archive-loot" data-id="${escapeHtml(item.id)}">Archive</button></div></article>`;
    }

    function renderLoot(root) {
      const panel = root.querySelector('.dnd-tab-panel');
      if (!panel) return;
      root.querySelectorAll('[data-dnd-tab],[data-dnd-owner-tab]').forEach((item) => item.classList.remove('active'));
      const loot = campaignItems('loot').filter((item) => item.active !== false);
      panel.innerHTML = `<div class="dnd-world-content"><article class="panel"><div class="panel-heading"><div><span class="eyebrow">Campaign inventory</span><h3>Loot</h3></div><button class="button primary" data-dnd-world-action="new-loot">Add Loot</button></div><div class="dnd-world-list">${loot.length ? loot.map(lootCard).join('') : '<div class="empty-state"><h3>No campaign loot</h3><p>Add shared, assigned, or GM-only loot.</p></div>'}</div></article></div>`;
    }

    function contentCard(item) {
      const source = (dnd().sources || []).find((entry) => entry.id === item.sourceId);
      return `<article class="dnd-world-card"><div><span class="eyebrow">${escapeHtml(item.contentOrigin || 'metadata_only')} · ${escapeHtml(item.contentType || 'reference')}</span><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.summary || 'No summary.')}</p><small>${source ? `Source: ${escapeHtml(source.name)}` : 'No source'} · ${item.fullText ? 'Full text stored' : 'Metadata/link only'}</small></div><button class="button" data-dnd-world-action="edit-content" data-id="${escapeHtml(item.id)}">Edit</button></article>`;
    }

    function homebrewActions(item) {
      if (item.status === 'draft') return `<button class="button" data-dnd-world-action="edit-homebrew" data-id="${item.id}">Edit</button><button class="button primary" data-dnd-world-action="transition-homebrew" data-status="submitted" data-id="${item.id}">Submit</button>`;
      if (['submitted', 'under_review'].includes(item.status)) return `<button class="button" data-dnd-world-action="transition-homebrew" data-status="under_review" data-id="${item.id}">Review</button><button class="button primary" data-dnd-world-action="transition-homebrew" data-status="approved" data-id="${item.id}">Approve</button><button class="button" data-dnd-world-action="transition-homebrew" data-status="changes_requested" data-id="${item.id}">Request Changes</button><button class="button danger" data-dnd-world-action="transition-homebrew" data-status="rejected" data-id="${item.id}">Reject</button>`;
      if (['changes_requested', 'rejected'].includes(item.status)) return `<button class="button" data-dnd-world-action="edit-homebrew" data-id="${item.id}">Edit</button><button class="button primary" data-dnd-world-action="transition-homebrew" data-status="submitted" data-id="${item.id}">Resubmit</button>`;
      if (item.status === 'approved') return `<button class="button" data-dnd-world-action="edit-homebrew" data-id="${item.id}">New Revision</button><button class="button danger" data-dnd-world-action="transition-homebrew" data-status="retired" data-id="${item.id}">Retire</button>`;
      return '';
    }

    function homebrewCard(item) {
      return `<article class="dnd-world-card"><div><span class="eyebrow">${escapeHtml(item.status)} · Revision ${escapeHtml(item.revision || 1)}</span><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.body?.description || 'No description.')}</p><small>${item.approvedAt ? `Approved ${escapeHtml(item.approvedAt)}` : item.submittedSnapshot ? 'Submitted snapshot preserved' : 'Draft'}</small></div><div class="server-actions">${homebrewActions(item)}</div></article>`;
    }

    function renderLibrary(root) {
      const panel = root.querySelector('.dnd-tab-panel');
      if (!panel) return;
      root.querySelectorAll('[data-dnd-tab],[data-dnd-owner-tab]').forEach((item) => item.classList.remove('active'));
      const content = (dnd().contentEntries || []).filter((item) => item.active !== false && (!item.campaignId || item.campaignId === campaignId()));
      const homebrew = campaignItems('homebrew');
      panel.innerHTML = `<div class="dnd-world-content dnd-world-two-column"><article class="panel"><div class="panel-heading"><div><span class="eyebrow">Licensed references</span><h3>Content library</h3></div><button class="button primary" data-dnd-world-action="new-content">Add Content</button></div><div class="callout">No paid rulebook content is included. Full text requires a source and an explicitly permitted license/origin.</div><div class="dnd-world-list">${content.length ? content.map(contentCard).join('') : '<p class="dnd-empty">No content entries.</p>'}</div></article><article class="panel"><div class="panel-heading"><div><span class="eyebrow">Campaign-created material</span><h3>Homebrew</h3></div><button class="button primary" data-dnd-world-action="new-homebrew">Create Homebrew</button></div><div class="callout">Approved revisions remain immutable. Editing approved homebrew creates a new draft revision.</div><div class="dnd-world-list">${homebrew.length ? homebrew.map(homebrewCard).join('') : '<p class="dnd-empty">No homebrew records.</p>'}</div></article></div>`;
    }

    function rollCard(item) {
      const character = campaignItems('characters').find((entry) => entry.id === item.characterId);
      return `<div class="dnd-roll-history"><div><strong>${escapeHtml(item.normalizedExpression || item.expression)}</strong><span>${escapeHtml((item.rolls || item.individualRolls || []).join(', '))}${item.modifier ? ` ${item.modifier > 0 ? '+' : ''}${escapeHtml(item.modifier)}` : ''}</span><small>${character ? escapeHtml(character.name) : 'No character'} · ${escapeHtml(item.privacy || 'public')} · ${escapeHtml(item.createdAt || '')}</small></div><b>${escapeHtml(item.total)}</b></div>`;
    }

    function renderDice(root) {
      const panel = root.querySelector('.dnd-tab-panel');
      if (!panel) return;
      root.querySelectorAll('[data-dnd-tab],[data-dnd-owner-tab]').forEach((item) => item.classList.remove('active'));
      const characters = campaignItems('characters').filter((item) => item.status !== 'retired');
      const sessions = campaignItems('sessions');
      const rolls = campaignItems('rolls').slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 50);
      panel.innerHTML = `<div class="dnd-world-content dnd-world-two-column"><article class="panel"><div class="panel-heading"><div><span class="eyebrow">Secure local roller</span><h3>Roll dice</h3></div></div><div class="callout">Uses the same strict parser and cryptographic roller as Discord. Blind rolls are unavailable here because they require a verified Discord DM destination.</div><form id="dndDesktopRollForm"><input type="hidden" name="campaignId" value="${escapeHtml(campaignId())}"><label>Expression<input name="expression" value="d20" placeholder="2d20kh1+5"></label><div class="form-grid"><label>Privacy<select name="privacy"><option value="public">Public record</option><option value="dm_only">Local DM-only record</option></select></label><label>Character<select name="characterId"><option value="">None</option>${characters.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')}</select></label></div><label>Session<select name="sessionId"><option value="">None</option>${sessions.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>`).join('')}</select></label><div class="form-actions"><button class="button primary" data-dnd-world-action="roll-dice">Roll</button></div></form>${state.lastRoll ? `<div class="dnd-roll-result"><span>Result</span><strong>${escapeHtml(state.lastRoll.total)}</strong><small>${escapeHtml(state.lastRoll.normalizedExpression)} · [${escapeHtml((state.lastRoll.rolls || []).join(', '))}]</small></div>` : ''}</article><article class="panel"><div class="panel-heading"><div><span class="eyebrow">Persisted campaign activity</span><h3>Roll history</h3></div><span class="tag">${rolls.length}</span></div><div class="dnd-world-list">${rolls.length ? rolls.map(rollCard).join('') : '<p class="dnd-empty">No recorded rolls.</p>'}</div></article></div>`;
    }

    function enhance() {
      const root = doc.getElementById('view-dnd');
      if (!root || !state.payload) return;
      ensureTabs(root);
      if (state.activeTab === 'world') renderWorld(root);
      if (state.activeTab === 'loot') renderLoot(root);
      if (state.activeTab === 'library') renderLibrary(root);
      if (state.activeTab === 'dice') renderDice(root);
    }

    function closeModal() { doc.getElementById('dndWorldModal')?.remove(); }
    function showModal(title, body, action, label = 'Save') {
      closeModal();
      const node = doc.createElement('div');
      node.id = 'dndWorldModal'; node.className = 'dnd-world-modal-backdrop';
      node.innerHTML = `<section class="dnd-world-modal" role="dialog" aria-modal="true"><div class="panel-heading"><div><span class="eyebrow">D&D Owner tools</span><h2>${escapeHtml(title)}</h2></div><button class="button" data-dnd-world-action="close-modal">Close</button></div><div class="dnd-world-modal-error" hidden></div>${body}<div class="form-actions"><button class="button" data-dnd-world-action="close-modal">Cancel</button><button class="button primary" data-dnd-world-action="${action}">${escapeHtml(label)}</button></div></section>`;
      doc.body.appendChild(node); node.querySelector('input,select,textarea')?.focus();
    }
    function modalError(value) { const node = doc.querySelector('.dnd-world-modal-error'); if (node) { node.hidden = false; node.textContent = value?.message || String(value); if (value?.field) doc.querySelector(`[name="${value.field}"]`)?.focus(); } }
    function formObject(id) { const form = doc.getElementById(id); const result = Object.fromEntries(new win.FormData(form).entries()); for (const checkbox of form.querySelectorAll('input[type="checkbox"]')) result[checkbox.name] = checkbox.checked; return result; }

    function worldModal(type, value = {}) {
      showModal(value.id ? `Edit ${type}` : `Create ${type}`, `<form id="dndWorldRecordForm"><input type="hidden" name="id" value="${escapeHtml(value.id || '')}"><input type="hidden" name="type" value="${escapeHtml(type)}"><input type="hidden" name="campaignId" value="${escapeHtml(campaignId())}"><label>Name<input name="name" value="${escapeHtml(value.name || '')}"></label><label>Player-facing summary<textarea name="publicSummary" rows="4">${escapeHtml(value.publicSummary || '')}</textarea></label><label>GM notes<textarea name="gmNotes" rows="5">${escapeHtml(value.gmNotes || '')}</textarea></label><label class="toggle-row"><span>Revealed to players</span><input type="checkbox" name="revealed" ${value.revealed ? 'checked' : ''}></label></form>`, 'save-world');
    }

    function lootModal(value = {}) {
      const characters = campaignItems('characters');
      showModal(value.id ? 'Edit loot' : 'Add loot', `<form id="dndLootForm"><input type="hidden" name="id" value="${escapeHtml(value.id || '')}"><input type="hidden" name="campaignId" value="${escapeHtml(campaignId())}"><input type="hidden" name="active" value="${value.active === false ? 'false' : 'true'}"><label>Name<input name="name" value="${escapeHtml(value.name || '')}"></label><div class="form-grid"><label>Quantity<input name="quantity" type="number" min="0.01" step="any" value="${escapeHtml(value.quantity ?? 1)}"></label><label>Assigned character<select name="assignedCharacterId"><option value="">None</option>${characters.map((item) => `<option value="${escapeHtml(item.id)}" ${value.assignedCharacterId === item.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label></div><div class="dnd-check-grid"><label><input type="checkbox" name="shared" ${value.shared !== false ? 'checked' : ''}> Shared campaign loot</label><label><input type="checkbox" name="gmOnly" ${value.gmOnly ? 'checked' : ''}> GM only</label></div></form>`, 'save-loot');
    }

    function contentModal(value = {}) {
      const sources = dnd().sources || [];
      showModal(value.id ? 'Edit content entry' : 'Add content entry', `<form id="dndContentForm"><input type="hidden" name="id" value="${escapeHtml(value.id || '')}"><input type="hidden" name="campaignId" value="${escapeHtml(campaignId())}"><label>Name<input name="name" value="${escapeHtml(value.name || '')}"></label><div class="form-grid"><label>Type<select name="contentType">${CONTENT_TYPES.map((item) => `<option value="${item}" ${value.contentType === item ? 'selected' : ''}>${item}</option>`).join('')}</select></label><label>Source<select name="sourceId"><option value="">No source / metadata only</option>${sources.map((item) => `<option value="${escapeHtml(item.id)}" ${value.sourceId === item.id ? 'selected' : ''}>${escapeHtml(item.name)} · ${escapeHtml(item.licenseType)}</option>`).join('')}</select></label></div><label>Content origin<select name="contentOrigin">${CONTENT_ORIGINS.map((item) => `<option value="${item}" ${(value.contentOrigin || 'metadata_only') === item ? 'selected' : ''}>${item}</option>`).join('')}</select></label><label>Summary<textarea name="summary" rows="4">${escapeHtml(value.summary || '')}</textarea></label><label>External reference URL<input name="externalReferenceUrl" value="${escapeHtml(value.externalReferenceUrl || '')}"></label><label>Full text<textarea name="fullText" rows="8" placeholder="Allowed only when source license and origin permit it">${escapeHtml(value.fullText || '')}</textarea></label></form>`, 'save-content');
    }

    function homebrewModal(value = {}) {
      const description = value.body?.description || '';
      const details = value.body ? { ...value.body } : {};
      delete details.description;
      showModal(value.id ? (value.status === 'approved' ? 'Create homebrew revision' : 'Edit homebrew') : 'Create homebrew', `<form id="dndHomebrewForm"><input type="hidden" name="id" value="${escapeHtml(value.id || '')}"><input type="hidden" name="entryId" value="${escapeHtml(value.entryId || '')}"><input type="hidden" name="campaignId" value="${escapeHtml(campaignId())}"><input type="hidden" name="status" value="${escapeHtml(value.status || 'draft')}"><label>Name<input name="name" value="${escapeHtml(value.name || '')}"></label><div class="form-grid"><label>Content type<select name="contentType">${CONTENT_TYPES.map((item) => `<option value="${item}" ${value.contentType === item ? 'selected' : ''}>${item}</option>`).join('')}</select></label><label>Author Nexus user ID<input name="authorUserId" value="${escapeHtml(value.authorUserId || '')}"></label></div><label>Description<textarea name="description" rows="6">${escapeHtml(description)}</textarea></label><label>Additional details JSON<textarea name="details" rows="6" placeholder='{"damage":"1d8"}'>${escapeHtml(Object.keys(details).length ? JSON.stringify(details, null, 2) : '')}</textarea></label><label>Review notes<textarea name="reviewNotes" rows="3">${escapeHtml(value.reviewNotes || '')}</textarea></label></form>`, 'save-homebrew');
    }

    async function busy(button, operation) { if (state.busy) return; state.busy = true; const text = button?.textContent; if (button) { button.disabled = true; button.textContent = 'Saving…'; } try { await operation(); } catch (error) { modalError(error); notify(error.message || String(error)); } finally { state.busy = false; if (button) { button.disabled = false; button.textContent = text; } } }

    async function saveWorld(button) { await busy(button, async () => { state.payload = await invoke('dnd:world-save', validateWorldDraft(formObject('dndWorldRecordForm'))); closeModal(); notify('World record saved.'); state.activeTab = 'world'; schedule(); }); }
    async function saveLoot(button) { await busy(button, async () => { const raw = formObject('dndLootForm'); raw.active = raw.active !== 'false'; state.payload = await invoke('dnd:loot-save', validateLootDraft(raw)); closeModal(); notify('Loot saved.'); state.activeTab = 'loot'; schedule(); }); }
    async function saveContent(button) { await busy(button, async () => { state.payload = await invoke('dnd:content-save', validateContentDraft(formObject('dndContentForm'))); closeModal(); notify('Content entry saved.'); state.activeTab = 'library'; schedule(); }); }
    async function saveHomebrewForm(button) { await busy(button, async () => { state.payload = await invoke('dnd:homebrew-save', validateHomebrewDraft(formObject('dndHomebrewForm'))); closeModal(); notify('Homebrew saved.'); state.activeTab = 'library'; schedule(); }); }

    async function handleClick(event) {
      const tab = event.target.closest?.('[data-dnd-world-tab]');
      if (tab) { event.preventDefault(); event.stopImmediatePropagation(); state.activeTab = tab.dataset.dndWorldTab; schedule(); return; }
      if (event.target.closest?.('[data-dnd-tab],[data-dnd-owner-tab],[data-dnd-repair-tab]')) state.activeTab = '';
      const button = event.target.closest?.('[data-dnd-world-action]');
      if (!button) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const action = button.dataset.dndWorldAction;
      const id = button.dataset.id;
      try {
        if (action === 'close-modal') return closeModal();
        if (action === 'new-world') return worldModal(state.worldType);
        if (action === 'edit-world') return worldModal(button.dataset.type, campaignItems(worldCollection(button.dataset.type)).find((item) => item.id === id));
        if (action === 'save-world') return saveWorld(button);
        if (action === 'toggle-world-reveal') { const type = button.dataset.type; const item = campaignItems(worldCollection(type)).find((entry) => entry.id === id); state.payload = await invoke('dnd:world-save', { ...item, type, revealed: !item.revealed }); notify(item.revealed ? 'World record hidden.' : 'World record revealed.'); state.activeTab = 'world'; return schedule(); }
        if (action === 'new-loot') return lootModal();
        if (action === 'edit-loot') return lootModal(campaignItems('loot').find((item) => item.id === id));
        if (action === 'save-loot') return saveLoot(button);
        if (action === 'archive-loot') { const item = campaignItems('loot').find((entry) => entry.id === id); state.payload = await invoke('dnd:loot-save', { ...item, active: false }); notify('Loot archived.'); state.activeTab = 'loot'; return schedule(); }
        if (action === 'new-content') return contentModal();
        if (action === 'edit-content') return contentModal((dnd().contentEntries || []).find((item) => item.id === id));
        if (action === 'save-content') return saveContent(button);
        if (action === 'new-homebrew') return homebrewModal();
        if (action === 'edit-homebrew') return homebrewModal(campaignItems('homebrew').find((item) => item.id === id));
        if (action === 'save-homebrew') return saveHomebrewForm(button);
        if (action === 'transition-homebrew') { const item = campaignItems('homebrew').find((entry) => entry.id === id); state.payload = await invoke('dnd:homebrew-save', { ...item, status: button.dataset.status }); notify(`Homebrew moved to ${button.dataset.status}.`); state.activeTab = 'library'; return schedule(); }
        if (action === 'roll-dice') { await busy(button, async () => { const response = await invoke('dnd:dice-roll', validateRollDraft(formObject('dndDesktopRollForm'))); state.lastRoll = response.roll; state.payload = response.state; notify(`Rolled ${response.roll.total}.`); state.activeTab = 'dice'; schedule(); }); return; }
      } catch (error) { modalError(error); notify(error.message || String(error)); }
    }

    doc.addEventListener('click', handleClick, true);
    doc.addEventListener('change', (event) => {
      if (event.target?.id === 'dndWorldType') { state.worldType = event.target.value; state.activeTab = 'world'; schedule(); }
      if (event.target?.id === 'dndCampaignSelect') { state.activeTab = ''; state.lastRoll = null; schedule(); }
    }, true);
    if (typeof win.MutationObserver === 'function') {
      const observer = new win.MutationObserver((records) => {
        const relevant = records.some((record) => record.type === 'childList' && !record.target?.closest?.('.dnd-world-content,#dndWorldModal') && [...(record.addedNodes || [])].some((node) => node.nodeType === 1 && (node.matches?.('.dnd-tabs,.dnd-tab-panel') || node.querySelector?.('.dnd-tabs,.dnd-tab-panel'))));
        if (relevant) schedule();
      });
      observer.observe(doc.documentElement, { childList: true, subtree: true });
      state.observer = observer;
    }
    if (win.khaos?.onDnd) win.khaos.onDnd((payload) => { state.payload = payload; schedule(); });
    refresh().catch((error) => notify(error.message || String(error)));
    const api = { state, refresh, enhance };
    win.__khaosDndWorldContent = api;
    return api;
  }

  return {
    WORLD_TYPES, CONTENT_ORIGINS, HOMEBREW_STATUSES,
    validateWorldDraft, validateLootDraft, validateContentDraft, validateHomebrewDraft, validateRollDraft,
    parseDetails, install
  };
});
