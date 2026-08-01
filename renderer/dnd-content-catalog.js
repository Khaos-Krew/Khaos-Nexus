'use strict';

(function bootstrapDndContentCatalog(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) api.install(root);
})(typeof window !== 'undefined' ? window : null, function dndContentCatalogFactory() {
  const clean = (value, max = 200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const numeric = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const fail = (message, field = '') => Object.assign(new Error(message), { code: 'DND_FORM_VALIDATION', field });

  function validateHomebrewSourceDraft(input = {}) {
    const name = clean(input.name, 160);
    if (!name) throw fail('Homebrew source name is required.', 'name');
    const externalReferenceUrl = clean(input.externalReferenceUrl, 800);
    if (externalReferenceUrl && !/^https:\/\//i.test(externalReferenceUrl)) throw fail('External reference must use HTTPS.', 'externalReferenceUrl');
    return {
      name,
      ruleset: clean(input.ruleset || 'system_neutral', 80),
      author: clean(input.author, 160),
      description: clean(input.description, 4000),
      version: clean(input.version || '1.0', 80),
      visibility: input.visibility === 'campaign' ? 'campaign' : 'private',
      attributionText: clean(input.attributionText, 1000),
      externalReferenceUrl,
      active: true
    };
  }

  function validateImportReview(input = {}) {
    const name = clean(input.name, 120);
    if (!clean(input.campaignId, 100)) throw fail('Select a campaign before importing.', 'campaignId');
    if (!name) throw fail('Character name is required.', 'name');
    const level = Math.trunc(numeric(input.level, 1));
    const hp = Math.trunc(numeric(input.hp));
    const maxHp = Math.trunc(numeric(input.maxHp));
    const armorClass = Math.trunc(numeric(input.armorClass, 10));
    const exhaustion = Math.trunc(numeric(input.exhaustion));
    if (level < 0 || level > 30) throw fail('Level must be between 0 and 30.', 'level');
    if (hp < 0 || maxHp < 0 || hp > maxHp) throw fail('HP must be between 0 and maximum HP.', 'hp');
    if (armorClass < 0 || armorClass > 99) throw fail('Armor Class must be between 0 and 99.', 'armorClass');
    if (exhaustion < 0 || exhaustion > 6) throw fail('Exhaustion must be between 0 and 6.', 'exhaustion');
    return {
      ...input,
      id: undefined,
      campaignId: clean(input.campaignId, 100),
      name,
      level,
      hp,
      maxHp,
      armorClass,
      exhaustion,
      className: clean(input.className, 120),
      ownerUserId: clean(input.ownerUserId, 100),
      discordUserId: clean(input.discordUserId, 25),
      portraitUrl: clean(input.portraitUrl, 800),
      initiativeModifier: Math.trunc(numeric(input.initiativeModifier)),
      conditions: [...new Set(String(input.conditions || '').split(',').map((item) => clean(item, 80)).filter(Boolean))],
      selected: Boolean(input.selected),
      inspiration: Boolean(input.inspiration)
    };
  }

  function statusLabel(status) {
    return ({
      available: 'Available', installed: 'Installed', update_available: 'Update available', invalid: 'Needs repair', downloading: 'Downloading'
    })[status] || clean(status || 'Available', 40);
  }

  function install(win) {
    if (!win?.document || win.__khaosDndContentCatalog) return win?.__khaosDndContentCatalog || null;
    const doc = win.document;
    const state = { payload: null, busy: false, scheduled: false, observer: null, pendingImport: null, loadedAt: 0 };
    const invoke = (channel, payload) => win.khaos.invoke(channel, payload);
    const notify = (message) => typeof win.toast === 'function' && win.toast(message);
    const campaignId = () => clean(doc.getElementById('dndCampaignSelect')?.value, 100);

    function schedule() {
      if (state.scheduled) return;
      state.scheduled = true;
      win.setTimeout(() => { state.scheduled = false; enhance(); }, 0);
    }

    async function loadCatalog(force = false) {
      if (!force && state.payload && Date.now() - state.loadedAt < 10000) return state.payload;
      state.payload = await invoke('dnd:catalog-get');
      state.loadedAt = Date.now();
      schedule();
      return state.payload;
    }

    function closeModal() { doc.getElementById('dndCatalogModal')?.remove(); }
    function showModal(title, body, saveLabel, action) {
      closeModal();
      const wrapper = doc.createElement('div');
      wrapper.id = 'dndCatalogModal';
      wrapper.className = 'dnd-catalog-modal-backdrop';
      wrapper.innerHTML = `<section class="dnd-catalog-modal" role="dialog" aria-modal="true"><div class="panel-heading"><div><span class="eyebrow">D&D Workspace</span><h2>${escapeHtml(title)}</h2></div><button class="button" data-dnd-catalog-action="close-modal">Close</button></div><div id="dndCatalogModalError" class="dnd-catalog-modal-error" hidden></div>${body}<div class="form-actions"><button class="button" data-dnd-catalog-action="close-modal">Cancel</button><button class="button primary" data-dnd-catalog-action="${action}">${escapeHtml(saveLabel)}</button></div></section>`;
      doc.body.appendChild(wrapper);
      wrapper.querySelector('input,select,textarea')?.focus();
    }
    function modalError(error) {
      const target = doc.getElementById('dndCatalogModalError');
      if (!target) return;
      target.textContent = error?.message || String(error);
      target.hidden = false;
      if (error?.field) doc.querySelector(`[name="${error.field}"]`)?.focus();
    }

    function packCard(pack) {
      const status = statusLabel(pack.status);
      const action = pack.status === 'installed'
        ? `<button class="button" data-dnd-catalog-action="open-pack" data-pack-id="${escapeHtml(pack.id)}">Open</button><button class="button danger" data-dnd-catalog-action="remove-pack" data-pack-id="${escapeHtml(pack.id)}">Remove</button>`
        : pack.status === 'update_available' || pack.status === 'invalid'
          ? `<button class="button primary" data-dnd-catalog-action="install-pack" data-pack-id="${escapeHtml(pack.id)}">${pack.status === 'invalid' ? 'Repair' : 'Update'}</button><button class="button danger" data-dnd-catalog-action="remove-pack" data-pack-id="${escapeHtml(pack.id)}">Remove</button>`
          : `<button class="button primary" data-dnd-catalog-action="install-pack" data-pack-id="${escapeHtml(pack.id)}">Download & Install</button>`;
      return `<article class="dnd-catalog-pack"><div><span class="eyebrow">${escapeHtml(pack.ruleset)} · ${escapeHtml(pack.licenseId)}</span><h3>${escapeHtml(pack.name)}</h3><p>${escapeHtml(pack.description)}</p><small>Version ${escapeHtml(pack.version)} · ${Math.ceil(pack.bytes / 1024 / 1024)} MB · ${escapeHtml(status)}</small><details><summary>Attribution</summary><p>${escapeHtml(pack.attributionText)}</p></details></div><div class="server-actions">${action}<button class="button" data-dnd-catalog-action="open-license" data-pack-id="${escapeHtml(pack.id)}">License</button></div></article>`;
    }

    function renderCatalogPanel(sourcePanel) {
      let panel = sourcePanel.parentElement?.querySelector('[data-dnd-catalog-panel]');
      if (!panel) {
        panel = doc.createElement('article');
        panel.className = 'panel dnd-catalog-panel';
        panel.dataset.dndCatalogPanel = 'true';
        sourcePanel.insertAdjacentElement('afterend', panel);
      }
      const catalog = state.payload?.catalog;
      panel.innerHTML = `<div class="panel-heading"><div><span class="eyebrow">Local content storage</span><h3>Free Content Downloads</h3></div><div class="server-actions"><span class="tag">${catalog?.packs?.length || 0}</span><button class="button" data-dnd-catalog-action="refresh-catalog">Check for New Content</button><button class="button primary" data-dnd-catalog-action="new-homebrew-source">Homebrew / Custom Source</button></div></div><div class="callout">Catalog refreshes may add approved free downloads without a client update. Nothing downloads or installs automatically. Every file is verified by exact size, type, and SHA-256 before it enters protected local storage.</div>${catalog ? `<div class="dnd-catalog-trust"><span>${catalog.remote.available ? `Remote catalog verified at ${escapeHtml(catalog.remote.refreshedAt || 'unknown time')}` : 'Using built-in offline catalog'}</span><small>${escapeHtml(catalog.policy.trust)}</small></div><div class="dnd-catalog-list">${catalog.packs.map(packCard).join('')}</div>` : '<p class="dnd-empty">Loading trusted catalog…</p>'}`;
    }

    function enhanceSources(root) {
      const list = root.querySelector('.dnd-source-list');
      const sourcePanel = list?.closest('.panel');
      if (!sourcePanel) return;
      renderCatalogPanel(sourcePanel);
      loadCatalog().catch((error) => notify(error.message || String(error)));
    }

    function enhanceCharacters(root) {
      const panel = root.querySelector('.dnd-character-management .panel');
      const actions = panel?.querySelector('.panel-heading .server-actions');
      if (!actions || actions.querySelector('[data-dnd-catalog-action="import-character"]')) return;
      const button = doc.createElement('button');
      button.className = 'button';
      button.dataset.dndCatalogAction = 'import-character';
      button.textContent = 'Import Character';
      actions.appendChild(button);
    }

    function enhance() {
      const root = doc.getElementById('view-dnd');
      if (!root) return;
      enhanceSources(root);
      enhanceCharacters(root);
    }

    function homebrewDialog() {
      showModal('Create Homebrew / Custom Source', `<form id="dndHomebrewSourceForm" novalidate><div class="form-grid"><label>Source name<input name="name" maxlength="160" required></label><label>Version<input name="version" value="1.0" maxlength="80"></label></div><div class="form-grid"><label>Ruleset<select name="ruleset"><option value="5e_2024">5e 2024</option><option value="5e_2014">5e 2014</option><option value="system_neutral">System neutral</option></select></label><label>Visibility<select name="visibility"><option value="private">Private to Owner/DM</option><option value="campaign">Campaign shared</option></select></label></div><label>Author<input name="author" maxlength="160"></label><label>Description<textarea name="description" rows="4" maxlength="4000"></textarea></label><label>Attribution<input name="attributionText" maxlength="1000" placeholder="Created by …"></label><label>External HTTPS reference<input name="externalReferenceUrl" maxlength="800" placeholder="https://"></label><div class="callout warning">Use this only for material you authored or have permission to store. Do not relabel paid third-party rulebook content as Homebrew.</div></form>`, 'Create Source', 'save-homebrew-source');
    }

    function importDialog(result) {
      state.pendingImport = result;
      const value = result.draft;
      const collision = result.collisions?.length ? `<div class="callout warning">A character named ${escapeHtml(value.name)} already exists. Import creates a separate new character and never overwrites it.</div>` : '';
      showModal('Review Imported Character', `${collision}<div class="dnd-import-provenance"><strong>${escapeHtml(result.review.sourceFileName)}</strong><span>${escapeHtml(result.review.format)} · ${result.review.bytes} bytes</span><code>${escapeHtml(result.review.sha256)}</code></div><form id="dndCharacterImportReview" novalidate><div class="form-grid"><label>Name<input name="name" value="${escapeHtml(value.name)}" maxlength="120" required></label><label>Class<input name="className" value="${escapeHtml(value.className || '')}" maxlength="120"></label></div><div class="form-grid three"><label>Level<input name="level" type="number" min="0" max="30" value="${escapeHtml(value.level)}"></label><label>Current HP<input name="hp" type="number" min="0" value="${escapeHtml(value.hp)}"></label><label>Maximum HP<input name="maxHp" type="number" min="0" value="${escapeHtml(value.maxHp)}"></label></div><div class="form-grid three"><label>Armor Class<input name="armorClass" type="number" min="0" max="99" value="${escapeHtml(value.armorClass)}"></label><label>Initiative modifier<input name="initiativeModifier" type="number" value="${escapeHtml(value.initiativeModifier)}"></label><label>Exhaustion<input name="exhaustion" type="number" min="0" max="6" value="${escapeHtml(value.exhaustion)}"></label></div><div class="form-grid"><label>Owner user ID<input name="ownerUserId" value="${escapeHtml(value.ownerUserId || '')}" maxlength="100"></label><label>Discord user ID<input name="discordUserId" value="${escapeHtml(value.discordUserId || '')}" maxlength="25"></label></div><label>Portrait URL<input name="portraitUrl" value="${escapeHtml(value.portraitUrl || '')}" maxlength="800"></label><label>Conditions<input name="conditions" value="${escapeHtml((value.conditions || []).join(', '))}" maxlength="500"></label><div class="form-grid"><label class="toggle-row"><span><strong>Inspiration</strong></span><input name="inspiration" type="checkbox" ${value.inspiration ? 'checked' : ''}></label><label class="toggle-row"><span><strong>Set active character</strong></span><input name="selected" type="checkbox" ${value.selected ? 'checked' : ''}></label></div></form>`, 'Import New Character', 'save-character-import');
    }

    async function refreshWorkspace(tab) {
      doc.querySelector('[data-view="dnd"]')?.click();
      win.setTimeout(() => {
        const selector = tab === 'characters' ? '[data-dnd-repair-tab="characters"]' : `[data-dnd-tab="${tab}"]`;
        doc.querySelector(selector)?.click();
      }, 100);
    }

    async function withBusy(operation) {
      if (state.busy) return;
      state.busy = true;
      try { await operation(); }
      catch (error) { modalError(error); if (!doc.getElementById('dndCatalogModal')) notify(error.message || String(error)); }
      finally { state.busy = false; }
    }

    async function handleAction(target) {
      const action = target.dataset.dndCatalogAction;
      const packId = clean(target.dataset.packId, 100);
      if (action === 'close-modal') { closeModal(); return; }
      if (action === 'refresh-catalog') return withBusy(async () => { state.payload = await invoke('dnd:catalog-refresh'); state.loadedAt = Date.now(); schedule(); notify('Free content catalog refreshed.'); });
      if (action === 'install-pack') return withBusy(async () => { if (!win.confirm('Download, verify, and install this free content pack?')) return; const result = await invoke('dnd:catalog-install', { packId }); state.payload = result.state; state.loadedAt = Date.now(); schedule(); notify('Content pack installed and added to Sources.'); await refreshWorkspace('sources'); });
      if (action === 'remove-pack') return withBusy(async () => { if (!win.confirm('Remove the local content file? Campaign source selections will be preserved.')) return; const result = await invoke('dnd:catalog-remove', { packId }); state.payload = result.state; state.loadedAt = Date.now(); schedule(); notify('Local content pack removed.'); await refreshWorkspace('sources'); });
      if (action === 'open-pack') return withBusy(async () => { const error = await invoke('dnd:catalog-open', { packId }); if (error) notify(error); });
      if (action === 'open-license') return withBusy(() => invoke('dnd:catalog-open-license', { packId }));
      if (action === 'new-homebrew-source') { homebrewDialog(); return; }
      if (action === 'save-homebrew-source') return withBusy(async () => {
        const form = doc.getElementById('dndHomebrewSourceForm');
        const data = Object.fromEntries(new win.FormData(form).entries());
        const draft = validateHomebrewSourceDraft(data);
        await invoke('dnd:homebrew-source-save', draft);
        closeModal(); notify('Homebrew source created.'); await refreshWorkspace('sources');
      });
      if (action === 'import-character') return withBusy(async () => { const result = await invoke('dnd:character-import-pick', { campaignId: campaignId() }); if (!result.canceled) importDialog(result); });
      if (action === 'save-character-import') return withBusy(async () => {
        const form = doc.getElementById('dndCharacterImportReview');
        const raw = Object.fromEntries(new win.FormData(form).entries());
        raw.inspiration = form.elements.inspiration.checked;
        raw.selected = form.elements.selected.checked;
        const draft = validateImportReview({ ...state.pendingImport.draft, ...raw, campaignId: campaignId(), metadata: state.pendingImport.draft.metadata });
        delete draft.id;
        await invoke('dnd:character-save', draft);
        closeModal(); state.pendingImport = null; notify('Character imported as a new campaign character.'); await refreshWorkspace('characters');
      });
    }

    doc.addEventListener('click', (event) => {
      const target = event.target.closest('[data-dnd-catalog-action]');
      if (target) { event.preventDefault(); handleAction(target); }
    });
    state.observer = new win.MutationObserver((mutations) => {
      if (mutations.some((mutation) => [...mutation.addedNodes].some((node) => node?.nodeType === 1 && (node.id === 'view-dnd' || node.querySelector?.('.dnd-source-list,.dnd-character-management'))))) schedule();
    });
    state.observer.observe(doc.body, { childList: true, subtree: true });
    schedule();
    win.__khaosDndContentCatalog = { state, loadCatalog, enhance };
    return win.__khaosDndContentCatalog;
  }

  return { install, validateHomebrewSourceDraft, validateImportReview, statusLabel };
});
