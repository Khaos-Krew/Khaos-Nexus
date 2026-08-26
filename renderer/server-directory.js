'use strict';

(() => {
  const state = { payload: null, selectedId: null };
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

  function notify(message) {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = String(message || 'Done.');
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3500);
  }

  async function invoke(channel, payload) {
    try { return await window.khaos.invoke(channel, payload); }
    catch (error) { notify(error.message || String(error)); throw error; }
  }

  function canCreateOfficial() { return Boolean(state.payload?.permissions?.canCreateOfficial); }
  function canReview() { return Boolean(state.payload?.permissions?.canReviewCommunity); }
  function selectedRecord() { return state.payload?.servers?.find((item) => item.id === state.selectedId) || null; }

  function ensureShell() {
    if (typeof viewMeta !== 'undefined') viewMeta['server-directory'] = ['Server Directory', 'Official servers and vetted community server applications.'];
    if (!document.querySelector('[data-view="server-directory"]')) {
      const hosted = document.querySelector('[data-view="hosted-servers"]') || document.querySelector('[data-view="servers"]');
      const button = document.createElement('button');
      button.className = 'nav-item';
      button.dataset.view = 'server-directory';
      button.innerHTML = '<span>◈</span>Server Directory';
      hosted?.insertAdjacentElement('afterend', button);
    }
    if ($('view-server-directory')) return;

    const view = document.createElement('section');
    view.className = 'view';
    view.id = 'view-server-directory';
    view.innerHTML = `
      <div class="directory-intro">
        <div><span class="eyebrow">Community Infrastructure</span><h2>Server Directory</h2><p>Game-aware server listings with staff-only official registration and vetted community applications.</p></div>
        <div class="directory-header-actions"><button class="button primary" id="directoryNew">New Server</button><button class="button" id="directoryReload">Reload</button></div>
      </div>
      <div id="directorySummary" class="directory-summary"></div>
      <div class="directory-layout">
        <aside class="panel directory-list-panel"><div class="panel-heading"><div><span class="eyebrow">Registry</span><h3>Servers & Applications</h3></div></div><div id="directoryList"></div></aside>
        <article class="panel directory-editor">
          <div class="panel-heading"><div><span class="eyebrow" id="directoryModeLabel">Application</span><h3 id="directoryEditorTitle">New Server</h3></div><span id="directoryState" class="severity">Draft</span></div>
          <input id="directoryId" type="hidden">
          <div id="directoryOwnershipWrap" class="form-grid two"></div>
          <div class="form-grid two">
            <label>Game<select id="directoryGame"></select></label>
            <label>Server type<select id="directoryServerType"></select></label>
          </div>
          <div id="directoryDynamicFields"></div>
          <div id="directoryCommunityVetting"></div>
          <div class="form-actions">
            <button class="button primary" id="directorySave">Save Draft</button>
            <button class="button primary" id="directorySubmit">Submit Application</button>
            <button class="button" id="directoryApprove">Approve & List</button>
            <button class="button danger" id="directoryDeny">Deny</button>
            <button class="button danger" id="directoryRemove">Remove</button>
          </div>
        </article>
      </div>`;
    document.querySelector('main.content')?.appendChild(view);
    bind();
  }

  function gameOptions() {
    const games = Object.keys(state.payload?.schemas?.games || {});
    return games.map((game) => `<option value="${esc(game)}">${esc(game.replaceAll('-', ' ').replace(/\b\w/g, (m) => m.toUpperCase()))}</option>`).join('');
  }

  function renderOwnership(record = {}) {
    const wrap = $('directoryOwnershipWrap');
    const ownership = record.ownerType || 'community';
    if (canCreateOfficial()) {
      wrap.innerHTML = `<label>Listing type<select id="directoryOwnerType"><option value="community" ${ownership === 'community' ? 'selected' : ''}>Community Member Server</option><option value="nexus-official" ${ownership === 'nexus-official' ? 'selected' : ''}>Khaos Nexus Official</option></select></label><label>Owner / Contact<input id="directoryOwnerName" value="${esc(record.ownerDisplayName || '')}" maxlength="160"></label>`;
    } else {
      wrap.innerHTML = `<input id="directoryOwnerType" type="hidden" value="community"><label>Application type<input value="Community Server Application" disabled></label><label>Owner / Contact<input id="directoryOwnerName" value="${esc(record.ownerDisplayName || '')}" maxlength="160"></label>`;
    }
  }

  function field(label, id, value = '', type = 'text', extra = '') {
    return `<label>${esc(label)}<input id="${id}" type="${type}" value="${esc(value)}" ${extra}></label>`;
  }

  function textArea(label, id, value = '') {
    return `<label>${esc(label)}<textarea id="${id}" rows="3">${esc(value)}</textarea></label>`;
  }

  function renderDynamic(record = {}) {
    const typeId = $('directoryServerType').value;
    const schema = state.payload?.schemas?.serverTypes?.[typeId];
    if (!schema) return;
    const chunks = [];
    const fields = new Set(schema.fields || []);
    if (fields.has('serverName')) chunks.push(field('Server name', 'directoryServerName', record.serverName || ''));
    if (fields.has('customServerId')) chunks.push(field('Once Human Custom Server ID', 'directoryCustomServerId', record.customServerId || '', 'text', 'inputmode="numeric" placeholder="10101801696"'));
    if (fields.has('host')) chunks.push(field('Host / IP', 'directoryHost', record.host || '', 'text', 'placeholder="play.example.com"'));
    if (fields.has('gamePort')) chunks.push(field('Game port', 'directoryGamePort', record.gamePort || '', 'number'));
    if (fields.has('queryPort')) chunks.push(field('Query port', 'directoryQueryPort', record.queryPort || '', 'number'));
    if (fields.has('rconPort')) chunks.push(field('RCON / Admin port', 'directoryRconPort', record.rconPort || '', 'number'));
    if (fields.has('region')) chunks.push(field('Region', 'directoryRegion', record.region || ''));
    if (fields.has('scenario')) chunks.push(field('Scenario', 'directoryScenario', record.scenario || ''));
    if (fields.has('realmOwner')) chunks.push(field('Realm owner', 'directoryRealmOwner', record.realmOwner || ''));
    if (fields.has('realmInviteCode')) chunks.push(field('Realm invite code', 'directoryRealmInviteCode', record.realmInviteCode || '', 'password', 'autocomplete="new-password"'));
    if (fields.has('realmShareLink')) chunks.push(field('Realm share link', 'directoryRealmShareLink', record.realmShareLink || '', 'password', 'autocomplete="new-password"'));
    if (fields.has('joinPassword')) chunks.push(field('Join password (optional)', 'directoryJoinPassword', record.joinPassword || '', 'password', 'autocomplete="new-password"'));
    if (fields.has('joinApproval')) chunks.push(`<label>Join access<select id="directoryJoinApproval"><option value="request-access">Request Access</option><option value="approved-members">Approved Members Only</option><option value="public">Public</option></select></label>`);
    if (fields.has('publicVisibility')) chunks.push(`<label>Directory visibility<select id="directoryVisibility"><option value="listed">Listed</option><option value="members-only">Members Only</option><option value="hidden">Hidden</option></select></label>`);
    if (fields.has('description')) chunks.push(textArea('Description', 'directoryDescription', record.description || ''));
    if (fields.has('joinInstructions')) chunks.push(textArea('Join instructions', 'directoryJoinInstructions', record.joinInstructions || ''));
    if (fields.has('adminNotes')) chunks.push(textArea('Admin-only notes', 'directoryAdminNotes', record.adminNotes || ''));
    $('directoryDynamicFields').innerHTML = `<div class="form-grid two">${chunks.join('')}</div><div class="directory-capability-note"><strong>Health:</strong> ${esc(schema.health?.automatic ? 'Automatic checks supported' : 'Manual / connector-based verification')} &nbsp; <strong>Management:</strong> ${esc(schema.management?.mode || 'adapter')}</div>`;
    if ($('directoryJoinApproval')) $('directoryJoinApproval').value = record.joinApproval || 'request-access';
    if ($('directoryVisibility')) $('directoryVisibility').value = record.publicVisibility || 'listed';
  }

  function renderVetting(record = {}) {
    const isCommunity = ($('directoryOwnerType')?.value || 'community') === 'community';
    $('directoryCommunityVetting').innerHTML = !isCommunity ? '' : `
      <div class="directory-vetting"><div class="panel-heading"><div><span class="eyebrow">Required Vetting</span><h3>Community Server Monetization</h3></div></div>
      <div class="form-grid three">
        <label class="toggle-row compact"><span><strong>Accepts donations</strong></span><input id="directoryDonations" type="checkbox" ${record.monetization?.acceptsDonations ? 'checked' : ''}></label>
        <label class="toggle-row compact"><span><strong>Sells cosmetics</strong></span><input id="directoryCosmetics" type="checkbox" ${record.monetization?.sellsCosmetics ? 'checked' : ''}></label>
        <label class="toggle-row compact"><span><strong>Paid gameplay advantages</strong></span><input id="directoryP2w" type="checkbox" ${record.monetization?.sellsGameplayAdvantages ? 'checked' : ''}></label>
        <label class="toggle-row compact"><span><strong>Payment required to join</strong></span><input id="directoryPaidJoin" type="checkbox" ${record.monetization?.requiresPaymentToJoin ? 'checked' : ''}></label>
        <label class="toggle-row compact"><span><strong>Affiliate/referral revenue</strong></span><input id="directoryAffiliate" type="checkbox" ${record.monetization?.affiliateOrReferralRevenue ? 'checked' : ''}></label>
        <label class="toggle-row compact"><span><strong>Intended for profit</strong></span><input id="directoryProfit" type="checkbox" ${record.monetization?.intendedForProfit ? 'checked' : ''}></label>
      </div>
      <div class="form-grid two">${field('Monthly operating cost', 'directoryCost', record.monetization?.monthlyOperatingCost || 0, 'number', 'min="0" step="0.01"')}${field('Expected monthly revenue', 'directoryRevenue', record.monetization?.expectedMonthlyRevenue || 0, 'number', 'min="0" step="0.01"')}</div>
      ${textArea('Monetization disclosure', 'directoryDisclosure', record.monetization?.disclosure || '')}
      <div class="directory-policy-note">Community servers may recover legitimate operating costs, but may not use Khaos Nexus members as a profit source. Mandatory paid access and pay-to-win gameplay advantages are automatic blockers.</div></div>`;
  }

  function typeOptions(gameId, selected = '') {
    const ids = state.payload?.schemas?.games?.[gameId] || ['generic'];
    return ids.map((id) => {
      const schema = state.payload?.schemas?.serverTypes?.[id];
      return `<option value="${esc(id)}" ${id === selected ? 'selected' : ''}>${esc(schema?.label || id)}</option>`;
    }).join('');
  }

  function fill(record = {}) {
    state.selectedId = record.id || null;
    $('directoryId').value = record.id || '';
    renderOwnership(record);
    $('directoryGame').innerHTML = gameOptions();
    $('directoryGame').value = record.gameId || 'once-human';
    $('directoryServerType').innerHTML = typeOptions($('directoryGame').value, record.serverType || '');
    renderDynamic(record);
    renderVetting(record);
    $('directoryEditorTitle').textContent = record.serverName || (canCreateOfficial() ? 'New Server' : 'Community Server Application');
    $('directoryModeLabel').textContent = canCreateOfficial() ? 'Server Registration' : 'Application';
    $('directoryState').textContent = record.applicationState || 'draft';
    $('directorySubmit').style.display = (($('directoryOwnerType')?.value || 'community') === 'community') ? '' : 'none';
    $('directoryApprove').style.display = canReview() && record.id && record.ownerType === 'community' ? '' : 'none';
    $('directoryDeny').style.display = canReview() && record.id && record.ownerType === 'community' ? '' : 'none';
    $('directoryRemove').style.display = canReview() && record.id ? '' : 'none';
  }

  function collect() {
    const get = (id) => $(id)?.value || '';
    return {
      id: get('directoryId') || undefined,
      ownerType: get('directoryOwnerType') || 'community',
      ownerDisplayName: get('directoryOwnerName'),
      gameId: get('directoryGame'),
      serverType: get('directoryServerType'),
      serverName: get('directoryServerName'), customServerId: get('directoryCustomServerId'), host: get('directoryHost'),
      gamePort: get('directoryGamePort'), queryPort: get('directoryQueryPort'), rconPort: get('directoryRconPort'), region: get('directoryRegion'), scenario: get('directoryScenario'),
      realmOwner: get('directoryRealmOwner'), realmInviteCode: get('directoryRealmInviteCode'), realmShareLink: get('directoryRealmShareLink'), joinPassword: get('directoryJoinPassword'),
      joinApproval: get('directoryJoinApproval'), publicVisibility: get('directoryVisibility'), description: get('directoryDescription'), joinInstructions: get('directoryJoinInstructions'), adminNotes: get('directoryAdminNotes'),
      monetization: {
        acceptsDonations: Boolean($('directoryDonations')?.checked), sellsCosmetics: Boolean($('directoryCosmetics')?.checked), sellsGameplayAdvantages: Boolean($('directoryP2w')?.checked),
        requiresPaymentToJoin: Boolean($('directoryPaidJoin')?.checked), affiliateOrReferralRevenue: Boolean($('directoryAffiliate')?.checked), intendedForProfit: Boolean($('directoryProfit')?.checked),
        monthlyOperatingCost: Number(get('directoryCost')) || 0, expectedMonthlyRevenue: Number(get('directoryRevenue')) || 0, disclosure: get('directoryDisclosure')
      }
    };
  }

  function renderSummary() {
    const all = state.payload?.servers || [];
    const listed = all.filter((s) => s.applicationState === 'listed').length;
    const review = all.filter((s) => ['submitted', 'automated-review', 'staff-review', 'changes-required'].includes(s.applicationState)).length;
    const official = all.filter((s) => s.ownerType === 'nexus-official').length;
    $('directorySummary').innerHTML = `<article><span>Listed</span><strong>${listed}</strong></article><article><span>Applications</span><strong>${review}</strong></article><article><span>Official</span><strong>${official}</strong></article><article><span>Access</span><strong>${esc(state.payload?.role || 'member')}</strong></article>`;
  }

  function renderList() {
    const list = state.payload?.servers || [];
    $('directoryList').innerHTML = list.length ? list.map((s) => `<button class="directory-card ${s.id === state.selectedId ? 'active' : ''}" data-directory-id="${esc(s.id)}"><span><strong>${esc(s.serverName)}</strong><small>${esc(s.gameId)} • ${esc(s.ownerType === 'nexus-official' ? 'Nexus Official' : 'Community')}</small></span><span class="severity">${esc(s.applicationState)}</span></button>`).join('') : '<div class="hosted-empty">No servers or applications yet.</div>';
    document.querySelectorAll('[data-directory-id]').forEach((button) => button.addEventListener('click', () => fill(state.payload.servers.find((s) => s.id === button.dataset.directoryId) || {})));
  }

  function render() { renderSummary(); renderList(); if (!selectedRecord()) fill({ ownerType: 'community', gameId: 'once-human', serverType: 'once-human-custom' }); }

  async function load() { state.payload = await invoke('server-directory:get'); render(); }

  function bind() {
    document.addEventListener('click', (event) => { const nav = event.target.closest('[data-view="server-directory"]'); if (nav) openView(); });
    $('directoryNew').addEventListener('click', () => fill({ ownerType: 'community', gameId: 'once-human', serverType: 'once-human-custom' }));
    $('directoryReload').addEventListener('click', load);
    $('directoryGame').addEventListener('change', () => { $('directoryServerType').innerHTML = typeOptions($('directoryGame').value); renderDynamic({}); });
    $('directoryServerType').addEventListener('change', () => renderDynamic({}));
    $('directoryOwnershipWrap').addEventListener('change', (event) => { if (event.target?.id === 'directoryOwnerType') { renderVetting({}); $('directorySubmit').style.display = event.target.value === 'community' ? '' : 'none'; } });
    $('directorySave').addEventListener('click', async () => { state.payload = await invoke('server-directory:save', collect()); notify('Server draft saved.'); render(); });
    $('directorySubmit').addEventListener('click', async () => { state.payload = await invoke('server-directory:submit', collect()); notify('Community server application submitted.'); render(); });
    $('directoryApprove').addEventListener('click', async () => { const id = $('directoryId').value; state.payload = await invoke('server-directory:transition', { id, state: 'listed', notes: 'Approved and listed by staff.' }); notify('Community server approved and listed.'); render(); });
    $('directoryDeny').addEventListener('click', async () => { const id = $('directoryId').value; const notes = prompt('Reason for denial:') || ''; if (!notes) return; state.payload = await invoke('server-directory:transition', { id, state: 'denied', notes }); notify('Application denied.'); render(); });
    $('directoryRemove').addEventListener('click', async () => { const id = $('directoryId').value; if (!id || !confirm('Remove this server record?')) return; state.payload = await invoke('server-directory:remove', id); state.selectedId = null; render(); });
    window.khaos.on?.('server-directory:update', (payload) => { state.payload = payload; render(); });
  }

  function openView() {
    document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active', el.id === 'view-server-directory'));
    document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.view === 'server-directory'));
    if ($('viewTitle')) $('viewTitle').textContent = 'Server Directory';
    if ($('viewSubtitle')) $('viewSubtitle').textContent = 'Official servers and vetted community server applications.';
    load().catch(() => {});
  }

  ensureShell();
  load().catch(() => {});
})();
