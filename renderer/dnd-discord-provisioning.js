'use strict';

(function bootstrapDndDiscordProvisioning(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) api.install(root);
})(typeof window !== 'undefined' ? window : null, function dndDiscordProvisioningFactory() {
  const DEFAULT_TEMPLATE = Object.freeze([
    { key: 'campaign-info', label: 'Campaign Info', name: 'campaign-info', type: 'text', required: true, detail: 'Overview, rules, announcements, and the persistent campaign panel.' },
    { key: 'table-chat', label: 'Table Chat', name: 'table-chat', type: 'text', required: true, detail: 'Primary player discussion and campaign context.' },
    { key: 'character-chat', label: 'Character Chat', name: 'character-chat', type: 'text', required: false, detail: 'Character ideas, backstories, and party discussion.' },
    { key: 'dice-rolls', label: 'Dice Rolls', name: 'dice-rolls', type: 'text', required: false, detail: 'Bot rolls and campaign roll history.' },
    { key: 'session-notes', label: 'Session Notes', name: 'session-notes', type: 'text', required: false, detail: 'Scheduling, approved recaps, and session notes.' },
    { key: 'quests-and-loot', label: 'Quests and Loot', name: 'quests-and-loot', type: 'text', required: false, detail: 'Active quests, rewards, and shared inventory.' },
    { key: 'dm-private', label: 'DM Private', name: 'dm-private', type: 'text', required: false, detail: 'Restricted planning for DMs, Assistant DMs, and campaign admins.' },
    { key: 'game-table', label: 'Game Table', name: 'game-table', type: 'voice', required: false, detail: 'Campaign voice channel.' }
  ]);

  function clean(value, max = 120) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
  }

  function resultSummary(result = {}) {
    const items = Array.isArray(result.results) ? result.results : [];
    const counts = {};
    for (const item of items) counts[item.status] = (counts[item.status] || 0) + 1;
    return {
      created: (counts.created || 0) + (counts.repaired || 0),
      reused: counts.reused || 0,
      failed: (counts.failed || 0) + (counts['binding-failed'] || 0),
      total: items.length
    };
  }

  function progressText(progress = {}) {
    if (progress.phase === 'category' && progress.status === 'creating') return `Creating campaign category ${progress.name || ''}…`;
    if (progress.phase === 'channel' && progress.status === 'creating') return `Creating ${progress.name || progress.key || 'campaign channel'}…`;
    if (progress.phase === 'complete' && progress.status === 'partial') return `Provisioning completed with ${progress.failedCount || 0} item(s) needing attention.`;
    if (progress.phase === 'complete') return `Campaign space created. ${progress.createdCount || 0} Discord resource(s) were added or repaired.`;
    if (progress.phase === 'failed') return 'Campaign-space provisioning failed.';
    return 'Preparing the campaign-space provisioning job…';
  }

  function install(win) {
    if (!win?.document || win.__khaosDndDiscordProvisioning) return win?.__khaosDndDiscordProvisioning || null;
    const doc = win.document;
    const state = {
      payload: null,
      mode: 'create',
      preview: null,
      result: null,
      busy: false,
      job: null,
      pollTimer: null,
      ensureTimer: null,
      scheduled: false,
      draft: {
        appId: '',
        guildId: '',
        categoryName: '',
        confirmed: false,
        template: DEFAULT_TEMPLATE.map((item) => ({ ...item, enabled: true }))
      }
    };

    const invoke = (channel, payload) => win.khaos.invoke(channel, payload);
    const notify = (message) => typeof win.toast === 'function' && win.toast(message);
    const workspace = () => doc.getElementById('view-dnd');
    const selectedCampaignId = () => clean(doc.getElementById('dndCampaignSelect')?.value, 100);
    const selectedCampaign = () => state.payload?.state?.campaigns?.find((item) => item.id === selectedCampaignId()) || null;

    function discordTabActive() {
      return Boolean(workspace()?.classList.contains('active') && doc.querySelector('[data-dnd-tab="discord"].active'));
    }

    function schedule() {
      if (state.scheduled) return;
      state.scheduled = true;
      win.setTimeout(() => {
        state.scheduled = false;
        enhance();
      }, 0);
    }

    function apps() {
      return Array.isArray(state.payload?.registeredApps) ? state.payload.registeredApps : [];
    }

    function syncDefaults() {
      const campaign = selectedCampaign();
      if (!state.draft.categoryName && campaign) state.draft.categoryName = campaign.name;
      if (!state.draft.appId) state.draft.appId = apps().find((item) => item.enabled !== false && item.hasToken)?.id || apps()[0]?.id || '';
      const app = apps().find((item) => item.id === state.draft.appId);
      if (!state.draft.guildId) state.draft.guildId = app?.guildIds?.[0] || '';
    }

    function collectDraft(shell = doc.getElementById('dndDiscordProvisioning')) {
      if (!shell) return state.draft;
      state.draft.appId = clean(shell.querySelector('#dndProvisionApp')?.value, 100);
      state.draft.guildId = clean(shell.querySelector('#dndProvisionGuild')?.value, 25);
      state.draft.categoryName = clean(shell.querySelector('#dndProvisionCategory')?.value, 90);
      state.draft.confirmed = Boolean(shell.querySelector('#dndProvisionConfirm')?.checked);
      state.draft.template = DEFAULT_TEMPLATE.map((item) => ({
        ...item,
        enabled: item.required || Boolean(shell.querySelector(`[data-dnd-provision-enabled="${item.key}"]`)?.checked),
        name: clean(shell.querySelector(`[data-dnd-provision-name="${item.key}"]`)?.value || item.name, 90)
      }));
      return state.draft;
    }

    function invalidatePreview() {
      state.preview = null;
      state.result = null;
      state.draft.confirmed = false;
    }

    function applicationOptions() {
      return apps().map((app) => `<option value="${escapeHtml(app.id)}" ${app.id === state.draft.appId ? 'selected' : ''}>${escapeHtml(app.name)}${app.hasToken ? '' : ' — token missing'}</option>`).join('');
    }

    function guildOptions() {
      const values = [...new Set(apps().flatMap((app) => app.guildIds || []))];
      return values.map((guildId) => `<option value="${escapeHtml(guildId)}"></option>`).join('');
    }

    function templateRows() {
      return state.draft.template.map((channel) => `
        <div class="dnd-provision-channel ${channel.required ? 'required' : ''}">
          <label class="dnd-provision-channel-toggle">
            <input type="checkbox" data-dnd-provision-enabled="${escapeHtml(channel.key)}" ${channel.enabled ? 'checked' : ''} ${channel.required ? 'disabled' : ''}>
            <span><strong>${escapeHtml(channel.label)}</strong><small>${escapeHtml(channel.type)} · ${escapeHtml(channel.detail)}</small></span>
          </label>
          <label>Channel name<input data-dnd-provision-name="${escapeHtml(channel.key)}" value="${escapeHtml(channel.name)}" maxlength="90"></label>
        </div>`).join('');
    }

    function readinessMarkup() {
      if (!state.preview) return '<div class="dnd-provision-placeholder"><strong>Review before creating</strong><span>Run the readiness check to see the exact category, channels, permissions, reused resources, and blockers.</span></div>';
      const preview = state.preview;
      const blockers = preview.blockers || [];
      const warnings = preview.warnings || [];
      return `
        <div class="dnd-provision-readiness ${preview.ready ? 'ready' : 'blocked'}">
          <div class="panel-heading"><div><span class="eyebrow">Readiness</span><h3>${preview.ready ? 'Ready to create' : 'Action required'}</h3></div><span class="tag ${preview.ready ? 'good' : ''}">${preview.ready ? 'Ready' : `${blockers.length} blocker(s)`}</span></div>
          <div class="dnd-provision-readiness-grid">
            <div><span>Bot permissions</span><strong>${preview.bot?.manageChannels && preview.bot?.manageRoles ? 'Ready' : 'Missing permissions'}</strong><small>Manage Channels: ${preview.bot?.manageChannels ? 'yes' : 'no'} · Manage Roles: ${preview.bot?.manageRoles ? 'yes' : 'no'}</small></div>
            <div><span>Mapped members</span><strong>${preview.members?.mapped || 0} / ${preview.members?.total || 0}</strong><small>${preview.members?.managers || 0} mapped DM/Admin manager(s)</small></div>
            <div><span>Category</span><strong>${escapeHtml(preview.categoryName)}</strong><small>${preview.existingRecord?.categoryId ? 'Managed category will be reused or repaired' : 'New category will be created'}</small></div>
          </div>
          ${blockers.length ? `<div class="callout bad"><strong>Fix before creating</strong>${blockers.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>` : ''}
          ${warnings.length ? `<div class="callout warning"><strong>Warnings</strong>${warnings.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>` : ''}
          <div class="dnd-provision-plan">${preview.plan.map((item) => `<div><span class="tag">${escapeHtml(item.action)}</span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.type)} · ${escapeHtml(item.purpose)}</small></div>`).join('')}</div>
          <label class="toggle-row dnd-provision-confirm"><span><strong>Create exactly this campaign space</strong><small>This creates or repairs only the listed Khaos Nexus-managed resources. It does not create Discord roles or delete unrelated channels.</small></span><input id="dndProvisionConfirm" type="checkbox" ${state.draft.confirmed ? 'checked' : ''} ${preview.ready ? '' : 'disabled'}></label>
        </div>`;
    }

    function progressMarkup() {
      if (!state.job && !state.result) return '';
      if (state.job && ['running'].includes(state.job.status)) {
        return `<div class="dnd-provision-progress" role="status"><span class="dnd-provision-spinner" aria-hidden="true"></span><div><strong>Creating campaign space</strong><span>${escapeHtml(progressText(state.job.progress))}</span></div></div>`;
      }
      if (!state.result) {
        return `<div class="callout bad"><strong>Provisioning failed</strong><span>${escapeHtml(state.job?.error?.message || 'The Discord campaign space could not be created.')}</span></div>`;
      }
      const summary = resultSummary(state.result);
      return `
        <div class="dnd-provision-result ${summary.failed ? 'partial' : 'success'}">
          <div class="panel-heading"><div><span class="eyebrow">Result</span><h3>${summary.failed ? 'Campaign space needs attention' : 'Campaign space is ready'}</h3></div><span class="tag ${summary.failed ? '' : 'good'}">${summary.created} added/repaired · ${summary.reused} reused</span></div>
          <div class="dnd-provision-plan">${(state.result.results || []).map((item) => `<div class="status-${escapeHtml(item.status)}"><span class="tag">${escapeHtml(item.status)}</span><strong>${escapeHtml(item.name || item.key)}</strong><small>${escapeHtml(item.error || item.id || item.type || '')}</small></div>`).join('')}</div>
          ${summary.failed ? '<div class="callout warning"><strong>Safe retry available</strong><span>Fix the reported Discord permission or resource issue, preview again, then rerun. Existing managed resources will be reused.</span></div>' : ''}
        </div>`;
    }

    function renderShell(shell) {
      syncDefaults();
      shell.innerHTML = `
        <div class="dnd-provision-paths" role="tablist" aria-label="Discord campaign setup path">
          <button type="button" class="dnd-provision-path ${state.mode === 'existing' ? 'active' : ''}" data-dnd-provision-mode="existing"><strong>Use Existing Resource</strong><span>Bind a channel, thread, or forum post that already exists.</span></button>
          <button type="button" class="dnd-provision-path ${state.mode === 'create' ? 'active' : ''}" data-dnd-provision-mode="create"><strong>Create Campaign Space</strong><span>Preview and create one campaign category with selected channels.</span></button>
        </div>
        <div class="dnd-provision-create ${state.mode === 'create' ? '' : 'hidden'}">
          <article class="panel form-panel">
            <div class="panel-heading"><div><span class="eyebrow">Step 1</span><h3>Choose the bot and Discord server</h3></div><span class="tag good">Creates nothing yet</span></div>
            <div class="form-grid">
              <label>Registered Discord bot<select id="dndProvisionApp"><option value="">Select registered bot</option>${applicationOptions()}</select></label>
              <label>Discord server ID<input id="dndProvisionGuild" list="dndProvisionGuilds" inputmode="numeric" maxlength="25" value="${escapeHtml(state.draft.guildId)}" placeholder="Select or paste the guild ID"><datalist id="dndProvisionGuilds">${guildOptions()}</datalist></label>
            </div>
            <label>Campaign category name<input id="dndProvisionCategory" maxlength="90" value="${escapeHtml(state.draft.categoryName)}"></label>
          </article>
          <article class="panel">
            <div class="panel-heading"><div><span class="eyebrow">Step 2</span><h3>Choose the campaign channels</h3></div><span class="tag">Required channels are locked on</span></div>
            <div class="dnd-provision-channel-list">${templateRows()}</div>
          </article>
          <article class="panel dnd-provision-review">
            <div class="panel-heading"><div><span class="eyebrow">Step 3</span><h3>Review permissions and exact changes</h3></div><button type="button" class="button primary" data-dnd-provision-action="preview" ${state.busy ? 'disabled' : ''}>Check Readiness &amp; Preview</button></div>
            ${readinessMarkup()}
            ${progressMarkup()}
            <div class="form-actions"><button type="button" class="button primary" data-dnd-provision-action="apply" ${!state.preview?.ready || !state.draft.confirmed || state.busy ? 'disabled' : ''}>Create Campaign Discord Space</button></div>
          </article>
        </div>`;
    }

    function enhance() {
      if (!discordTabActive()) return false;
      const panel = workspace()?.querySelector('.dnd-tab-panel');
      if (!panel) return false;
      let shell = doc.getElementById('dndDiscordProvisioning');
      if (!shell) {
        shell = doc.createElement('section');
        shell.id = 'dndDiscordProvisioning';
        shell.className = 'dnd-discord-provisioning';
        panel.prepend(shell);
      } else collectDraft(shell);
      panel.classList.toggle('dnd-provision-existing-mode', state.mode === 'existing');
      panel.classList.toggle('dnd-provision-create-mode', state.mode === 'create');
      const legacyGrid = panel.querySelector('.dnd-discord-grid');
      if (legacyGrid) {
        legacyGrid.classList.add('dnd-existing-resource-setup');
        legacyGrid.hidden = state.mode !== 'existing';
      }
      const banner = workspace()?.querySelector('.dnd-policy-banner');
      if (banner) {
        const strong = banner.querySelector('strong');
        const detail = banner.querySelector('div span');
        const tag = banner.querySelector('.tag');
        if (strong) strong.textContent = 'Discord setup is deliberate and previewed';
        if (detail) detail.textContent = 'Use an existing resource, or explicitly preview and confirm one campaign category with selected channels.';
        if (tag) { tag.textContent = 'No automatic creation'; tag.classList.add('good'); }
      }
      renderShell(shell);
      return true;
    }

    async function refreshPayload() {
      state.payload = await invoke('dnd:get');
      syncDefaults();
      schedule();
      return state.payload;
    }

    async function preview() {
      const shell = doc.getElementById('dndDiscordProvisioning');
      collectDraft(shell);
      const campaignId = selectedCampaignId();
      if (!campaignId) throw new Error('Select a D&D campaign before provisioning Discord channels.');
      if (!state.draft.appId) throw new Error('Select a registered Discord bot.');
      if (!/^\d{5,25}$/.test(state.draft.guildId)) throw new Error('Enter a valid numeric Discord server ID.');
      state.busy = true;
      state.preview = null;
      state.result = null;
      schedule();
      try {
        state.preview = await invoke('dnd-provision:preview', {
          campaignId,
          appId: state.draft.appId,
          guildId: state.draft.guildId,
          categoryName: state.draft.categoryName,
          template: state.draft.template.map(({ key, name, enabled }) => ({ key, name, enabled }))
        });
        state.draft.confirmed = false;
      } finally {
        state.busy = false;
        schedule();
      }
    }

    function stopPolling() {
      if (state.pollTimer) win.clearTimeout(state.pollTimer);
      state.pollTimer = null;
    }

    async function pollJob() {
      stopPolling();
      if (!state.job?.id || state.job.status !== 'running') return;
      try {
        state.job = await invoke('dnd-provision:status', { jobId: state.job.id });
        if (state.job.status === 'running') {
          schedule();
          state.pollTimer = win.setTimeout(pollJob, 650);
          return;
        }
        state.busy = false;
        if (state.job.status === 'completed' || state.job.status === 'partial') {
          state.result = state.job.result;
          state.preview = null;
          state.draft.confirmed = false;
          win.__khaosDndRefreshGuard?.clearAfterSuccessfulMutation?.();
          await win.__khaosDndOwnerWorkflows?.refresh?.().catch(() => refreshPayload());
          notify(state.job.status === 'completed' ? 'Campaign Discord space created.' : 'Campaign space created with items needing attention.');
        } else {
          notify(state.job.error?.message || 'Campaign-space provisioning failed.');
        }
        schedule();
      } catch (error) {
        state.busy = false;
        state.job = { ...state.job, status: 'failed', error: { message: error.message || String(error) } };
        schedule();
      }
    }

    async function apply() {
      const shell = doc.getElementById('dndDiscordProvisioning');
      collectDraft(shell);
      if (!state.preview?.ready || !state.draft.confirmed) return;
      state.busy = true;
      state.result = null;
      state.job = await invoke('dnd-provision:start', {
        campaignId: selectedCampaignId(),
        appId: state.draft.appId,
        guildId: state.draft.guildId,
        categoryName: state.draft.categoryName,
        template: state.draft.template.map(({ key, name, enabled }) => ({ key, name, enabled })),
        confirmed: true,
        confirmationHash: state.preview.confirmationHash
      });
      schedule();
      pollJob();
    }

    doc.addEventListener('click', async (event) => {
      const mode = event.target?.closest?.('[data-dnd-provision-mode]')?.dataset.dndProvisionMode;
      if (mode) {
        collectDraft();
        state.mode = mode;
        schedule();
        return;
      }
      const action = event.target?.closest?.('[data-dnd-provision-action]')?.dataset.dndProvisionAction;
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        if (action === 'preview') await preview();
        if (action === 'apply') await apply();
      } catch (error) {
        state.busy = false;
        notify(error.message || String(error));
        schedule();
      }
    }, true);

    doc.addEventListener('input', (event) => {
      if (!event.target?.closest?.('#dndDiscordProvisioning')) return;
      collectDraft();
      if (event.target.id !== 'dndProvisionConfirm') invalidatePreview();
    }, true);

    doc.addEventListener('change', (event) => {
      if (event.target?.id === 'dndCampaignSelect') {
        state.preview = null;
        state.result = null;
        state.draft.categoryName = '';
        schedule();
        return;
      }
      if (!event.target?.closest?.('#dndDiscordProvisioning')) return;
      collectDraft();
      if (event.target.id === 'dndProvisionApp') {
        const app = apps().find((item) => item.id === state.draft.appId);
        state.draft.guildId = app?.guildIds?.[0] || state.draft.guildId;
      }
      if (event.target.id !== 'dndProvisionConfirm') invalidatePreview();
      schedule();
    }, true);

    doc.addEventListener('click', (event) => {
      if (event.target?.closest?.('[data-dnd-tab="discord"]')) win.setTimeout(schedule, 0);
    }, true);

    if (win.khaos?.onDnd) win.khaos.onDnd((payload) => { state.payload = payload; schedule(); });
    refreshPayload().catch((error) => notify(error.message || String(error)));

    const ensureMounted = () => {
      state.ensureTimer = null;
      if (discordTabActive() && !doc.getElementById('dndDiscordProvisioning')) enhance();
      state.ensureTimer = win.setTimeout(ensureMounted, workspace()?.classList.contains('active') ? 2000 : 5000);
    };
    state.ensureTimer = win.setTimeout(ensureMounted, 1000);

    const api = {
      state,
      refreshPayload,
      enhance,
      preview,
      apply,
      disconnect() {
        stopPolling();
        if (state.ensureTimer) win.clearTimeout(state.ensureTimer);
        doc.getElementById('dndDiscordProvisioning')?.remove();
        delete win.__khaosDndDiscordProvisioning;
      }
    };
    win.__khaosDndDiscordProvisioning = api;
    return api;
  }

  return {
    DEFAULT_TEMPLATE,
    clean,
    escapeHtml,
    resultSummary,
    progressText,
    install
  };
});
