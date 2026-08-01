'use strict';

(function bootstrapDndNpcTool(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) api.install(root);
})(typeof window !== 'undefined' ? window : null, function dndNpcToolFactory() {
  const STATUSES = ['alive', 'missing', 'captured', 'allied', 'hostile', 'deceased', 'archived'];
  const RELATIONSHIP_TYPES = ['ally', 'enemy', 'family', 'friend', 'rival', 'employer', 'employee', 'member', 'leader', 'contact', 'owes', 'fears', 'serves', 'knows', 'custom'];
  const TARGET_TYPES = ['npc', 'character', 'faction', 'location', 'quest'];
  const ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
  const clean = (value, max = 200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const numeric = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const integer = (value, fallback = 0) => Math.trunc(numeric(value, fallback));
  const list = (value, max = 120) => [...new Set(String(value || '').split(',').map((item) => clean(item, max)).filter(Boolean))];
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const fail = (message, field = '') => Object.assign(new Error(message), { code: 'DND_FORM_VALIDATION', field });

  function parseNamedBonuses(value) {
    return String(value || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const [name, bonus, note] = line.split('|').map((item) => item.trim());
      if (!name) throw fail('Bonus-list entries require a name.', 'skills');
      return { name: clean(name, 120), bonus: integer(bonus), note: clean(note, 500) };
    });
  }
  function formatNamedBonuses(value) { return (value || []).map((item) => `${item.name} | ${item.bonus || 0}${item.note ? ` | ${item.note}` : ''}`).join('\n'); }
  function parseActions(value, type) {
    return String(value || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const [name, attackBonus, damageExpression, damageType, description] = line.split('|').map((item) => item.trim());
      if (!name) throw fail('Action entries require a name.', type);
      return { name: clean(name, 160), attackBonus: attackBonus === '' ? null : integer(attackBonus), damageExpression: clean(damageExpression, 80), damageType: clean(damageType, 80), description: clean(description, 4000), active: true };
    });
  }
  function formatActions(value) { return (value || []).map((item) => `${item.name} | ${item.attackBonus ?? ''} | ${item.damageExpression || ''} | ${item.damageType || ''} | ${item.description || ''}`).join('\n'); }

  function validateNpcDraft(input = {}, existing = {}) {
    const campaignId = clean(input.campaignId, 100);
    const name = clean(input.name, 180);
    if (!campaignId) throw fail('Select a campaign before saving an NPC.', 'campaignId');
    if (!name) throw fail('NPC name is required.', 'name');
    const mode = input.mode === 'combat' ? 'combat' : 'narrative';
    const maxHp = Math.max(0, integer(input.maxHp));
    const hp = Math.max(0, integer(input.hp, maxHp));
    if (mode === 'combat' && hp > maxHp) throw fail('Current HP cannot exceed maximum HP.', 'hp');
    const abilities = {};
    for (const ability of ABILITIES) abilities[ability] = Math.max(1, Math.min(30, integer(input[ability], 10)));
    return {
      ...existing,
      ...(input.id ? { id: clean(input.id, 100) } : {}), campaignId, type: 'npc', name,
      aliases: list(input.aliases), pronouns: clean(input.pronouns, 80), ancestry: clean(input.ancestry, 120), age: clean(input.age, 80),
      appearance: clean(input.appearance, 4000), occupation: clean(input.occupation, 160), role: clean(input.role, 160),
      disposition: clean(input.disposition, 120), personalityTraits: list(input.personalityTraits, 400), ideals: list(input.ideals, 400),
      bonds: list(input.bonds, 400), flaws: list(input.flaws, 400), voiceNotes: clean(input.voiceNotes, 3000),
      motivations: list(input.motivations, 500), goals: list(input.goals, 500), secrets: clean(input.secrets, 8000),
      publicSummary: clean(input.publicSummary, 5000), gmNotes: clean(input.gmNotes, 12000), attitude: clean(input.attitude, 120),
      factionIds: list(input.factionIds, 100), locationIds: list(input.locationIds, 100), questIds: list(input.questIds, 100),
      encounterIds: existing.encounterIds || [], status: STATUSES.includes(input.status) ? input.status : 'alive', mode,
      revealed: Boolean(input.revealed), tags: list(input.tags, 80), portrait: existing.portrait || {},
      combat: {
        ...(existing.combat || {}), level: Math.max(0, Math.min(30, integer(input.level))), challengeRating: clean(input.challengeRating, 30),
        armorClass: Math.max(0, Math.min(99, integer(input.armorClass, 10))), hp, maxHp, speed: clean(input.speed, 200), abilities,
        savingThrows: parseNamedBonuses(input.savingThrows), skills: parseNamedBonuses(input.skills),
        senses: list(input.senses, 160), languages: list(input.languages, 120), resistances: list(input.resistances, 120),
        immunities: list(input.immunities, 120), vulnerabilities: list(input.vulnerabilities, 120), conditions: list(input.conditions, 80),
        attacks: parseActions(input.attacks, 'attacks'), actions: parseActions(input.actions, 'actions'),
        bonusActions: parseActions(input.bonusActions, 'bonusActions'), reactions: parseActions(input.reactions, 'reactions'),
        legendaryActions: parseActions(input.legendaryActions, 'legendaryActions'), lairActions: parseActions(input.lairActions, 'lairActions'),
        spellcasting: clean(input.spellcasting, 12000), initiativeModifier: integer(input.initiativeModifier), sourceId: clean(input.sourceId, 100)
      },
      metadata: existing.metadata || {}
    };
  }

  function validateRelationshipDraft(input = {}) {
    if (!clean(input.campaignId, 100) || !clean(input.npcId, 100) || !clean(input.targetId, 100)) throw fail('Relationship NPC and target are required.', 'targetId');
    return {
      ...(input.id ? { id: clean(input.id, 100) } : {}), campaignId: clean(input.campaignId, 100), npcId: clean(input.npcId, 100),
      targetType: TARGET_TYPES.includes(input.targetType) ? input.targetType : 'npc', targetId: clean(input.targetId, 100),
      relationshipType: RELATIONSHIP_TYPES.includes(input.relationshipType) ? input.relationshipType : 'custom', customType: clean(input.customType, 120),
      publicDescription: clean(input.publicDescription, 2000), gmNotes: clean(input.gmNotes, 5000),
      strength: Math.max(-5, Math.min(5, integer(input.strength))), revealed: Boolean(input.revealed)
    };
  }

  function install(win) {
    if (!win?.document || win.__khaosDndNpcTool) return win?.__khaosDndNpcTool || null;
    const doc = win.document;
    const state = { payload: null, activeTab: false, query: '', status: 'active', mode: 'all', selectedNpcId: '', busy: false, scheduled: false, observer: null, portraitCache: new Map(), pendingImport: null };
    const invoke = (channel, payload) => win.khaos.invoke(channel, payload);
    const notify = (message) => typeof win.toast === 'function' && win.toast(message);
    const campaignId = () => clean(doc.getElementById('dndCampaignSelect')?.value, 100);
    const allNpcs = () => (state.payload?.state?.npcs || []).filter((item) => item.campaignId === campaignId());
    const relationships = () => (state.payload?.state?.npcRelationships || []).filter((item) => item.campaignId === campaignId());
    const selectedNpc = () => allNpcs().find((item) => item.id === state.selectedNpcId) || null;

    function schedule() { if (state.scheduled) return; state.scheduled = true; win.setTimeout(() => { state.scheduled = false; enhance(); }, 0); }
    async function load(force = false) {
      if (!force && state.payload) return state.payload;
      state.payload = await invoke('dnd:npcs-get');
      const available = filteredNpcs();
      if (!available.some((item) => item.id === state.selectedNpcId)) state.selectedNpcId = available[0]?.id || '';
      schedule(); return state.payload;
    }
    function filteredNpcs() {
      const query = state.query.toLowerCase();
      return allNpcs().filter((npc) => {
        if (state.status === 'active' && npc.status === 'archived') return false;
        if (state.status !== 'all' && state.status !== 'active' && npc.status !== state.status) return false;
        if (state.mode !== 'all' && npc.mode !== state.mode) return false;
        if (!query) return true;
        return [npc.name, npc.ancestry, npc.occupation, npc.role, npc.disposition, ...(npc.aliases || []), ...(npc.tags || [])].join(' ').toLowerCase().includes(query);
      }).sort((a, b) => a.name.localeCompare(b.name));
    }
    function closeModal() { doc.getElementById('dndNpcModal')?.remove(); }
    function modalError(error) {
      const target = doc.getElementById('dndNpcModalError'); if (!target) return;
      target.textContent = error?.message || String(error); target.hidden = false;
      if (error?.field) doc.querySelector(`[name="${error.field}"]`)?.focus();
    }
    function showModal(title, body, saveLabel, action, wide = true) {
      closeModal(); const wrapper = doc.createElement('div'); wrapper.id = 'dndNpcModal'; wrapper.className = 'dnd-npc-modal-backdrop';
      wrapper.innerHTML = `<section class="dnd-npc-modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><div class="panel-heading"><div><span class="eyebrow">D&D NPC Tool</span><h2>${escapeHtml(title)}</h2></div><button class="button" data-dnd-npc-action="close-modal">Close</button></div><div id="dndNpcModalError" class="dnd-npc-modal-error" hidden></div>${body}<div class="form-actions"><button class="button" data-dnd-npc-action="close-modal">Cancel</button><button class="button primary" data-dnd-npc-action="${action}">${escapeHtml(saveLabel)}</button></div></section>`;
      doc.body.appendChild(wrapper); wrapper.querySelector('input,select,textarea')?.focus();
    }

    function ensureTab(root) {
      const tabs = root.querySelector('.dnd-tabs'); if (!tabs) return;
      let button = tabs.querySelector('[data-dnd-npc-tab="npcs"]');
      if (!button) { button = doc.createElement('button'); button.className = 'dnd-tab'; button.dataset.dndNpcTab = 'npcs'; button.textContent = 'NPCs'; const world = tabs.querySelector('[data-dnd-world-tab="world"]'); tabs.insertBefore(button, world || null); }
      button.classList.toggle('active', state.activeTab);
    }
    function statusTone(status) { return status === 'hostile' ? 'danger' : status === 'allied' ? 'good' : status === 'deceased' || status === 'archived' ? 'muted' : ''; }
    function npcCard(npc) {
      const portrait = state.portraitCache.get(npc.id);
      return `<article class="dnd-npc-card ${npc.id === state.selectedNpcId ? 'selected' : ''}"><button class="dnd-npc-card-main" data-dnd-npc-action="select-npc" data-npc-id="${escapeHtml(npc.id)}">${portrait ? `<img src="${portrait.dataUrl}" alt="">` : '<span class="dnd-npc-avatar">♟</span>'}<span><span class="eyebrow ${statusTone(npc.status)}">${escapeHtml(npc.status)} · ${escapeHtml(npc.mode)}</span><strong>${escapeHtml(npc.name)}</strong><small>${escapeHtml([npc.ancestry, npc.occupation].filter(Boolean).join(' · ') || 'Unspecified NPC')}</small></span></button><div class="server-actions"><button class="button" data-dnd-npc-action="edit-npc" data-npc-id="${escapeHtml(npc.id)}">Edit</button><button class="button" data-dnd-npc-action="duplicate-npc" data-npc-id="${escapeHtml(npc.id)}">Duplicate</button></div></article>`;
    }
    function linkedName(type, id) {
      const key = type === 'npc' ? 'npcs' : type === 'character' ? 'characters' : type === 'faction' ? 'factions' : type === 'location' ? 'locations' : 'quests';
      const collection = type === 'npc' ? allNpcs() : (state.payload?.links?.[key] || []);
      const item = collection.find((entry) => entry.id === id); return item?.name || item?.title || id;
    }
    function detail(npc) {
      if (!npc) return '<article class="panel empty-state"><h3>Select an NPC</h3><p>Create, generate, or import an NPC to begin.</p></article>';
      const related = relationships().filter((item) => item.npcId === npc.id);
      const combat = npc.combat || {};
      const portrait = state.portraitCache.get(npc.id);
      const linkedEncounterCombatants = (state.payload?.links?.combatants || []).filter((item) => item.npcId === npc.id);
      return `<article class="panel dnd-npc-detail"><div class="dnd-npc-hero">${portrait ? `<img src="${portrait.dataUrl}" alt="${escapeHtml(npc.name)}">` : '<div class="dnd-npc-large-avatar">♟</div>'}<div><span class="eyebrow ${statusTone(npc.status)}">${escapeHtml(npc.status)} · ${npc.revealed ? 'Revealed' : 'GM hidden'}</span><h2>${escapeHtml(npc.name)}</h2><p>${escapeHtml([npc.ancestry, npc.occupation, npc.role].filter(Boolean).join(' · '))}</p><div class="server-actions"><button class="button" data-dnd-npc-action="portrait-npc" data-npc-id="${escapeHtml(npc.id)}">Portrait/Token</button><button class="button" data-dnd-npc-action="export-npc" data-npc-id="${escapeHtml(npc.id)}">Export</button><button class="button" data-dnd-npc-action="relationship-npc" data-npc-id="${escapeHtml(npc.id)}">Add Relationship</button>${npc.mode === 'combat' ? `<button class="button primary" data-dnd-npc-action="encounter-npc" data-npc-id="${escapeHtml(npc.id)}">Add to Encounter</button>` : ''}</div></div></div><div class="dnd-npc-summary"><section><h3>Public Summary</h3><p>${escapeHtml(npc.publicSummary || 'No public summary.')}</p></section><section><h3>GM Notes</h3><p>${escapeHtml(npc.gmNotes || 'No GM notes.')}</p></section></div><div class="dnd-npc-facts"><span><strong>Disposition</strong>${escapeHtml(npc.disposition || 'Not set')}</span><span><strong>Attitude</strong>${escapeHtml(npc.attitude || 'Not set')}</span><span><strong>Pronouns</strong>${escapeHtml(npc.pronouns || 'Not set')}</span><span><strong>Age</strong>${escapeHtml(npc.age || 'Not set')}</span></div>${npc.mode === 'combat' ? `<section class="dnd-npc-combat"><div class="panel-heading"><div><span class="eyebrow">Combat statistics</span><h3>AC ${combat.armorClass || 0} · HP ${combat.hp || 0}/${combat.maxHp || 0}</h3></div><span class="tag">CR ${escapeHtml(combat.challengeRating || '—')}</span></div><div class="dnd-npc-abilities">${ABILITIES.map((ability) => `<span><strong>${ability.slice(0,3).toUpperCase()}</strong>${combat.abilities?.[ability]?.score || 10} (${(combat.abilities?.[ability]?.modifier || 0) >= 0 ? '+' : ''}${combat.abilities?.[ability]?.modifier || 0})</span>`).join('')}</div><p><strong>Conditions:</strong> ${escapeHtml((combat.conditions || []).join(', ') || 'None')}</p><div class="dnd-npc-actions-list">${[...(combat.attacks || []), ...(combat.actions || [])].map((item) => `<div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml([item.attackBonus === null ? '' : `${item.attackBonus >= 0 ? '+' : ''}${item.attackBonus}`, item.damageExpression, item.damageType].filter(Boolean).join(' · '))}</span><small>${escapeHtml(item.description || '')}</small></div>`).join('') || '<p>No actions configured.</p>'}</div></section>` : ''}<section class="dnd-npc-relationships"><div class="panel-heading"><div><span class="eyebrow">Connections</span><h3>Relationships</h3></div><span class="tag">${related.length}</span></div>${related.length ? related.map((item) => `<div class="dnd-npc-relationship"><div><strong>${escapeHtml(item.relationshipType === 'custom' ? item.customType : item.relationshipType)} → ${escapeHtml(linkedName(item.targetType, item.targetId))}</strong><p>${escapeHtml(item.publicDescription || 'No public description.')}</p><small>${item.revealed ? 'Revealed' : 'GM hidden'} · Strength ${item.strength}</small></div><button class="button danger" data-dnd-npc-action="remove-relationship" data-relationship-id="${escapeHtml(item.id)}">Remove</button></div>`).join('') : '<p class="dnd-empty">No relationships recorded.</p>'}</section>${linkedEncounterCombatants.length ? `<section><h3>Linked encounter combatants</h3>${linkedEncounterCombatants.map((item) => `<div class="dnd-npc-relationship"><span>${escapeHtml(item.nameSnapshot)} · HP ${item.hp ?? '—'}/${item.maxHp ?? '—'}</span><button class="button" data-dnd-npc-action="sync-combatant" data-npc-id="${escapeHtml(npc.id)}" data-combatant-id="${escapeHtml(item.id)}">Sync Stats</button></div>`).join('')}</section>` : ''}</article>`;
    }
    function render(root) {
      const panel = root.querySelector('.dnd-tab-panel'); if (!panel || !state.activeTab) return;
      root.querySelectorAll('[data-dnd-tab],[data-dnd-owner-tab],[data-dnd-world-tab],[data-dnd-map-tab],[data-dnd-repair-tab]').forEach((item) => item.classList.remove('active'));
      const npcs = filteredNpcs(); const npc = selectedNpc();
      panel.innerHTML = `<div class="dnd-npc-tool"><article class="panel dnd-npc-browser"><div class="panel-heading"><div><span class="eyebrow">Campaign cast</span><h3>NPC Tool</h3></div><div class="server-actions"><button class="button" data-dnd-npc-action="import-npc">Import</button><button class="button" data-dnd-npc-action="generate-npc">Generate</button><button class="button primary" data-dnd-npc-action="new-npc">Create NPC</button></div></div><div class="dnd-npc-filters"><input id="dndNpcSearch" placeholder="Search names, roles, tags…" value="${escapeHtml(state.query)}"><select id="dndNpcModeFilter"><option value="all">All modes</option><option value="narrative" ${state.mode === 'narrative' ? 'selected' : ''}>Narrative</option><option value="combat" ${state.mode === 'combat' ? 'selected' : ''}>Combat-ready</option></select><select id="dndNpcStatusFilter"><option value="active">Not archived</option><option value="all" ${state.status === 'all' ? 'selected' : ''}>All statuses</option>${STATUSES.map((item) => `<option value="${item}" ${state.status === item ? 'selected' : ''}>${item}</option>`).join('')}</select></div><div class="dnd-npc-list">${npcs.length ? npcs.map(npcCard).join('') : '<div class="empty-state"><h3>No matching NPCs</h3><p>Create, generate, or import an NPC.</p></div>'}</div></article>${detail(npc)}</div>`;
      doc.getElementById('dndNpcSearch')?.addEventListener('input', (event) => { state.query = event.target.value; schedule(); });
      doc.getElementById('dndNpcModeFilter')?.addEventListener('change', (event) => { state.mode = event.target.value; schedule(); });
      doc.getElementById('dndNpcStatusFilter')?.addEventListener('change', (event) => { state.status = event.target.value; schedule(); });
      for (const item of npcs) if (item.portrait?.relativePath && !state.portraitCache.has(item.id)) loadPortrait(item.id);
    }
    function enhance() { const root = doc.getElementById('view-dnd'); if (!root) return; ensureTab(root); render(root); }
    async function loadPortrait(npcId) { try { const value = await invoke('dnd:npc-portrait-data', { npcId }); if (value) state.portraitCache.set(npcId, value); schedule(); } catch {} }

    function options(items, selected = []) { const set = new Set(selected || []); return (items || []).filter((item) => !item.campaignId || item.campaignId === campaignId()).map((item) => `<option value="${escapeHtml(item.id)}" ${set.has(item.id) ? 'selected' : ''}>${escapeHtml(item.name || item.title || item.id)}</option>`).join(''); }
    function abilityFields(combat = {}) { return ABILITIES.map((ability) => `<label>${ability.slice(0,3).toUpperCase()}<input name="${ability}" type="number" min="1" max="30" value="${combat.abilities?.[ability]?.score || 10}"></label>`).join(''); }
    function npcDialog(npc = null, title = '') {
      const value = npc || { status: 'alive', mode: 'narrative', revealed: false, combat: { abilities: {} } }; const combat = value.combat || {};
      showModal(title || (npc ? 'Edit NPC' : 'Create NPC'), `<form id="dndNpcForm" novalidate><input type="hidden" name="id" value="${escapeHtml(value.id || '')}"><div class="dnd-npc-form-section"><h3>Identity</h3><div class="form-grid three"><label>Name<input name="name" maxlength="180" value="${escapeHtml(value.name || '')}" required></label><label>Mode<select name="mode"><option value="narrative" ${value.mode !== 'combat' ? 'selected' : ''}>Narrative</option><option value="combat" ${value.mode === 'combat' ? 'selected' : ''}>Combat-ready</option></select></label><label>Status<select name="status">${STATUSES.map((item) => `<option value="${item}" ${value.status === item ? 'selected' : ''}>${item}</option>`).join('')}</select></label></div><div class="form-grid three"><label>Aliases<input name="aliases" value="${escapeHtml((value.aliases || []).join(', '))}"></label><label>Pronouns<input name="pronouns" value="${escapeHtml(value.pronouns || '')}"></label><label>Ancestry/species<input name="ancestry" value="${escapeHtml(value.ancestry || '')}"></label></div><div class="form-grid three"><label>Age<input name="age" value="${escapeHtml(value.age || '')}"></label><label>Occupation<input name="occupation" value="${escapeHtml(value.occupation || '')}"></label><label>Role<input name="role" value="${escapeHtml(value.role || '')}"></label></div><label>Appearance<textarea name="appearance" rows="3">${escapeHtml(value.appearance || '')}</textarea></label></div><div class="dnd-npc-form-section"><h3>Personality & Story</h3><div class="form-grid three"><label>Disposition<input name="disposition" value="${escapeHtml(value.disposition || '')}"></label><label>Attitude toward party<input name="attitude" value="${escapeHtml(value.attitude || '')}"></label><label>Tags<input name="tags" value="${escapeHtml((value.tags || []).join(', '))}"></label></div><label>Personality traits<input name="personalityTraits" value="${escapeHtml((value.personalityTraits || []).join(', '))}"></label><div class="form-grid three"><label>Ideals<input name="ideals" value="${escapeHtml((value.ideals || []).join(', '))}"></label><label>Bonds<input name="bonds" value="${escapeHtml((value.bonds || []).join(', '))}"></label><label>Flaws<input name="flaws" value="${escapeHtml((value.flaws || []).join(', '))}"></label></div><div class="form-grid"><label>Motivations<input name="motivations" value="${escapeHtml((value.motivations || []).join(', '))}"></label><label>Goals<input name="goals" value="${escapeHtml((value.goals || []).join(', '))}"></label></div><label>Voice/accent notes<textarea name="voiceNotes" rows="2">${escapeHtml(value.voiceNotes || '')}</textarea></label><label>Player-visible summary<textarea name="publicSummary" rows="4">${escapeHtml(value.publicSummary || '')}</textarea></label><label>GM notes<textarea name="gmNotes" rows="4">${escapeHtml(value.gmNotes || '')}</textarea></label><label>Secrets<textarea name="secrets" rows="3">${escapeHtml(value.secrets || '')}</textarea></label><label class="toggle-row"><span><strong>Revealed to players</strong></span><input name="revealed" type="checkbox" ${value.revealed ? 'checked' : ''}></label></div><div class="dnd-npc-form-section"><h3>Campaign Links</h3><div class="form-grid three"><label>Factions<select name="factionIds" multiple>${options(state.payload?.links?.factions, value.factionIds)}</select></label><label>Locations<select name="locationIds" multiple>${options(state.payload?.links?.locations, value.locationIds)}</select></label><label>Quests<select name="questIds" multiple>${options(state.payload?.links?.quests, value.questIds)}</select></label></div></div><div class="dnd-npc-form-section" data-combat-section><h3>Combat Statistics</h3><div class="form-grid four"><label>Level<input name="level" type="number" min="0" max="30" value="${combat.level || 0}"></label><label>Challenge rating<input name="challengeRating" value="${escapeHtml(combat.challengeRating || '')}"></label><label>Armor Class<input name="armorClass" type="number" min="0" max="99" value="${combat.armorClass || 10}"></label><label>Speed<input name="speed" value="${escapeHtml(combat.speed || '')}"></label></div><div class="form-grid three"><label>Current HP<input name="hp" type="number" min="0" value="${combat.hp || 0}"></label><label>Maximum HP<input name="maxHp" type="number" min="0" value="${combat.maxHp || 0}"></label><label>Initiative modifier<input name="initiativeModifier" type="number" value="${combat.initiativeModifier || 0}"></label></div><div class="form-grid six">${abilityFields(combat)}</div><div class="form-grid"><label>Saving throws (name | bonus | note)<textarea name="savingThrows" rows="4">${escapeHtml(formatNamedBonuses(combat.savingThrows))}</textarea></label><label>Skills (name | bonus | note)<textarea name="skills" rows="4">${escapeHtml(formatNamedBonuses(combat.skills))}</textarea></label></div><div class="form-grid three"><label>Senses<input name="senses" value="${escapeHtml((combat.senses || []).join(', '))}"></label><label>Languages<input name="languages" value="${escapeHtml((combat.languages || []).join(', '))}"></label><label>Conditions<input name="conditions" value="${escapeHtml((combat.conditions || []).join(', '))}"></label></div><div class="form-grid three"><label>Resistances<input name="resistances" value="${escapeHtml((combat.resistances || []).join(', '))}"></label><label>Immunities<input name="immunities" value="${escapeHtml((combat.immunities || []).join(', '))}"></label><label>Vulnerabilities<input name="vulnerabilities" value="${escapeHtml((combat.vulnerabilities || []).join(', '))}"></label></div><label>Attacks (name | attack bonus | damage | type | description)<textarea name="attacks" rows="5">${escapeHtml(formatActions(combat.attacks))}</textarea></label><label>Actions<textarea name="actions" rows="5">${escapeHtml(formatActions(combat.actions))}</textarea></label><div class="form-grid"><label>Bonus actions<textarea name="bonusActions" rows="4">${escapeHtml(formatActions(combat.bonusActions))}</textarea></label><label>Reactions<textarea name="reactions" rows="4">${escapeHtml(formatActions(combat.reactions))}</textarea></label></div><div class="form-grid"><label>Legendary actions<textarea name="legendaryActions" rows="4">${escapeHtml(formatActions(combat.legendaryActions))}</textarea></label><label>Lair actions<textarea name="lairActions" rows="4">${escapeHtml(formatActions(combat.lairActions))}</textarea></label></div><label>Spellcasting notes<textarea name="spellcasting" rows="5">${escapeHtml(combat.spellcasting || '')}</textarea></label><label>Source<select name="sourceId"><option value="">User-authored / no source</option>${options((state.payload?.state?.sources || []).filter((item) => item.active !== false), combat.sourceId ? [combat.sourceId] : [])}</select></label></div></form>`, npc ? 'Save NPC' : 'Create NPC', 'save-npc');
      const mode = doc.querySelector('#dndNpcForm [name="mode"]'); const section = doc.querySelector('[data-combat-section]');
      const update = () => { if (section) section.hidden = mode.value !== 'combat'; }; mode?.addEventListener('change', update); update();
    }
    function generatorDialog() {
      showModal('Generate NPC Draft', `<form id="dndNpcGeneratorForm"><div class="form-grid three"><label>Mode<select name="mode"><option value="narrative">Narrative</option><option value="combat">Combat-ready</option></select></label><label>Ancestry/species<input name="ancestry"></label><label>Occupation<input name="occupation"></label></div><div class="form-grid three"><label>Disposition<input name="disposition"></label><label>Level<input name="level" type="number" min="0" max="30" value="3"></label><label>Theme<input name="theme" placeholder="gothic, heroic, intrigue…"></label></div><label>Seed<input name="seed" maxlength="160" value="${Date.now()}"></label><div class="callout">Generation runs locally and deterministically. The draft is not saved or made canon until you review and save it.</div></form>`, 'Generate Draft', 'save-generated-draft', false);
    }
    function relationshipTargets(type, selected = '') {
      const collection = type === 'npc' ? allNpcs() : (state.payload?.links?.[type === 'character' ? 'characters' : type === 'faction' ? 'factions' : type === 'location' ? 'locations' : 'quests'] || []);
      return collection.filter((item) => item.id !== state.selectedNpcId && (!item.campaignId || item.campaignId === campaignId())).map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selected ? 'selected' : ''}>${escapeHtml(item.name || item.title || item.id)}</option>`).join('');
    }
    function relationshipDialog(npc) {
      showModal(`Add Relationship for ${npc.name}`, `<form id="dndNpcRelationshipForm"><div class="form-grid three"><label>Target type<select name="targetType">${TARGET_TYPES.map((item) => `<option value="${item}">${item}</option>`).join('')}</select></label><label>Target<select name="targetId">${relationshipTargets('npc')}</select></label><label>Relationship<select name="relationshipType">${RELATIONSHIP_TYPES.map((item) => `<option value="${item}">${item}</option>`).join('')}</select></label></div><label>Custom relationship type<input name="customType"></label><div class="form-grid"><label>Public description<textarea name="publicDescription" rows="3"></textarea></label><label>GM notes<textarea name="gmNotes" rows="3"></textarea></label></div><div class="form-grid"><label>Strength (-5 to 5)<input name="strength" type="number" min="-5" max="5" value="0"></label><label class="toggle-row"><span><strong>Reveal to players</strong></span><input name="revealed" type="checkbox"></label></div></form>`, 'Save Relationship', 'save-relationship', false);
      const type = doc.querySelector('#dndNpcRelationshipForm [name="targetType"]'); type?.addEventListener('change', () => { doc.querySelector('#dndNpcRelationshipForm [name="targetId"]').innerHTML = relationshipTargets(type.value); });
    }
    function encounterDialog(npc) {
      const encounters = (state.payload?.links?.encounters || []).filter((item) => item.campaignId === campaignId() && !['completed', 'archived'].includes(item.status));
      showModal(`Add ${npc.name} to Encounter`, `<form id="dndNpcEncounterForm"><label>Encounter<select name="encounterId">${encounters.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${escapeHtml(item.status)}</option>`).join('')}</select></label><div class="form-grid"><label>Initial initiative<input name="initiative" type="number" value="${npc.combat?.initiativeModifier || 0}"></label><label class="toggle-row"><span><strong>Hidden combatant</strong></span><input name="hidden" type="checkbox"></label></div><div class="callout">The encounter receives a linked snapshot. Live encounter HP will not be overwritten by later NPC edits unless you explicitly synchronize it.</div></form>`, 'Add to Encounter', 'save-encounter-npc', false);
    }

    function formData(form) {
      const data = Object.fromEntries(new win.FormData(form).entries());
      for (const name of ['factionIds', 'locationIds', 'questIds']) data[name] = [...form.elements[name].selectedOptions].map((option) => option.value);
      data.revealed = form.elements.revealed.checked; return data;
    }
    async function withBusy(operation) { if (state.busy) return; state.busy = true; try { await operation(); } catch (error) { modalError(error); if (!doc.getElementById('dndNpcModal')) notify(error.message || String(error)); } finally { state.busy = false; } }
    async function action(target) {
      const name = target.dataset.dndNpcAction; const npcId = clean(target.dataset.npcId, 100); const relationshipId = clean(target.dataset.relationshipId, 100); const combatantId = clean(target.dataset.combatantId, 100);
      if (name === 'close-modal') return closeModal();
      if (name === 'new-npc') return npcDialog();
      if (name === 'generate-npc') return generatorDialog();
      if (name === 'select-npc') { state.selectedNpcId = npcId; schedule(); return; }
      if (name === 'edit-npc') return npcDialog(allNpcs().find((item) => item.id === npcId));
      if (name === 'duplicate-npc') return withBusy(async () => { const source = allNpcs().find((item) => item.id === npcId); const result = await invoke('dnd:npc-duplicate', { npcId, name: `${source.name} Copy` }); state.payload = result.state; state.selectedNpcId = result.npc.id; schedule(); });
      if (name === 'portrait-npc') return withBusy(async () => { const result = await invoke('dnd:npc-portrait-pick', { campaignId: campaignId(), npcId }); if (!result.canceled) { state.payload = result.state; state.portraitCache.delete(npcId); await loadPortrait(npcId); notify('NPC portrait saved.'); } });
      if (name === 'export-npc') return withBusy(async () => { const result = await invoke('dnd:npc-export', { npcId }); if (!result.canceled) notify(`NPC exported as ${result.fileName}.`); });
      if (name === 'import-npc') return withBusy(async () => { const result = await invoke('dnd:npc-import-pick', { campaignId: campaignId() }); if (!result.canceled) { state.pendingImport = result; npcDialog(result.draft, result.collisions.length ? 'Review Imported NPC — Name Collision' : 'Review Imported NPC'); } });
      if (name === 'relationship-npc') return relationshipDialog(allNpcs().find((item) => item.id === npcId));
      if (name === 'remove-relationship') return withBusy(async () => { if (!win.confirm('Remove this NPC relationship?')) return; const result = await invoke('dnd:npc-relationship-remove', { relationshipId }); state.payload = result.state; schedule(); });
      if (name === 'encounter-npc') return encounterDialog(allNpcs().find((item) => item.id === npcId));
      if (name === 'sync-combatant') return withBusy(async () => { const syncHp = win.confirm('Also overwrite the live encounter HP from the NPC record? Choose Cancel to synchronize other stats only.'); const result = await invoke('dnd:npc-combatant-sync', { npcId, combatantId, syncHp }); state.payload = result.state; schedule(); notify('Linked combatant synchronized.'); });
      if (name === 'save-generated-draft') return withBusy(async () => { const form = doc.getElementById('dndNpcGeneratorForm'); const data = Object.fromEntries(new win.FormData(form).entries()); const result = await invoke('dnd:npc-generate', { ...data, campaignId: campaignId() }); closeModal(); npcDialog(result.draft, 'Review Generated NPC Draft'); });
      if (name === 'save-npc') return withBusy(async () => { const form = doc.getElementById('dndNpcForm'); const existing = allNpcs().find((item) => item.id === form.elements.id.value) || state.pendingImport?.draft || {}; const draft = validateNpcDraft({ ...formData(form), campaignId: campaignId() }, existing); if (state.pendingImport) delete draft.id; const result = await invoke('dnd:npc-save', draft); state.payload = result.state; state.selectedNpcId = result.npc.id; state.pendingImport = null; closeModal(); schedule(); notify('NPC saved.'); });
      if (name === 'save-relationship') return withBusy(async () => { const form = doc.getElementById('dndNpcRelationshipForm'); const raw = Object.fromEntries(new win.FormData(form).entries()); raw.revealed = form.elements.revealed.checked; const result = await invoke('dnd:npc-relationship-save', validateRelationshipDraft({ ...raw, campaignId: campaignId(), npcId: state.selectedNpcId })); state.payload = result.state; closeModal(); schedule(); });
      if (name === 'save-encounter-npc') return withBusy(async () => { const form = doc.getElementById('dndNpcEncounterForm'); const raw = Object.fromEntries(new win.FormData(form).entries()); raw.hidden = form.elements.hidden.checked; const result = await invoke('dnd:npc-encounter-add', { ...raw, campaignId: campaignId(), npcId: state.selectedNpcId }); state.payload = result.state; closeModal(); schedule(); notify('NPC added to encounter as a linked combatant.'); });
    }

    doc.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-dnd-npc-tab="npcs"]'); if (tab) { state.activeTab = true; load(true).then(schedule).catch((error) => notify(error.message || String(error))); return; }
      const other = event.target.closest('[data-dnd-tab],[data-dnd-owner-tab],[data-dnd-world-tab],[data-dnd-map-tab],[data-dnd-repair-tab]'); if (other) state.activeTab = false;
      const target = event.target.closest('[data-dnd-npc-action]'); if (target) { event.preventDefault(); action(target); }
    });
    state.observer = new win.MutationObserver((mutations) => { if (mutations.some((mutation) => [...mutation.addedNodes].some((node) => node?.nodeType === 1 && (node.querySelector?.('.dnd-tabs') || node.classList?.contains('dnd-tabs'))))) schedule(); });
    state.observer.observe(doc.body, { childList: true, subtree: true });
    schedule(); win.__khaosDndNpcTool = { state, load, enhance }; return win.__khaosDndNpcTool;
  }

  return { install, validateNpcDraft, validateRelationshipDraft, parseNamedBonuses, parseActions };
});
