'use strict';

(() => {
  const DAYS = [
    { value: 0, label: 'Sun' }, { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' },
    { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }
  ];
  const state = { payload: null, selectedId: null };
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
    catch (error) {
      notify(error.message || String(error));
      throw error;
    }
  }

  function canOperate() {
    return ['operator', 'owner', 'local-admin'].includes(state.payload?.role);
  }

  function canOwn() {
    return ['owner', 'local-admin'].includes(state.payload?.role);
  }

  function schedules() {
    return state.payload?.config?.schedules || [];
  }

  function selectedSchedule() {
    return schedules().find((schedule) => schedule.id === state.selectedId) || null;
  }

  function newId() {
    return `server-schedule-${crypto.randomUUID()}`;
  }

  function defaultSchedule() {
    return {
      id: newId(),
      name: 'Daily Server Restart',
      serverIds: [],
      enabled: true,
      action: 'restart',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      hour: 6,
      minute: 0,
      warningMinutes: [30, 15, 10, 5, 1],
      warningMessage: 'Server restart in {minutes} minute(s). Please move to a safe location and prepare to disconnect.',
      finalMessage: 'Server maintenance is beginning now. The world is being saved.',
      saveBeforeAction: true,
      saveDelaySeconds: 10,
      restartTimeoutMinutes: 15,
      discordReport: true,
      lastRunAt: null,
      lastOutcome: null,
      lastError: ''
    };
  }

  function ensureShell() {
    if (typeof viewMeta !== 'undefined') {
      viewMeta.scheduler = ['Server Scheduler', 'Recurring saves and host-managed restarts with warnings, verification, and history.'];
    }

    if (!document.querySelector('[data-view="scheduler"]')) {
      const servers = document.querySelector('[data-view="servers"]');
      const button = document.createElement('button');
      button.className = 'nav-item';
      button.dataset.view = 'scheduler';
      button.innerHTML = '<span>◷</span>Server Scheduler';
      servers?.insertAdjacentElement('afterend', button);
    }

    if ($('view-scheduler')) return;
    const view = document.createElement('section');
    view.className = 'view';
    view.id = 'view-scheduler';
    view.innerHTML = `
      <div class="scheduler-intro">
        <div><span class="eyebrow">Server Operations</span><h2>Server Scheduler</h2><p>Warn players, save worlds, request a safe shutdown, and verify that your hosting service brings each server back online.</p></div>
        <div class="scheduler-header-actions"><button class="button" id="schedulerReload">Reload</button><button class="button primary" id="schedulerNew">New Schedule</button></div>
      </div>

      <div class="scheduler-summary" id="schedulerSummary"></div>

      <article class="panel scheduler-global-settings">
        <div class="panel-heading"><div><span class="eyebrow">Scheduler Engine</span><h3>Runtime Settings</h3></div><span class="severity" id="schedulerEngineState">Enabled</span></div>
        <div class="form-grid three">
          <label class="toggle-row compact"><span><strong>Enable scheduled execution</strong><small>Pauses all recurring schedules without deleting them.</small></span><input id="schedulerEnabled" type="checkbox" checked></label>
          <label>Missed-run grace (minutes)<input id="schedulerGrace" type="number" min="1" max="60" value="10"></label>
          <label>Restart verification interval (seconds)<input id="schedulerPoll" type="number" min="10" max="120" value="30"></label>
        </div>
        <div class="form-actions"><button class="button" id="schedulerSaveSettings">Save Runtime Settings</button></div>
      </article>

      <div class="scheduler-workspace">
        <aside class="panel scheduler-list-panel">
          <div class="panel-heading"><div><span class="eyebrow">Recurring Tasks</span><h3>Schedules</h3></div></div>
          <div id="schedulerList" class="scheduler-list"></div>
        </aside>

        <article class="panel scheduler-editor">
          <div class="panel-heading"><div><span class="eyebrow">Protected Workflow</span><h3 id="schedulerEditorTitle">Schedule Editor</h3></div><span class="severity" id="schedulerEditorState">Draft</span></div>
          <input id="schedulerId" type="hidden">
          <div class="form-grid three">
            <label>Schedule name<input id="schedulerName" maxlength="100"></label>
            <label>Action<select id="schedulerAction"><option value="restart">Host-managed restart</option><option value="save">World save only</option></select></label>
            <label>Local PC time<input id="schedulerTime" type="time" value="06:00"></label>
          </div>

          <div class="scheduler-days" id="schedulerDays"></div>

          <div>
            <span class="field-heading">Target servers</span>
            <div id="schedulerServers" class="scheduler-server-grid"></div>
          </div>

          <div class="form-grid three">
            <label>Warning minutes<input id="schedulerWarnings" placeholder="30, 15, 10, 5, 1"></label>
            <label>Save settle delay (seconds)<input id="schedulerSaveDelay" type="number" min="0" max="120"></label>
            <label>Restart verification timeout (minutes)<input id="schedulerRestartTimeout" type="number" min="2" max="60"></label>
          </div>

          <label>Player warning message<textarea id="schedulerWarningMessage" rows="3" maxlength="500"></textarea></label>
          <label>Final maintenance message<textarea id="schedulerFinalMessage" rows="3" maxlength="500"></textarea></label>

          <div class="scheduler-toggle-grid">
            <label class="toggle-row"><span><strong>Schedule enabled</strong><small>Disabled schedules remain saved but do not run.</small></span><input id="schedulerScheduleEnabled" type="checkbox" checked></label>
            <label class="toggle-row"><span><strong>Save before shutdown</strong><small>A failed save prevents that server from being shut down.</small></span><input id="schedulerSaveBefore" type="checkbox" checked></label>
            <label class="toggle-row"><span><strong>Discord reports</strong><small>Uses the Operator Console notification channel.</small></span><input id="schedulerDiscordReport" type="checkbox" checked></label>
          </div>

          <div class="scheduler-safety-note">
            <strong>Host-managed restart</strong>
            <span>Khaos Nexus can safely warn, save, and shut down through REST or RCON. The hosting service must be configured to relaunch the server. Khaos Nexus then watches for the offline and online transitions.</span>
          </div>

          <div id="schedulerLastResult" class="scheduler-last-result"></div>
          <div class="form-actions">
            <button class="button primary" id="schedulerSave">Save Schedule</button>
            <button class="button" id="schedulerRunNow">Run Now</button>
            <button class="button" id="schedulerTestDiscord">Test Discord Report</button>
            <button class="button danger" id="schedulerDelete">Delete Schedule</button>
          </div>
        </article>
      </div>

      <article class="panel scheduler-active-panel">
        <div class="panel-heading"><div><span class="eyebrow">Live Execution</span><h3>Active Workflows</h3></div></div>
        <div id="schedulerActiveRuns" class="scheduler-active-runs"></div>
      </article>

      <article class="panel scheduler-history-panel">
        <div class="panel-heading"><div><span class="eyebrow">Audit Trail</span><h3>Execution History</h3></div><button class="button danger" id="schedulerClearHistory">Clear History</button></div>
        <div id="schedulerHistory" class="scheduler-history"></div>
      </article>`;
    document.querySelector('main.content')?.appendChild(view);
    bind();
  }

  function openView() {
    document.querySelectorAll('.view').forEach((element) => element.classList.toggle('active', element.id === 'view-scheduler'));
    document.querySelectorAll('.nav-item').forEach((element) => element.classList.toggle('active', element.dataset.view === 'scheduler'));
    if ($('viewTitle')) $('viewTitle').textContent = 'Server Scheduler';
    if ($('viewSubtitle')) $('viewSubtitle').textContent = 'Recurring saves and host-managed restarts with warnings, verification, and history.';
    refresh().catch(() => {});
  }

  function formatDate(value, fallback = 'Never') {
    if (!value) return fallback;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : fallback;
  }

  function formatTime(schedule) {
    const hour = Number(schedule.hour) % 12 || 12;
    const suffix = Number(schedule.hour) >= 12 ? 'PM' : 'AM';
    return `${hour}:${String(schedule.minute).padStart(2, '0')} ${suffix}`;
  }

  function daySummary(schedule) {
    const days = schedule.daysOfWeek || [];
    if (days.length === 7) return 'Daily';
    if (days.join(',') === '1,2,3,4,5') return 'Weekdays';
    if (days.join(',') === '0,6') return 'Weekends';
    return DAYS.filter((day) => days.includes(day.value)).map((day) => day.label).join(', ');
  }

  function renderSummary() {
    const configured = schedules().length;
    const enabled = schedules().filter((schedule) => schedule.enabled).length;
    const active = state.payload?.activeRuns?.length || 0;
    const nextValues = Object.values(state.payload?.nextRuns || {}).filter(Boolean).map((value) => new Date(value)).filter((date) => Number.isFinite(date.getTime())).sort((a, b) => a - b);
    const next = nextValues[0];
    $('schedulerSummary').innerHTML = `
      <article><span>Configured</span><strong>${configured}</strong><small>${enabled} enabled</small></article>
      <article><span>Next Workflow</span><strong>${next ? escapeHtml(next.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) : 'None'}</strong><small>${next ? escapeHtml(next.toLocaleDateString()) : 'No enabled schedules'}</small></article>
      <article><span>Active</span><strong>${active}</strong><small>${active ? 'Workflow in progress' : 'No server operation running'}</small></article>
      <article><span>Discord Reports</span><strong>${state.payload?.discordReporting?.enabled ? 'Ready' : 'Disabled'}</strong><small>${state.payload?.discordReporting?.channelId ? `Channel ${escapeHtml(state.payload.discordReporting.channelId)}` : 'Configure in Operator Console'}</small></article>`;
  }

  function renderSettings() {
    const settings = state.payload?.config?.settings || {};
    $('schedulerEnabled').checked = settings.enabled !== false;
    $('schedulerGrace').value = settings.missedRunGraceMinutes || 10;
    $('schedulerPoll').value = settings.pollSeconds || 30;
    $('schedulerEngineState').textContent = settings.enabled !== false ? 'Enabled' : 'Paused';
    $('schedulerEngineState').className = `severity ${settings.enabled !== false ? 'good' : ''}`;
  }

  function renderList() {
    const list = $('schedulerList');
    if (!schedules().length) {
      list.innerHTML = '<div class="scheduler-empty">No server schedules configured.</div>';
      return;
    }
    list.innerHTML = schedules().map((schedule) => {
      const next = state.payload?.nextRuns?.[schedule.id];
      const active = state.payload?.activeRuns?.some((run) => run.scheduleId === schedule.id);
      return `
        <button class="scheduler-list-card ${schedule.id === state.selectedId ? 'active' : ''}" data-scheduler-id="${escapeHtml(schedule.id)}">
          <span class="scheduler-list-icon">${schedule.action === 'restart' ? '↻' : '◆'}</span>
          <span><strong>${escapeHtml(schedule.name)}</strong><small>${escapeHtml(daySummary(schedule))} • ${escapeHtml(formatTime(schedule))}${next ? ` • Next ${escapeHtml(formatDate(next))}` : ''}</small></span>
          <span class="scheduler-status-dot ${active ? 'running' : schedule.lastOutcome || (schedule.enabled ? 'ready' : 'disabled')}"></span>
        </button>`;
    }).join('');
  }

  function renderDays(selected = []) {
    $('schedulerDays').innerHTML = DAYS.map((day) => `
      <label class="scheduler-day ${selected.includes(day.value) ? 'selected' : ''}"><input type="checkbox" value="${day.value}" ${selected.includes(day.value) ? 'checked' : ''}><span>${day.label}</span></label>`).join('');
  }

  function renderServers(selected = []) {
    const servers = state.payload?.servers || [];
    $('schedulerServers').innerHTML = servers.length ? servers.map((server) => `
      <label class="scheduler-server ${selected.includes(server.id) ? 'selected' : ''} ${server.enabled && server.hasPassword ? '' : 'unready'}">
        <input type="checkbox" value="${escapeHtml(server.id)}" ${selected.includes(server.id) ? 'checked' : ''} ${server.enabled ? '' : 'disabled'}>
        <span><strong>${escapeHtml(server.name)}</strong><small>${escapeHtml(String(server.game || 'generic').toUpperCase())} • ${server.connectionType === 'rest' ? 'REST' : 'RCON'}${server.hasPassword ? '' : ' • credentials missing'}${server.enabled ? '' : ' • disabled'}</small></span>
      </label>`).join('') : '<div class="scheduler-empty">Add a game server before creating a schedule.</div>';
  }

  function fillEditor(scheduleInput) {
    const schedule = scheduleInput || defaultSchedule();
    state.selectedId = schedule.id;
    $('schedulerId').value = schedule.id;
    $('schedulerName').value = schedule.name || '';
    $('schedulerAction').value = schedule.action || 'restart';
    $('schedulerTime').value = `${String(schedule.hour ?? 6).padStart(2, '0')}:${String(schedule.minute ?? 0).padStart(2, '0')}`;
    $('schedulerWarnings').value = (schedule.warningMinutes || [30, 15, 10, 5, 1]).join(', ');
    $('schedulerSaveDelay').value = schedule.saveDelaySeconds ?? 10;
    $('schedulerRestartTimeout').value = schedule.restartTimeoutMinutes ?? 15;
    $('schedulerWarningMessage').value = schedule.warningMessage || '';
    $('schedulerFinalMessage').value = schedule.finalMessage || '';
    $('schedulerScheduleEnabled').checked = schedule.enabled !== false;
    $('schedulerSaveBefore').checked = schedule.saveBeforeAction !== false;
    $('schedulerDiscordReport').checked = schedule.discordReport !== false;
    renderDays(schedule.daysOfWeek || [0, 1, 2, 3, 4, 5, 6]);
    renderServers(schedule.serverIds || []);
    $('schedulerEditorTitle').textContent = schedule.name || 'Schedule Editor';
    $('schedulerEditorState').textContent = schedule.lastOutcome ? schedule.lastOutcome : schedules().some((item) => item.id === schedule.id) ? 'Saved' : 'Draft';
    $('schedulerEditorState').className = `severity ${schedule.lastOutcome === 'success' ? 'good' : schedule.lastOutcome === 'failed' ? 'bad' : ''}`;
    $('schedulerLastResult').innerHTML = schedule.lastRunAt
      ? `<strong>Last run: ${escapeHtml(formatDate(schedule.lastRunAt))}</strong><span>${escapeHtml(schedule.lastError || schedule.lastOutcome || 'Completed')}</span>`
      : '<strong>No completed run</strong><span>The next scheduled occurrence will appear after saving.</span>';
    $('schedulerWarnings').closest('label').classList.toggle('scheduler-field-disabled', schedule.action !== 'restart');
    $('schedulerWarningMessage').closest('label').classList.toggle('scheduler-field-disabled', schedule.action !== 'restart');
    applyPermissions();
    renderList();
  }

  function collectEditor() {
    const existing = schedules().find((schedule) => schedule.id === $('schedulerId').value) || {};
    const [hour, minute] = $('schedulerTime').value.split(':').map(Number);
    return {
      ...existing,
      id: $('schedulerId').value || newId(),
      name: $('schedulerName').value,
      action: $('schedulerAction').value,
      hour,
      minute,
      serverIds: [...$('schedulerServers').querySelectorAll('input:checked')].map((input) => input.value),
      daysOfWeek: [...$('schedulerDays').querySelectorAll('input:checked')].map((input) => Number(input.value)),
      warningMinutes: $('schedulerWarnings').value.split(',').map((value) => Number(value.trim())).filter(Number.isFinite),
      warningMessage: $('schedulerWarningMessage').value,
      finalMessage: $('schedulerFinalMessage').value,
      saveBeforeAction: $('schedulerSaveBefore').checked,
      saveDelaySeconds: Number($('schedulerSaveDelay').value),
      restartTimeoutMinutes: Number($('schedulerRestartTimeout').value),
      enabled: $('schedulerScheduleEnabled').checked,
      discordReport: $('schedulerDiscordReport').checked
    };
  }

  function renderActiveRuns() {
    const runs = state.payload?.activeRuns || [];
    $('schedulerActiveRuns').innerHTML = runs.length ? runs.map((run) => `
      <div class="scheduler-active-run">
        <span class="scheduler-run-pulse"></span>
        <span><strong>${escapeHtml(run.scheduleName)}</strong><small>${escapeHtml(run.stage.replaceAll('-', ' '))} • Started ${escapeHtml(formatDate(run.startedAt))}${run.shutdownSent ? ' • Shutdown sent' : ''}</small></span>
        <button class="button danger" data-scheduler-cancel="${escapeHtml(run.id)}">${run.shutdownSent ? 'Stop Monitoring' : 'Cancel'}</button>
      </div>`).join('') : '<div class="scheduler-empty">No scheduler workflow is currently active.</div>';
  }

  function renderHistory() {
    const history = state.payload?.history || [];
    $('schedulerHistory').innerHTML = history.length ? history.map((entry) => `
      <details class="scheduler-history-entry ${escapeHtml(entry.outcome)}">
        <summary>
          <span class="scheduler-history-icon">${entry.outcome === 'success' ? '✓' : entry.outcome === 'running' ? '↻' : entry.outcome === 'cancelled' ? '—' : '!'}</span>
          <span><strong>${escapeHtml(entry.scheduleName)}</strong><small>${escapeHtml(entry.source)} ${escapeHtml(entry.action)} • ${escapeHtml(formatDate(entry.startedAt))}</small></span>
          <span class="severity ${entry.outcome === 'success' ? 'good' : entry.outcome === 'failed' ? 'bad' : ''}">${escapeHtml(entry.outcome)}</span>
        </summary>
        <div class="scheduler-history-body"><p>${escapeHtml(entry.summary || 'No summary recorded.')}</p>${(entry.details || []).map((detail) => `<div class="scheduler-history-detail"><span>${escapeHtml(formatDate(detail.time))}</span><strong>${escapeHtml(detail.serverName || detail.stage || 'Scheduler')}</strong><span>${escapeHtml(detail.message)}</span></div>`).join('')}</div>
      </details>`).join('') : '<div class="scheduler-empty">No server scheduler executions have been recorded.</div>';
  }

  function applyPermissions() {
    const ownerOnly = ['schedulerSave', 'schedulerDelete', 'schedulerSaveSettings', 'schedulerClearHistory'];
    const operator = ['schedulerRunNow', 'schedulerTestDiscord'];
    ownerOnly.forEach((id) => { if ($(id)) $(id).disabled = !canOwn(); });
    operator.forEach((id) => { if ($(id)) $(id).disabled = !canOperate(); });
    $('schedulerNew').disabled = !canOwn();
    document.querySelectorAll('[data-scheduler-cancel]').forEach((button) => { button.disabled = !canOperate(); });
    document.querySelectorAll('#view-scheduler input, #view-scheduler textarea, #view-scheduler select').forEach((element) => { element.disabled = !canOwn(); });
  }

  function render() {
    if (!state.payload) return;
    renderSummary();
    renderSettings();
    if (!state.selectedId && schedules()[0]) state.selectedId = schedules()[0].id;
    renderList();
    fillEditor(selectedSchedule() || defaultSchedule());
    renderActiveRuns();
    renderHistory();
    applyPermissions();
  }

  async function refresh() {
    state.payload = await invoke('server-scheduler:get');
    render();
  }

  function bind() {
    document.addEventListener('click', (event) => {
      if (event.target.closest('[data-view="scheduler"]')) openView();
    });
    $('schedulerReload').addEventListener('click', refresh);
    $('schedulerNew').addEventListener('click', () => fillEditor(defaultSchedule()));
    $('schedulerList').addEventListener('click', (event) => {
      const item = event.target.closest('[data-scheduler-id]');
      if (!item) return;
      state.selectedId = item.dataset.schedulerId;
      fillEditor(selectedSchedule());
    });
    $('schedulerDays').addEventListener('change', (event) => event.target.closest('.scheduler-day')?.classList.toggle('selected', event.target.checked));
    $('schedulerServers').addEventListener('change', (event) => event.target.closest('.scheduler-server')?.classList.toggle('selected', event.target.checked));
    $('schedulerAction').addEventListener('change', () => fillEditor({ ...collectEditor(), action: $('schedulerAction').value }));

    $('schedulerSaveSettings').addEventListener('click', async () => {
      state.payload = await invoke('server-scheduler:settings', {
        enabled: $('schedulerEnabled').checked,
        missedRunGraceMinutes: Number($('schedulerGrace').value),
        pollSeconds: Number($('schedulerPoll').value)
      });
      render();
      notify('Scheduler runtime settings saved.');
    });

    $('schedulerSave').addEventListener('click', async () => {
      const schedule = collectEditor();
      state.payload = await invoke('server-scheduler:save', schedule);
      state.selectedId = schedule.id;
      render();
      notify('Server schedule saved.');
    });

    $('schedulerRunNow').addEventListener('click', async () => {
      const schedule = selectedSchedule();
      if (!schedule) return notify('Save this schedule before running it.');
      const message = schedule.action === 'restart'
        ? `Run ${schedule.name} now? Players will receive a 60-second warning, then Khaos Nexus will save, shut down, and verify the host-managed restart.`
        : `Run ${schedule.name} now and request a world save on every selected server?`;
      if (!confirm(message)) return;
      const result = await invoke('server-scheduler:run-now', { id: schedule.id, countdownSeconds: schedule.action === 'restart' ? 60 : 0 });
      state.payload = result.state;
      render();
      notify('Manual scheduler workflow started.');
    });

    $('schedulerTestDiscord').addEventListener('click', async () => {
      const schedule = selectedSchedule();
      if (!schedule) return notify('Save this schedule before testing Discord reporting.');
      const result = await invoke('server-scheduler:test-discord', schedule.id);
      state.payload = result.state;
      render();
      notify(result.result?.sent ? 'Scheduler Discord report delivered.' : `Discord report skipped: ${result.result?.reason || result.result?.error || 'not configured'}.`);
    });

    $('schedulerDelete').addEventListener('click', async () => {
      const schedule = selectedSchedule();
      if (!schedule || !confirm(`Delete ${schedule.name}? Execution history will remain.`)) return;
      state.payload = await invoke('server-scheduler:remove', schedule.id);
      state.selectedId = null;
      render();
      notify('Server schedule removed.');
    });

    $('schedulerActiveRuns').addEventListener('click', async (event) => {
      const button = event.target.closest('[data-scheduler-cancel]');
      if (!button) return;
      if (!confirm('Cancel this workflow? A shutdown command that was already sent cannot be undone.')) return;
      state.payload = await invoke('server-scheduler:cancel', button.dataset.schedulerCancel);
      render();
      notify('Scheduler cancellation requested.');
    });

    $('schedulerClearHistory').addEventListener('click', async () => {
      if (!confirm('Clear all server scheduler execution history?')) return;
      state.payload = await invoke('server-scheduler:clear-history');
      render();
      notify('Scheduler history cleared.');
    });
  }

  async function initialize() {
    ensureShell();
    window.khaos.onServerScheduler?.((payload) => { state.payload = payload; render(); });
    await refresh();
  }

  initialize().catch((error) => notify(`Server Scheduler failed to initialize: ${error.message}`));
})();
