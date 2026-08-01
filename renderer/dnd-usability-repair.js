'use strict';

(function bootstrapDndUsability(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) api.install(root);
})(typeof window !== 'undefined' ? window : null, function dndUsabilityFactory() {
  const CAMPAIGN_STATUSES = ['planning', 'active', 'paused', 'completed', 'archived'];
  const CHARACTER_STATUSES = ['active', 'backup', 'deceased', 'retired', 'inactive'];
  const RULESETS = ['5e_2024', '5e_2014', 'system_neutral'];
  const SNOWFLAKE = /^\d{5,25}$/;

  function clean(value, max = 200) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function integer(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.trunc(number) : fallback;
  }

  function parseConditions(value) {
    const source = Array.isArray(value) ? value : String(value || '').split(',');
    return [...new Set(source.map((item) => clean(item, 80)).filter(Boolean))];
  }

  function validationError(message, field) {
    const error = new Error(message);
    error.code = 'DND_FORM_VALIDATION';
    error.field = field;
    return error;
  }

  function validateCampaignDraft(input = {}) {
    const name = clean(input.name, 120);
    const ruleset = clean(input.ruleset || '5e_2024', 80);
    const status = CAMPAIGN_STATUSES.includes(input.status) ? input.status : 'planning';
    if (!name) throw validationError('Campaign name is required.', 'name');
    if (!ruleset) throw validationError('Ruleset is required.', 'ruleset');
    return {
      ...(input.id ? { id: clean(input.id, 100) } : {}),
      name,
      ruleset,
      status,
      description: clean(input.description, 2000),
      currentLocation: clean(input.currentLocation, 200),
      activeQuestId: clean(input.activeQuestId, 100)
    };
  }

  function validateCharacterDraft(input = {}, existing = {}) {
    const name = clean(input.name, 120);
    const discordUserId = clean(input.discordUserId, 25);
    const portraitUrl = clean(input.portraitUrl, 800);
    const level = integer(input.level, 1);
    const hp = integer(input.hp, 0);
    const maxHp = integer(input.maxHp, 0);
    const armorClass = integer(input.armorClass, 10);
    const exhaustion = integer(input.exhaustion, 0);
    const initiativeModifier = integer(input.initiativeModifier, 0);
    if (!clean(input.campaignId, 100)) throw validationError('Select a campaign before saving a character.', 'campaignId');
    if (!name) throw validationError('Character name is required.', 'name');
    if (discordUserId && !SNOWFLAKE.test(discordUserId)) throw validationError('Discord user ID must be numeric.', 'discordUserId');
    if (level < 0 || level > 30) throw validationError('Level must be between 0 and 30.', 'level');
    if (hp < 0 || maxHp < 0) throw validationError('HP values cannot be negative.', 'hp');
    if (maxHp && hp > maxHp) throw validationError('Current HP cannot exceed maximum HP.', 'hp');
    if (armorClass < 0 || armorClass > 99) throw validationError('Armor Class must be between 0 and 99.', 'armorClass');
    if (exhaustion < 0 || exhaustion > 6) throw validationError('Exhaustion must be between 0 and 6.', 'exhaustion');
    if (portraitUrl && !/^(https?:\/\/|data:image\/)/i.test(portraitUrl)) throw validationError('Portrait URL must use http, https, or an image data URL.', 'portraitUrl');
    return {
      ...existing,
      ...(input.id ? { id: clean(input.id, 100) } : {}),
      campaignId: clean(input.campaignId, 100),
      ownerUserId: clean(input.ownerUserId, 100),
      discordUserId,
      name,
      portraitUrl,
      level,
      className: clean(input.className, 120),
      hp,
      maxHp,
      armorClass,
      conditions: parseConditions(input.conditions),
      inspiration: Boolean(input.inspiration),
      exhaustion,
      status: CHARACTER_STATUSES.includes(input.status) ? input.status : 'active',
      activeQuestId: clean(input.activeQuestId, 100),
      initiativeModifier,
      abilityModifiers: existing.abilityModifiers && typeof existing.abilityModifiers === 'object' ? existing.abilityModifiers : {},
      selected: Boolean(input.selected)
    };
  }

  function sameCharacterOwner(left = {}, right = {}) {
    if (left.discordUserId && right.discordUserId) return left.discordUserId === right.discordUserId;
    if (left.ownerUserId && right.ownerUserId) return left.ownerUserId === right.ownerUserId;
    return false;
  }

  async function saveCampaignFlow({ invoke, draft }) {
    if (typeof invoke !== 'function') throw new TypeError('invoke is required');
    return invoke('dnd:campaign-save', validateCampaignDraft(draft));
  }

  async function saveCharacterFlow({ invoke, draft, existing = {}, characters = [] }) {
    if (typeof invoke !== 'function') throw new TypeError('invoke is required');
    const value = validateCharacterDraft(draft, existing);
    if (value.selected) {
      const siblings = characters.filter((item) => item.id !== value.id && item.campaignId === value.campaignId && item.selected && sameCharacterOwner(item, value));
      for (const sibling of siblings) await invoke('dnd:character-save', { ...sibling, selected: false });
    }
    return invoke('dnd:character-save', value);
  }

  function unavailableMessage(error) {
    const code = clean(error?.code, 80);
    const message = clean(error?.message || error, 500);
    if (code === 'MODULE_DISABLED' || /disabled|unavailable/i.test(message)) {
      return 'D&D Workspace is disabled. Enable it in Modules, then reopen D&D. Existing campaigns and characters remain stored.';
    }
    if (code === 'OWNER_ACCESS_REQUIRED' || code === 'ACCESS_DENIED' || /owner access/i.test(message)) {
      return 'D&D campaign administration requires Khaos Nexus Owner access.';
    }
    return message || 'D&D campaign data is temporarily unavailable.';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
  }

  function install(win) {
    if (!win?.document || win.__khaosDndUsabilityRepair) return win?.__khaosDndUsabilityRepair || null;
    const doc = win.document;
    const state = {
      payload: null,
      selectedCampaignId: '',
      activeTab: '',
      busy: false,
      error: '',
      observer: null,
      scheduled: false
    };

    function notify(message) {
      if (typeof win.toast === 'function') win.toast(message);
    }

    async function invoke(channel, payload) {
      if (!win.khaos?.invoke) throw Object.assign(new Error('Khaos Nexus IPC is unavailable.'), { code: 'IPC_UNAVAILABLE' });
      return win.khaos.invoke(channel, payload);
    }

    function selectedCampaignId() {
      return clean(doc.getElementById('dndCampaignSelect')?.value || state.selectedCampaignId, 100);
    }

    function campaignFromPayload() {
      const id = selectedCampaignId();
      return state.payload?.state?.campaigns?.find((item) => item.id === id) || null;
    }

    function setStatus(message = '', tone = 'error') {
      state.error = message;
      const root = doc.getElementById('view-dnd');
      if (!root) return;
      let banner = root.querySelector('#dndUsabilityStatus');
      if (!banner) {
        banner = doc.createElement('div');
        banner.id = 'dndUsabilityStatus';
        root.prepend(banner);
      }
      banner.className = `dnd-usability-status ${tone}`;
      banner.textContent = message;
      banner.hidden = !message;
    }

    async function refresh() {
      try {
        const unavailable = doc.querySelector('.dnd-usability-unavailable');
        state.payload = await invoke('dnd:get');
        state.error = '';
        setStatus('');
        if (unavailable && typeof win.location?.reload === 'function') {
          win.location.reload();
          return state.payload;
        }
        scheduleEnhance();
        return state.payload;
      } catch (error) {
        const message = unavailableMessage(error);
        setStatus(message, 'warning');
        const root = doc.getElementById('view-dnd');
        if (root && !root.querySelector('.dnd-usability-unavailable')) {
          root.innerHTML = `<article class="panel empty-state dnd-usability-unavailable"><span class="empty-icon">⚔</span><h3>D&D Workspace unavailable</h3><p>${escapeHtml(message)}</p><button class="button" data-dnd-repair-action="retry-load">Retry</button></article>`;
        }
        return null;
      }
    }

    function scheduleEnhance() {
      if (state.scheduled) return;
      state.scheduled = true;
      win.setTimeout(() => {
        state.scheduled = false;
        enhance();
      }, 0);
    }

    function ensureCharacterTab(root) {
      const tabs = root.querySelector('.dnd-tabs');
      if (!tabs) return;
      let button = tabs.querySelector('[data-dnd-repair-tab="characters"]');
      if (!button) {
        button = doc.createElement('button');
        button.className = 'dnd-tab';
        button.dataset.dndRepairTab = 'characters';
        button.textContent = 'Characters';
        const discord = tabs.querySelector('[data-dnd-tab="discord"]');
        tabs.insertBefore(button, discord || null);
      }
      button.classList.toggle('active', state.activeTab === 'characters');
    }

    function characterCard(character, quests) {
      const quest = quests.find((item) => item.id === character.activeQuestId);
      return `<article class="dnd-manage-character">
        <div class="dnd-manage-character-main">
          ${character.portraitUrl ? `<img src="${escapeHtml(character.portraitUrl)}" alt="">` : '<div class="dnd-manage-portrait">⚔</div>'}
          <div><span class="eyebrow">${escapeHtml(character.status || 'active')}</span><h3>${escapeHtml(character.name)}</h3>
          <p>Level ${escapeHtml(character.level ?? 1)} ${escapeHtml(character.className || 'Adventurer')} · HP ${escapeHtml(character.hp ?? 0)}/${escapeHtml(character.maxHp ?? 0)} · AC ${escapeHtml(character.armorClass ?? 0)}</p>
          <small>${character.selected ? 'Selected character' : 'Not selected'}${quest ? ` · Quest: ${escapeHtml(quest.title || quest.name)}` : ''}</small></div>
        </div>
        <div class="server-actions">
          <button class="button" data-dnd-repair-action="edit-character" data-character-id="${escapeHtml(character.id)}">Edit</button>
          ${character.selected ? '' : `<button class="button" data-dnd-repair-action="select-character" data-character-id="${escapeHtml(character.id)}">Set Active</button>`}
          ${character.status === 'retired' ? '' : `<button class="button danger" data-dnd-repair-action="retire-character" data-character-id="${escapeHtml(character.id)}">Retire</button>`}
        </div>
      </article>`;
    }

    function renderCharacters(root) {
      if (state.activeTab !== 'characters') return;
      const panel = root.querySelector('.dnd-tab-panel');
      if (!panel) return;
      root.querySelectorAll('[data-dnd-tab]').forEach((item) => item.classList.remove('active'));
      const campaignId = selectedCampaignId();
      const characters = (state.payload?.state?.characters || []).filter((item) => item.campaignId === campaignId);
      const quests = (state.payload?.state?.quests || []).filter((item) => item.campaignId === campaignId);
      panel.innerHTML = `<div class="dnd-character-management">
        <article class="panel">
          <div class="panel-heading"><div><span class="eyebrow">Campaign roster</span><h3>Characters</h3></div><div class="server-actions"><span class="tag">${characters.length}</span><button class="button primary" data-dnd-repair-action="new-character">Create Character</button></div></div>
          <div class="callout">Create and edit characters here. Party remains a read-only campaign summary.</div>
          <div class="dnd-manage-character-list">${characters.length ? characters.map((item) => characterCard(item, quests)).join('') : '<div class="empty-state"><h3>No characters yet</h3><p>Create the first character for this campaign.</p><button class="button primary" data-dnd-repair-action="new-character">Create Character</button></div>'}</div>
        </article>
      </div>`;
    }

    function enhance() {
      const root = doc.getElementById('view-dnd');
      if (!root) return;
      const select = doc.getElementById('dndCampaignSelect');
      if (select?.value) state.selectedCampaignId = select.value;
      ensureCharacterTab(root);
      renderCharacters(root);
      if (state.error) setStatus(state.error, 'error');
    }

    function closeModal() {
      doc.getElementById('dndUsabilityModal')?.remove();
    }

    function showModal(title, body, saveLabel, saveAction) {
      closeModal();
      const wrapper = doc.createElement('div');
      wrapper.id = 'dndUsabilityModal';
      wrapper.className = 'dnd-usability-modal-backdrop';
      wrapper.innerHTML = `<section class="dnd-usability-modal" role="dialog" aria-modal="true" aria-labelledby="dndUsabilityModalTitle">
        <div class="panel-heading"><div><span class="eyebrow">D&D Workspace</span><h2 id="dndUsabilityModalTitle">${escapeHtml(title)}</h2></div><button class="button" data-dnd-repair-action="close-modal" aria-label="Close">Close</button></div>
        <div id="dndUsabilityModalError" class="dnd-usability-modal-error" hidden></div>
        ${body}
        <div class="form-actions"><button class="button" data-dnd-repair-action="close-modal">Cancel</button><button class="button primary" data-dnd-repair-action="${saveAction}">${escapeHtml(saveLabel)}</button></div>
      </section>`;
      doc.body.appendChild(wrapper);
      wrapper.querySelector('input, select, textarea')?.focus();
    }

    function modalError(error) {
      const target = doc.getElementById('dndUsabilityModalError');
      if (!target) return;
      target.textContent = error?.message || String(error);
      target.hidden = false;
      if (error?.field) doc.querySelector(`[name="${error.field}"]`)?.focus();
    }

    function campaignDialog(campaign = null) {
      const value = campaign || { name: '', status: 'planning', ruleset: '5e_2024', description: '' };
      showModal(campaign ? 'Edit campaign' : 'Create campaign', `<form id="dndCampaignRepairForm" novalidate>
        <input type="hidden" name="id" value="${escapeHtml(value.id || '')}">
        <label>Campaign name<input name="name" value="${escapeHtml(value.name || '')}" maxlength="120" required></label>
        <div class="form-grid">
          <label>Ruleset<select name="ruleset">${RULESETS.map((item) => `<option value="${item}" ${value.ruleset === item ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select></label>
          <label>Status<select name="status">${CAMPAIGN_STATUSES.map((item) => `<option value="${item}" ${value.status === item ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select></label>
        </div>
        <label>Description<textarea name="description" rows="5" maxlength="2000">${escapeHtml(value.description || '')}</textarea></label>
      </form>`, campaign ? 'Save campaign' : 'Create campaign', 'save-campaign-form');
    }

    function characterDialog(character = null) {
      const campaign = campaignFromPayload();
      if (!campaign) throw validationError('Select a campaign before creating a character.', 'campaignId');
      const value = character || {
        campaignId: campaign.id, name: '', level: 1, className: '', hp: 0, maxHp: 0, armorClass: 10,
        conditions: [], inspiration: false, exhaustion: 0, status: 'active', initiativeModifier: 0, selected: false
      };
      const quests = (state.payload?.state?.quests || []).filter((item) => item.campaignId === campaign.id);
      showModal(character ? 'Edit character' : 'Create character', `<form id="dndCharacterRepairForm" novalidate>
        <input type="hidden" name="id" value="${escapeHtml(value.id || '')}"><input type="hidden" name="campaignId" value="${escapeHtml(campaign.id)}">
        <div class="form-grid">
          <label>Character name<input name="name" value="${escapeHtml(value.name || '')}" maxlength="120" required></label>
          <label>Class<input name="className" value="${escapeHtml(value.className || '')}" maxlength="120"></label>
        </div>
        <div class="form-grid three">
          <label>Level<input name="level" type="number" min="0" max="30" value="${escapeHtml(value.level ?? 1)}"></label>
          <label>Current HP<input name="hp" type="number" min="0" value="${escapeHtml(value.hp ?? 0)}"></label>
          <label>Maximum HP<input name="maxHp" type="number" min="0" value="${escapeHtml(value.maxHp ?? 0)}"></label>
        </div>
        <div class="form-grid three">
          <label>Armor Class<input name="armorClass" type="number" min="0" max="99" value="${escapeHtml(value.armorClass ?? 10)}"></label>
          <label>Initiative modifier<input name="initiativeModifier" type="number" value="${escapeHtml(value.initiativeModifier ?? 0)}"></label>
          <label>Exhaustion<input name="exhaustion" type="number" min="0" max="6" value="${escapeHtml(value.exhaustion ?? 0)}"></label>
        </div>
        <div class="form-grid">
          <label>Status<select name="status">${CHARACTER_STATUSES.map((item) => `<option value="${item}" ${value.status === item ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select></label>
          <label>Active quest<select name="activeQuestId"><option value="">None</option>${quests.map((quest) => `<option value="${escapeHtml(quest.id)}" ${value.activeQuestId === quest.id ? 'selected' : ''}>${escapeHtml(quest.title || quest.name || quest.id)}</option>`).join('')}</select></label>
        </div>
        <label>Conditions<input name="conditions" value="${escapeHtml((value.conditions || []).join(', '))}" placeholder="poisoned, prone"></label>
        <div class="form-grid">
          <label>Owner user ID<input name="ownerUserId" value="${escapeHtml(value.ownerUserId || '')}" maxlength="100"></label>
          <label>Discord user ID<input name="discordUserId" value="${escapeHtml(value.discordUserId || '')}" inputmode="numeric" maxlength="25"></label>
        </div>
        <label>Portrait URL<input name="portraitUrl" value="${escapeHtml(value.portraitUrl || '')}" maxlength="800" placeholder="https://..."></label>
        <div class="dnd-check-grid">
          <label><input name="inspiration" type="checkbox" ${value.inspiration ? 'checked' : ''}> Inspiration</label>
          <label><input name="selected" type="checkbox" ${value.selected ? 'checked' : ''}> Selected character</label>
        </div>
      </form>`, character ? 'Save character' : 'Create character', 'save-character-form');
    }

    function formObject(form) {
      const data = new win.FormData(form);
      const result = Object.fromEntries(data.entries());
      result.inspiration = Boolean(form.elements.inspiration?.checked);
      result.selected = Boolean(form.elements.selected?.checked);
      return result;
    }

    async function withBusy(button, operation) {
      if (state.busy) return;
      state.busy = true;
      const original = button?.textContent;
      if (button) { button.disabled = true; button.textContent = 'Saving…'; }
      try { await operation(); }
      catch (error) { modalError(error); }
      finally {
        state.busy = false;
        if (button) { button.disabled = false; button.textContent = original; }
      }
    }

    async function saveCampaign(button) {
      const form = doc.getElementById('dndCampaignRepairForm');
      if (!form) return;
      await withBusy(button, async () => {
        const draft = formObject(form);
        const result = await saveCampaignFlow({ invoke, draft });
        state.payload = result;
        const campaigns = result?.state?.campaigns || [];
        state.selectedCampaignId = draft.id || campaigns[campaigns.length - 1]?.id || '';
        state.activeTab = '';
        closeModal();
        notify(draft.id ? 'Campaign saved.' : 'Campaign created.');
        win.setTimeout(() => {
          const select = doc.getElementById('dndCampaignSelect');
          if (select && state.selectedCampaignId) {
            select.value = state.selectedCampaignId;
            select.dispatchEvent(new win.Event('change', { bubbles: true }));
          }
          refresh();
        }, 0);
      });
    }

    async function saveCharacter(button) {
      const form = doc.getElementById('dndCharacterRepairForm');
      if (!form) return;
      await withBusy(button, async () => {
        const draft = formObject(form);
        const existing = state.payload?.state?.characters?.find((item) => item.id === draft.id) || {};
        const result = await saveCharacterFlow({ invoke, draft, existing, characters: state.payload?.state?.characters || [] });
        state.payload = result;
        state.activeTab = 'characters';
        closeModal();
        notify(draft.id ? 'Character saved.' : 'Character created.');
        await refresh();
      });
    }

    async function updateCharacter(character, patch, success) {
      await saveCharacterFlow({
        invoke,
        draft: { ...character, ...patch, conditions: character.conditions || [] },
        existing: character,
        characters: state.payload?.state?.characters || []
      });
      notify(success);
      state.activeTab = 'characters';
      await refresh();
    }

    async function handleClick(event) {
      const newCampaign = event.target.closest?.('[data-dnd-action="new-campaign"]');
      if (newCampaign) {
        event.preventDefault();
        event.stopImmediatePropagation();
        campaignDialog();
        return;
      }
      const repairTab = event.target.closest?.('[data-dnd-repair-tab="characters"]');
      if (repairTab) {
        event.preventDefault();
        event.stopImmediatePropagation();
        state.activeTab = 'characters';
        scheduleEnhance();
        return;
      }
      const baseTab = event.target.closest?.('[data-dnd-tab]');
      if (baseTab) state.activeTab = '';
      const action = event.target.closest?.('[data-dnd-repair-action]');
      if (!action) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const name = action.dataset.dndRepairAction;
      try {
        if (name === 'close-modal') return closeModal();
        if (name === 'retry-load') return refresh();
        if (name === 'save-campaign-form') return saveCampaign(action);
        if (name === 'new-character') return characterDialog();
        if (name === 'save-character-form') return saveCharacter(action);
        const id = action.dataset.characterId;
        const character = state.payload?.state?.characters?.find((item) => item.id === id);
        if (!character) throw new Error('Character not found. Refresh D&D and try again.');
        if (name === 'edit-character') return characterDialog(character);
        if (name === 'select-character') return updateCharacter(character, { selected: true, status: 'active' }, 'Active character selected.');
        if (name === 'retire-character') return updateCharacter(character, { selected: false, status: 'retired' }, 'Character retired.');
      } catch (error) {
        setStatus(error.message || String(error), 'error');
        notify(error.message || String(error));
      }
    }

    doc.addEventListener('click', handleClick, true);
    doc.addEventListener('change', (event) => {
      if (event.target?.id === 'dndCampaignSelect') {
        state.selectedCampaignId = event.target.value;
        state.activeTab = '';
        scheduleEnhance();
      }
    }, true);

    if (typeof win.MutationObserver === 'function') {
      state.observer = new win.MutationObserver(scheduleEnhance);
      state.observer.observe(doc.documentElement, { childList: true, subtree: true });
    }
    if (win.khaos?.onDnd) win.khaos.onDnd((payload) => { state.payload = payload; scheduleEnhance(); });
    refresh();

    const api = { state, refresh, enhance, campaignDialog, characterDialog, closeModal };
    win.__khaosDndUsabilityRepair = api;
    return api;
  }

  return {
    CAMPAIGN_STATUSES,
    CHARACTER_STATUSES,
    RULESETS,
    parseConditions,
    validateCampaignDraft,
    validateCharacterDraft,
    sameCharacterOwner,
    saveCampaignFlow,
    saveCharacterFlow,
    unavailableMessage,
    install
  };
});
