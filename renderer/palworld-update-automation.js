'use strict';

(() => {
  const state = { payload: null, selectedId: null, timer: null };
  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  }

  function notify(message) {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = String(message || 'Done.');
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('show'), 4200);
  }

  async function invoke(channel, payload) {
    try { return await window.khaos.invoke(channel, payload); }
    catch (error) { notify(error.message || String(error)); throw error; }
  }

  function canOperate() { return ['operator', 'owner', 'local-admin'].includes(state.payload?.role); }
  function canOwn() { return ['owner', 'local-admin'].includes(state.payload?.role); }
  function profiles() { return state.payload?.config?.profiles || []; }
  function selected() { return profiles().find((profile) => profile.id === state.selectedId) || null; }
  function profileState(profileId = state.selectedId) { return state.payload?.profiles?.[profileId] || {}; }
  function newId() { return `palworld-update-${crypto.randomUUID()}`; }

  function defaultProfile() {
    return {
      id: newId(), name: 'Palworld on Nitrado', serverId: '', nitradoServiceId: '', enabled: true,
      monitorUpdates: true, autoApply: false, discordChannelId: '', checkIntervalMinutes: 15,
      stagingDelayMinutes: 60, warningMinutes: [15, 10, 5, 2, 1], saveBeforeRestart: true,
      saveDelaySeconds: 10, verifyTimeoutMinutes: 15, hasToken: false
    };
  }

  function ensureShell() {
    if (typeof viewMeta !== 'undefined') viewMeta['palworld-updates'] = ['Palworld Updates', 'Nitrado restart control and guarded automatic Palworld update maintenance.'];
    if (!document.querySelector('[data-view="palworld-updates"]')) {
      const anchor = document.querySelector('[data-view="hosted-servers"]') || document.querySelector('[data-view="scheduler"]') || document.querySelector('[data-view="servers"]');
      const button = document.createElement('button');
      button.className = 'nav-item';
      button.dataset.view = 'palworld-updates';
      button.innerHTML = '<span>↻</span>Palworld Updates';
      anchor?.insertAdjacentElement('afterend', button);
    }
    if ($('view-palworld-updates')) return;

    const view = document.createElement('section');
    view.className = 'view';
    view.id = 'view-palworld-updates';
    view.innerHTML = `
      <div class="pwu-hero">
        <div><span class="eyebrow">PALWORLD / NITRADO</span><h2>Update Automation</h2><p>Detect new Palworld dedicated-server builds, alert Discord, warn players in-game, save safely, restart Nitrado, and verify the server returns.</p></div>
        <div class="pwu-hero-actions"><button class="button" id="pwuReload">Refresh</button><button class="button primary" id="pwuCheck">Check Steam Now</button></div>
      </div>
      <div class="pwu-safety"><strong>Nexus Core guarded</strong><span>Tokens stay in Windows protected storage. Automatic restart cannot replay after an uncertain destructive step.</span></div>

      <div class="pwu-layout">
        <aside class="panel pwu-profile-panel">
          <div class="panel-heading"><div><span class="eyebrow">Policies</span><h3>Update Profiles</h3></div><button class="button" id="pwuNew">New</button></div>
          <div id="pwuProfiles" class="pwu-profiles"></div>
        </aside>

        <article class="panel pwu-config-panel">
          <div class="panel-heading"><div><span class="eyebrow">Provider & Policy</span><h3 id="pwuTitle">Palworld on Nitrado</h3></div><span class="severity" id="pwuConfigBadge">Draft</span></div>
          <input id="pwuId" type="hidden">
          <div class="form-grid three">
            <label>Profile name<input id="pwuName" maxlength="100"></label>
            <label>Khaos Nexus Palworld server<select id="pwuServer"></select></label>
            <label>Nitrado Service ID<input id="pwuServiceId" inputmode="numeric" placeholder="12345678"></label>
          </div>
          <div class="form-grid two">
            <label>Nitrado API token<input id="pwuToken" type="password" autocomplete="new-password" placeholder="Leave blank to keep the protected token"></label>
            <label>Discord update channel ID<input id="pwuDiscordChannel" inputmode="numeric" placeholder="123456789012345678"></label>
          </div>
          <div class="form-grid three">
            <label>Check interval<select id="pwuCheckInterval"><option value="5">5 minutes</option><option value="10">10 minutes</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">60 minutes</option></select></label>
            <label>Nitrado staging delay (minutes)<input id="pwuStaging" type="number" min="0" max="720"></label>
            <label>Warning timeline (minutes)<input id="pwuWarnings" placeholder="15, 10, 5, 2, 1"></label>
          </div>
          <div class="form-grid two">
            <label>Save settle delay (seconds)<input id="pwuSaveDelay" type="number" min="0" max="120"></label>
            <label>Restart verification timeout (minutes)<input id="pwuVerifyTimeout" type="number" min="2" max="60"></label>
          </div>
          <div class="pwu-toggles">
            <label class="toggle-row"><span><strong>Profile enabled</strong><small>Allows this policy to participate in the shared scheduler.</small></span><input id="pwuEnabled" type="checkbox"></label>
            <label class="toggle-row"><span><strong>Monitor Steam updates</strong><small>Uses Palworld dedicated-server App ID 2394010.</small></span><input id="pwuMonitor" type="checkbox"></label>
            <label class="toggle-row"><span><strong>Automatically apply detected updates</strong><small>Waits for Nitrado staging, then begins the configured warning countdown.</small></span><input id="pwuAutoApply" type="checkbox"></label>
            <label class="toggle-row"><span><strong>Save before restart</strong><small>Recommended. A failed save blocks the automatic restart.</small></span><input id="pwuSaveBefore" type="checkbox"></label>
          </div>
          <div class="form-actions">
            <button class="button primary" id="pwuSave">Save Profile</button>
            <button class="button" id="pwuTest">Test Nitrado</button>
            <button class="button danger" id="pwuRemove">Remove</button>
          </div>
        </article>
      </div>

      <article class="panel pwu-status-panel">
        <div class="panel-heading"><div><span class="eyebrow">Live Update State</span><h3>Maintenance Coordinator</h3></div><span class="severity" id="pwuStageBadge">Idle</span></div>
        <div id="pwuSummary" class="pwu-summary"></div>
        <div id="pwuCandidate" class="pwu-candidate"></div>
        <div class="pwu-action-row">
          <button class="button primary" id="pwuStart">Start Guarded Update Workflow</button>
          <button class="button" id="pwuCancel">Cancel Countdown</button>
          <button class="button danger" id="pwuRestart">Restart Nitrado Now</button>
        </div>
      </article>`;
    document.querySelector('main.content')?.appendChild(view);
    bind();
  }

  function openView() {
    document.querySelectorAll('.view').forEach((element) => element.classList.toggle('active', element.id === 'view-palworld-updates'));
    document.querySelectorAll('.nav-item').forEach((element) => element.classList.toggle('active', element.dataset.view === 'palworld-updates'));
    if ($('viewTitle')) $('viewTitle').textContent = 'Palworld Updates';
    if ($('viewSubtitle')) $('viewSubtitle').textContent = 'Nitrado restart control and guarded automatic Palworld update maintenance.';
    refresh().catch(() => {});
  }

  function formatDate(value, fallback = 'Never') {
    if (!value) return fallback;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : fallback;
  }

  function stageTone(stage) {
    if (stage === 'success') return 'good';
    if (['failed', 'uncertain'].includes(stage)) return 'bad';
    if (['countdown', 'saving', 'restarting', 'verifying', 'detected'].includes(stage)) return 'warn';
    return '';
  }

  function renderProfiles() {
    $('pwuProfiles').innerHTML = profiles().length ? profiles().map((profile) => {
      const runtime = profileState(profile.id);
      const stage = runtime.candidate?.stage || 'idle';
      return `<button class="pwu-profile ${profile.id === state.selectedId ? 'active' : ''}" data-pwu-profile="${escapeHtml(profile.id)}">
        <span><strong>${escapeHtml(profile.name)}</strong><small>${profile.nitradoServiceId ? `Nitrado ${escapeHtml(profile.nitradoServiceId)}` : 'Nitrado not configured'} • ${profile.autoApply ? 'Auto apply' : 'Notify/manual'}</small></span>
        <i class="pwu-dot ${escapeHtml(stageTone(stage))}"></i>
      </button>`;
    }).join('') : '<div class="pwu-empty">No Palworld update profiles yet.</div>';
  }

  function fill(profileInput) {
    const profile = profileInput || defaultProfile();
    state.selectedId = profile.id;
    $('pwuId').value = profile.id;
    $('pwuName').value = profile.name || '';
    const servers = state.payload?.servers || [];
    $('pwuServer').innerHTML = `<option value="">Select Palworld server</option>${servers.map((server) => `<option value="${escapeHtml(server.id)}">${escapeHtml(server.name)}${server.enabled ? '' : ' (disabled)'}</option>`).join('')}`;
    $('pwuServer').value = profile.serverId || '';
    $('pwuServiceId').value = profile.nitradoServiceId || '';
    $('pwuToken').value = '';
    $('pwuDiscordChannel').value = profile.discordChannelId || '';
    $('pwuCheckInterval').value = String(profile.checkIntervalMinutes || 15);
    if (!$('pwuCheckInterval').value) $('pwuCheckInterval').value = '15';
    $('pwuStaging').value = profile.stagingDelayMinutes ?? 60;
    $('pwuWarnings').value = (profile.warningMinutes || [15, 10, 5, 2, 1]).join(', ');
    $('pwuSaveDelay').value = profile.saveDelaySeconds ?? 10;
    $('pwuVerifyTimeout').value = profile.verifyTimeoutMinutes ?? 15;
    $('pwuEnabled').checked = profile.enabled !== false;
    $('pwuMonitor').checked = profile.monitorUpdates !== false;
    $('pwuAutoApply').checked = Boolean(profile.autoApply);
    $('pwuSaveBefore').checked = profile.saveBeforeRestart !== false;
    $('pwuTitle').textContent = profile.name || 'Palworld on Nitrado';
    $('pwuConfigBadge').textContent = profile.hasToken ? 'Token protected' : profiles().some((item) => item.id === profile.id) ? 'Token needed' : 'Draft';
    $('pwuConfigBadge').className = `severity ${profile.hasToken ? 'good' : ''}`;
    renderProfiles();
    renderRuntime(profile);
    applyPermissions();
  }

  function collect() {
    const existing = selected() || {};
    return {
      ...existing,
      id: $('pwuId').value || newId(),
      name: $('pwuName').value,
      serverId: $('pwuServer').value,
      nitradoServiceId: $('pwuServiceId').value,
      discordChannelId: $('pwuDiscordChannel').value,
      enabled: $('pwuEnabled').checked,
      monitorUpdates: $('pwuMonitor').checked,
      autoApply: $('pwuAutoApply').checked,
      checkIntervalMinutes: Number($('pwuCheckInterval').value),
      stagingDelayMinutes: Number($('pwuStaging').value),
      warningMinutes: $('pwuWarnings').value.split(',').map((value) => Number(value.trim())).filter(Number.isFinite),
      saveBeforeRestart: $('pwuSaveBefore').checked,
      saveDelaySeconds: Number($('pwuSaveDelay').value),
      verifyTimeoutMinutes: Number($('pwuVerifyTimeout').value)
    };
  }

  function countdownText(candidate) {
    if (!candidate?.restartAt || candidate.stage !== 'countdown') return '';
    const remaining = Math.max(0, new Date(candidate.restartAt).getTime() - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    return `${minutes}m ${String(seconds).padStart(2, '0')}s until save/restart`;
  }

  function renderRuntime(profile) {
    const runtime = profileState(profile?.id);
    const candidate = runtime.candidate;
    const stage = candidate?.stage || 'idle';
    $('pwuStageBadge').textContent = stage.replaceAll('-', ' ');
    $('pwuStageBadge').className = `severity ${stageTone(stage)}`;
    $('pwuSummary').innerHTML = `
      <article><span>Steam build</span><strong>${escapeHtml(runtime.lastRequiredVersion || runtime.baselineVersion || 'Not checked')}</strong><small>App ${escapeHtml(state.payload?.steamAppId || 2394010)}</small></article>
      <article><span>Last check</span><strong>${escapeHtml(formatDate(runtime.lastCheckAt))}</strong><small>Next: ${escapeHtml(formatDate(runtime.nextCheckAt, 'On scheduler tick'))}</small></article>
      <article><span>Nitrado</span><strong>${escapeHtml(runtime.lastNitradoStatus || 'Not tested')}</strong><small>${runtime.lastNitradoVersion ? `Version ${escapeHtml(runtime.lastNitradoVersion)}` : 'Provider version unavailable'}</small></article>
      <article><span>Last applied build</span><strong>${escapeHtml(runtime.lastAppliedVersion || 'None yet')}</strong><small>${escapeHtml(runtime.lastError || 'No active error')}</small></article>`;
    $('pwuCandidate').innerHTML = candidate ? `
      <div class="pwu-candidate-head"><strong>Build ${escapeHtml(candidate.version)}</strong><span>${escapeHtml(countdownText(candidate) || candidate.stage)}</span></div>
      <p>${escapeHtml(candidate.summary || 'Update candidate active.')}</p>
      <div class="pwu-timeline"><span>Detected ${escapeHtml(formatDate(candidate.detectedAt))}</span><span>Stage ${escapeHtml(candidate.stage)}</span><span>${candidate.restartAt ? `Restart target ${escapeHtml(formatDate(candidate.restartAt))}` : `Apply after ${escapeHtml(formatDate(candidate.applyAfter))}`}</span></div>`
      : '<div class="pwu-empty">No pending update candidate. The first successful Steam check establishes a safe baseline and does not restart anything.</div>';

    const cancellable = ['detected', 'countdown'].includes(stage);
    $('pwuCancel').disabled = !canOperate() || !cancellable;
    $('pwuStart').disabled = !canOwn() || ['saving', 'restarting', 'verifying'].includes(stage) || !profile;
    $('pwuRestart').disabled = !canOwn() || !profile;
  }

  function applyPermissions() {
    document.querySelectorAll('#view-palworld-updates input, #view-palworld-updates select').forEach((element) => { element.disabled = !canOwn(); });
    ['pwuNew', 'pwuSave', 'pwuTest', 'pwuRemove'].forEach((id) => { if ($(id)) $(id).disabled = !canOwn(); });
    if ($('pwuCheck')) $('pwuCheck').disabled = !canOperate() || !selected();
    renderRuntime(selected());
  }

  function render() {
    if (!state.payload) return;
    if (!state.selectedId && profiles()[0]) state.selectedId = profiles()[0].id;
    const profile = selected();
    renderProfiles();
    fill(profile || defaultProfile());
  }

  async function refresh() {
    state.payload = await invoke('palworld-updates:get');
    if (state.selectedId && !profiles().some((profile) => profile.id === state.selectedId)) state.selectedId = profiles()[0]?.id || null;
    render();
  }

  async function save() {
    const profile = collect();
    state.payload = await invoke('palworld-updates:save-profile', profile);
    state.selectedId = profile.id;
    const token = $('pwuToken').value.trim();
    if (token) state.payload = await invoke('palworld-updates:set-token', { profileId: profile.id, token });
    render();
    notify('Palworld update profile saved. Nitrado credentials remain protected outside the renderer.');
  }

  function bind() {
    document.addEventListener('click', (event) => { if (event.target.closest('[data-view="palworld-updates"]')) openView(); });
    $('pwuReload').addEventListener('click', () => refresh().catch(() => {}));
    $('pwuNew').addEventListener('click', () => fill(defaultProfile()));
    $('pwuProfiles').addEventListener('click', (event) => {
      const item = event.target.closest('[data-pwu-profile]');
      if (!item) return;
      state.selectedId = item.dataset.pwuProfile;
      fill(selected());
    });
    $('pwuSave').addEventListener('click', () => save().catch(() => {}));
    $('pwuRemove').addEventListener('click', async () => {
      const profile = selected();
      if (!profile || !confirm(`Remove ${profile.name} and its protected Nitrado token?`)) return;
      state.payload = await invoke('palworld-updates:remove-profile', profile.id);
      state.selectedId = profiles()[0]?.id || null;
      render(); notify('Palworld update profile removed.');
    });
    $('pwuTest').addEventListener('click', async () => {
      const profile = selected();
      if (!profile) return notify('Save the profile first.');
      const result = await invoke('palworld-updates:test-nitrado', profile.id);
      state.payload = result.state;
      render();
      notify(`Nitrado connection succeeded: ${result.status.status}${result.status.version ? ` • ${result.status.version}` : ''}.`);
    });
    $('pwuCheck').addEventListener('click', async () => {
      const profile = selected();
      if (!profile) return notify('Save the profile first.');
      const result = await invoke('palworld-updates:check-now', profile.id);
      state.payload = result.state;
      render();
      notify(result.result.baselineEstablished ? `Steam baseline established at build ${result.result.requiredVersion}.` : `Steam reports build ${result.result.requiredVersion}.`);
    });
    $('pwuStart').addEventListener('click', async () => {
      const profile = selected();
      if (!profile) return;
      const minutes = Math.max(...(profile.warningMinutes || [15]));
      if (!confirm(`Start the guarded ${minutes}-minute update countdown for ${profile.name}? Khaos Nexus will warn Discord and players, save the world, then restart Nitrado.`)) return;
      const result = await invoke('palworld-updates:start-workflow', profile.id);
      state.payload = result.state;
      render(); notify('Guarded Palworld update countdown started.');
    });
    $('pwuCancel').addEventListener('click', async () => {
      const profile = selected();
      if (!profile || !confirm('Cancel this update workflow before the save/restart stage?')) return;
      const result = await invoke('palworld-updates:cancel', profile.id);
      state.payload = result.state;
      render(); notify('Palworld update countdown cancelled.');
    });
    $('pwuRestart').addEventListener('click', async () => {
      const profile = selected();
      if (!profile) return;
      const typed = prompt(`Immediate restart skips the update countdown and world-save workflow. Type RESTART to restart ${profile.name} through Nitrado now:`);
      if (typed !== 'RESTART') return notify('Immediate Nitrado restart cancelled.');
      const result = await invoke('palworld-updates:restart-now', profile.id);
      state.payload = result.state;
      render(); notify('Nitrado restart request accepted through Nexus Core.');
    });
  }

  function scheduleUiRefresh() {
    clearInterval(state.timer);
    state.timer = setInterval(() => {
      if (!document.hidden && $('view-palworld-updates')?.classList.contains('active')) refresh().catch(() => {});
    }, 15000);
  }

  async function initialize() {
    ensureShell();
    await refresh();
    scheduleUiRefresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initialize().catch((error) => notify(`Palworld Updates failed to initialize: ${error.message}`)), { once: true });
  else initialize().catch((error) => notify(`Palworld Updates failed to initialize: ${error.message}`));
})();
